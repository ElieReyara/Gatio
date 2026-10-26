import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.js';
import {
  discrepancies,
  events,
  funnelEvents,
  orderItems,
  orders,
  organizers,
  paymentWebhookEvents,
  payments,
  payouts,
  ticketCategories,
  tickets,
} from '../../db/schema.js';
import { queueTicketEmail } from '../tickets/email.js';
import type { PaymentPort, ProviderResult } from './port.js';

export type ApplyOutcome =
  | 'confirmed'
  | 'late_confirmed'
  | 'needs_review'
  | 'duplicate_payment'
  | 'amount_mismatch'
  | 'failed'
  | 'ignored'
  | 'unknown_payment';

type OrderRow = typeof orders.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

/**
 * Applique un résultat du prestataire (notification ou interrogation). Rejouable sans effet
 * double : un paiement déjà confirmé ne change plus rien (invariant 4).
 * R14 : tout se fait dans une transaction, la commande verrouillée en premier, puis le
 * paiement, puis les catégories dans l'ordre de leur identifiant (même ordre que la
 * réservation et l'expiration).
 */
export async function applyProviderResult(
  db: Db,
  provider: string,
  result: ProviderResult,
): Promise<ApplyOutcome> {
  return db.transaction(async (tx) => {
    // Par la référence du prestataire ; à défaut par la nôtre, si le démarrage n'a pas pu
    // enregistrer celle du prestataire (réponse perdue).
    const byProviderRef = and(
      eq(payments.provider, provider),
      eq(payments.providerRef, result.providerRef),
    );
    const byReference =
      result.reference && UUID.test(result.reference)
        ? and(
            eq(payments.provider, provider),
            eq(payments.id, result.reference),
            sql`${payments.providerRef} like 'local:%'`,
          )
        : null;
    let match = byProviderRef;
    let [found] = await tx.select({ orderId: payments.orderId }).from(payments).where(match);
    if (!found && byReference) {
      match = byReference;
      [found] = await tx.select({ orderId: payments.orderId }).from(payments).where(match);
    }
    if (!found) return 'unknown_payment';
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, found.orderId))
      .for('update');
    const [payment] = await tx.select().from(payments).where(match).for('update');
    if (!order || !payment) return 'unknown_payment';
    if (match === byReference) {
      await tx
        .update(payments)
        .set({ providerRef: result.providerRef, updatedAt: sql`now()` })
        .where(eq(payments.id, payment.id));
    }

    if (result.status === 'failed') {
      if (payment.status !== 'pending') return 'ignored';
      await tx
        .update(payments)
        .set({
          status: 'failed',
          failureReason: result.failureReason ?? 'failed',
          updatedAt: sql`now()`,
        })
        .where(eq(payments.id, payment.id));
      return 'failed';
    }

    if (payment.status === 'confirmed' || payment.status === 'refunded') return 'ignored';

    // R15 : montant différent, aucune confirmation ; l'acheteur peut réessayer.
    if (result.amount !== payment.amount || result.currency !== payment.currency) {
      await tx
        .update(payments)
        .set({ status: 'failed', failureReason: 'amount_mismatch', updatedAt: sql`now()` })
        .where(eq(payments.id, payment.id));
      await openDiscrepancy(tx, payment, 'amount_mismatch', {
        expected: payment.amount,
        received: result.amount,
        currency: result.currency,
      });
      return 'amount_mismatch';
    }

    await tx
      .update(payments)
      .set({
        status: 'confirmed',
        failureReason: null,
        confirmedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(payments.id, payment.id));

    // R18 : la commande était déjà réglée par un autre paiement.
    if (order.status === 'paid' || order.status === 'refunded' || order.status === 'needs_review') {
      await openDiscrepancy(tx, payment, 'duplicate_payment', { orderStatus: order.status });
      return 'duplicate_payment';
    }

    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
      .orderBy(asc(orderItems.categoryId));

    if (order.status === 'pending') {
      // Les billets étaient réservés : réservé → vendu.
      for (const item of items) {
        await tx
          .update(ticketCategories)
          .set({
            quantityReserved: sql`${ticketCategories.quantityReserved} - ${item.quantity}`,
            quantitySold: sql`${ticketCategories.quantitySold} + ${item.quantity}`,
            updatedAt: sql`now()`,
          })
          .where(eq(ticketCategories.id, item.categoryId));
      }
      await issue(tx, order, items);
      return 'confirmed';
    }

    // R17 : paiement arrivé après la libération de la réservation. On reprend le stock
    // d'un coup (tout ou rien) ; sinon la commande passe « à traiter » avec un écart.
    const retaken = await tx
      .transaction(async (savepoint) => {
        for (const item of items) {
          const [taken] = await savepoint
            .update(ticketCategories)
            .set({
              quantitySold: sql`${ticketCategories.quantitySold} + ${item.quantity}`,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(ticketCategories.id, item.categoryId),
                sql`${ticketCategories.quantityTotal} - ${ticketCategories.quantitySold} - ${ticketCategories.quantityReserved} >= ${item.quantity}`,
              ),
            )
            .returning({ id: ticketCategories.id });
          if (!taken) throw new StockLost();
        }
        return true;
      })
      .catch((error: unknown) => {
        if (error instanceof StockLost) return false;
        throw error;
      });
    if (retaken) {
      await issue(tx, order, items);
      return 'late_confirmed';
    }
    await tx
      .update(orders)
      .set({ status: 'needs_review', updatedAt: sql`now()` })
      .where(eq(orders.id, order.id));
    await openDiscrepancy(tx, payment, 'late_payment', { previousStatus: order.status });
    return 'needs_review';
  });
}

class StockLost extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Billets, versement, commande payée (R14, R21, R23). Les autres paiements en attente de la
// commande sont abandonnés : s'ils sont confirmés quand même, c'est un double paiement.
async function issue(tx: Tx, order: OrderRow, items: Array<typeof orderItems.$inferSelect>) {
  await tx
    .update(orders)
    .set({ status: 'paid', paidAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(orders.id, order.id));
  await tx
    .update(payments)
    .set({ status: 'failed', failureReason: 'superseded', updatedAt: sql`now()` })
    .where(and(eq(payments.orderId, order.id), eq(payments.status, 'pending')));
  const rows = items.flatMap((item) =>
    Array.from({ length: item.quantity }, (_, index) => ({
      orderId: order.id,
      orderItemId: item.id,
      eventId: order.eventId,
      categoryId: item.categoryId,
      buyerId: order.buyerId,
      ordinal: index + 1,
    })),
  );
  await tx.insert(tickets).values(rows).onConflictDoNothing();

  // Mesure du parcours (§8) écrite ici plutôt que par le navigateur : une confirmation
  // n'est comptée qu'une fois, avec la session anonyme qui a lancé le paiement.
  const [initiated] = await tx
    .select({ anonSessionId: funnelEvents.anonSessionId })
    .from(funnelEvents)
    .where(and(eq(funnelEvents.orderId, order.id), eq(funnelEvents.type, 'payment_initiated')))
    .orderBy(desc(funnelEvents.occurredAt))
    .limit(1);
  if (initiated) {
    await tx.insert(funnelEvents).values({
      anonSessionId: initiated.anonSessionId,
      eventId: order.eventId,
      orderId: order.id,
      type: 'payment_confirmed',
    });
  }

  // R21 et R33 : versement retenu si l'organisateur ou l'événement est suspendu.
  const [owner] = await tx
    .select({
      organizerId: organizers.id,
      organizerStatus: organizers.status,
      eventStatus: events.status,
      method: organizers.payoutMethod,
      destination: organizers.payoutDestination,
    })
    .from(events)
    .innerJoin(organizers, eq(organizers.id, events.organizerId))
    .where(eq(events.id, order.eventId));
  const held =
    owner!.organizerStatus === 'suspended' ||
    owner!.eventStatus === 'suspended' ||
    !owner!.method ||
    !owner!.destination;
  await tx
    .insert(payouts)
    .values({
      organizerId: owner!.organizerId,
      orderId: order.id,
      amount: order.payoutTotal,
      currency: order.currency,
      method: owner!.method ?? 'none',
      destination: owner!.destination ?? '',
      status: held ? 'held' : 'pending',
    })
    .onConflictDoNothing();

  // R14 : envoi du billet mis en file dans la même transaction (R32).
  await queueTicketEmail(tx, order);
}

async function openDiscrepancy(
  tx: Tx,
  payment: PaymentRow,
  kind: 'amount_mismatch' | 'duplicate_payment' | 'late_payment',
  details: Record<string, unknown>,
) {
  const [existing] = await tx
    .select({ id: discrepancies.id })
    .from(discrepancies)
    .where(
      and(
        eq(discrepancies.paymentId, payment.id),
        eq(discrepancies.kind, kind),
        ne(discrepancies.status, 'resolved'),
      ),
    );
  if (existing) return;
  await tx.insert(discrepancies).values({
    paymentId: payment.id,
    providerRef: payment.providerRef,
    kind,
    details: { orderId: payment.orderId, amount: payment.amount, ...details },
  });
}

// Traitement d'une notification enregistrée (tâche de fond). Une notification au contenu
// illisible ou à la signature fausse est close sans rien changer.
export async function processNotification(
  db: Db,
  port: PaymentPort,
  notificationId: string,
): Promise<void> {
  const [event] = await db
    .select()
    .from(paymentWebhookEvents)
    .where(eq(paymentWebhookEvents.id, notificationId));
  if (!event || event.processedAt) return;
  let outcome: string;
  if (!event.signatureValid) {
    outcome = 'invalid_signature';
  } else {
    const result = port.readNotification(event.payload);
    outcome = result ? await applyProviderResult(db, port.name, result) : 'unreadable';
    // Paiement pas encore connu (notification arrivée avant la fin du démarrage) :
    // laissée ouverte, reprise par la tâche de rattrapage.
    if (outcome === 'unknown_payment') {
      await db
        .update(paymentWebhookEvents)
        .set({ outcome })
        .where(eq(paymentWebhookEvents.id, event.id));
      return;
    }
  }
  await db
    .update(paymentWebhookEvents)
    .set({ outcome, processedAt: sql`now()` })
    .where(eq(paymentWebhookEvents.id, event.id));
}
