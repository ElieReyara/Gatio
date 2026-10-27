import { randomBytes } from 'node:crypto';
import { CURRENCY, RESERVATION_MINUTES, type OrderCreate } from '@gatio/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.js';
import { buyers, events, orderItems, orders, ticketCategories } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { MAX_PENDING_ORDERS_PER_PHONE } from '../../lib/limits.js';
import { newToken } from '../../lib/tokens.js';
import { computeFee } from '../fees/compute.js';
import { resolveFeeRule } from '../fees/rules.js';
import { categoryAvailability } from '../public/availability.js';

export type CreatedOrder = {
  orderId: string;
  reference: string;
  total: number;
  currency: string;
  reservationExpiresAt: string;
  orderToken: string;
};

/**
 * Crée la commande et réserve les billets en une transaction (R5, R8, R10, R12, R30).
 * Chaque catégorie est réservée par un seul UPDATE conditionnel (stock libre, statut de
 * l'événement, période de vente) : aucune lecture puis écriture, aucune survente.
 */
export async function createOrder(
  db: Db,
  input: OrderCreate,
  idempotency: { key: string; scope: string },
  phoneVerified = false,
): Promise<CreatedOrder> {
  // Interblocage ou collision de référence (très rares) : la transaction est rejouée.
  for (let attempt = 1; ; attempt++) {
    try {
      return await createOrderOnce(db, input, idempotency, phoneVerified);
    } catch (error) {
      if (attempt >= 3 || !isRetryable(error)) throw error;
    }
  }
}

function isRetryable(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string; constraint?: string } }).cause ?? error;
  const { code, constraint } = cause as { code?: string; constraint?: string };
  return (
    code === '40P01' ||
    code === '40001' ||
    (code === '23505' && constraint === 'orders_reference_unique')
  );
}

async function createOrderOnce(
  db: Db,
  input: OrderCreate,
  idempotency: { key: string; scope: string },
  phoneVerified: boolean,
): Promise<CreatedOrder> {
  const { token, hash } = newToken();
  const order = await db.transaction(async (tx) => {
    // Lecture partagée de l'événement : une annulation ou un report attend la fin des
    // réservations en cours, et toute réservation suivante voit le nouveau statut.
    const [event] = await tx
      .select()
      .from(events)
      .where(eq(events.slug, input.eventSlug))
      .for('share');
    // Brouillon ou suspendu : même réponse qu'un lien inconnu (rien n'est public).
    if (!event || event.status === 'draft' || event.status === 'suspended') {
      throw new AppError(404, 'NOT_FOUND', 'Événement introuvable.');
    }
    if (event.status !== 'published') {
      throw new AppError(409, 'EVENT_NOT_ON_SALE', 'Cet événement n’est pas en vente.', {
        status: event.status,
      });
    }

    // Un numéro = un compte (R30) ; le nom le plus récent est gardé. L'acheteur est écrit
    // avant le comptage : son verrou fait passer les commandes d'un même numéro une par
    // une, et le plafond R10 ne se contourne pas par des envois simultanés.
    const { phone, name, email } = input.contact;
    const [buyer] = await tx
      .insert(buyers)
      .values({ phoneE164: phone, name })
      .onConflictDoUpdate({ target: buyers.phoneE164, set: { name, updatedAt: sql`now()` } })
      .returning({ id: buyers.id });

    const [pending] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.contactPhone, phone),
          eq(orders.status, 'pending'),
          gt(orders.reservationExpiresAt, sql`now()`),
        ),
      );
    if ((pending?.count ?? 0) >= MAX_PENDING_ORDERS_PER_PHONE) {
      throw new AppError(429, 'RATE_LIMITED', 'Trop de réservations en attente pour ce numéro.', {
        reason: 'too_many_pending',
      });
    }

    // Catégories toujours verrouillées dans le même ordre : deux commandes de plusieurs
    // catégories ne peuvent pas s'attendre mutuellement.
    const lines = [];
    for (const item of [...input.items].sort((a, b) => (a.categoryId < b.categoryId ? -1 : 1))) {
      const category = await reserve(tx, event, item.categoryId, item.quantity);
      const rule = await resolveFeeRule(tx, {
        organizerId: event.organizerId,
        eventId: event.id,
        categoryId: category.id,
      });
      const fee = computeFee(category.priceAmount, rule.params, rule.currency);
      lines.push({ category, quantity: item.quantity, fee, ruleId: rule.id });
    }

    const total = lines.reduce((sum, line) => sum + line.fee.price * line.quantity, 0);
    const feeTotal = lines.reduce((sum, line) => sum + line.fee.feeAmount * line.quantity, 0);
    const [created] = await tx
      .insert(orders)
      .values({
        reference: await uniqueReference(tx),
        eventId: event.id,
        buyerId: buyer!.id,
        contactName: name,
        contactPhone: phone,
        contactEmail: email ?? null,
        currency: CURRENCY,
        totalAmount: total,
        feeTotal,
        payoutTotal: total - feeTotal,
        accessTokenHash: hash,
        idempotencyKey: idempotency.key,
        idempotencyScope: idempotency.scope,
        reservationExpiresAt: sql`now() + make_interval(mins => ${RESERVATION_MINUTES})`,
        phoneVerified,
      })
      .returning();
    // Les trois montants sont figés par ligne (R5) : changer une règle ou un prix ensuite
    // ne change jamais cette commande.
    await tx.insert(orderItems).values(
      lines.map((line) => ({
        orderId: created!.id,
        categoryId: line.category.id,
        quantity: line.quantity,
        unitPrice: line.fee.price,
        unitFee: line.fee.feeAmount,
        unitPayout: line.fee.payoutAmount,
        feeRuleId: line.ruleId,
      })),
    );
    return created!;
  });
  return {
    orderId: order.id,
    reference: order.reference,
    total: order.totalAmount,
    currency: order.currency,
    reservationExpiresAt: order.reservationExpiresAt.toISOString(),
    orderToken: token,
  };
}

// Rejouer la création avec la même clé (réponse perdue) : même commande, nouveau jeton,
// puisque l'ancien n'a pas atteint le navigateur. Seulement pour la même demande et tant
// que la réservation court.
export async function replayOrder(
  db: Db,
  idempotency: { key: string; scope: string },
  input: OrderCreate,
): Promise<CreatedOrder | null> {
  const [existing] = await db
    .select({
      order: orders,
      slug: events.slug,
      active: sql<boolean>`${orders.reservationExpiresAt} > now()`,
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(
      and(
        eq(orders.idempotencyScope, idempotency.scope),
        eq(orders.idempotencyKey, idempotency.key),
      ),
    );
  if (!existing) return null;
  const lines = await db
    .select({ categoryId: orderItems.categoryId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, existing.order.id));
  const signature = (items: Array<{ categoryId: string; quantity: number }>) =>
    items
      .map((item) => `${item.categoryId}:${item.quantity}`)
      .sort()
      .join(',');
  if (
    existing.slug !== input.eventSlug ||
    existing.order.contactPhone !== input.contact.phone ||
    signature(lines) !== signature(input.items)
  ) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Cette clé a déjà servi pour une autre demande.', {
      reason: 'idempotency_key_reused',
    });
  }
  if (existing.order.status !== 'pending' || !existing.active) {
    throw new AppError(409, 'RESERVATION_EXPIRED', 'Cette réservation a expiré.', {
      orderId: existing.order.id,
    });
  }
  const { token, hash } = newToken();
  const [order] = await db
    .update(orders)
    .set({ accessTokenHash: hash, updatedAt: sql`now()` })
    .where(and(eq(orders.id, existing.order.id), eq(orders.status, 'pending')))
    .returning();
  if (!order) {
    throw new AppError(409, 'RESERVATION_EXPIRED', 'Cette réservation a expiré.', {
      orderId: existing.order.id,
    });
  }
  return {
    orderId: order.id,
    reference: order.reference,
    total: order.totalAmount,
    currency: order.currency,
    reservationExpiresAt: order.reservationExpiresAt.toISOString(),
    orderToken: token,
  };
}

type EventRow = typeof events.$inferSelect;

async function reserve(tx: Tx, event: EventRow, categoryId: string, quantity: number) {
  // R8 + R12 dans la même instruction : stock libre, catégorie active, période ouverte.
  const [category] = await tx
    .update(ticketCategories)
    .set({
      quantityReserved: sql`${ticketCategories.quantityReserved} + ${quantity}`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(ticketCategories.id, categoryId),
        eq(ticketCategories.eventId, event.id),
        sql`${ticketCategories.archivedAt} is null`,
        sql`(${ticketCategories.saleStartsAt} is null or ${ticketCategories.saleStartsAt} <= now())`,
        sql`now() < coalesce(${ticketCategories.saleEndsAt}, ${event.startsAt.toISOString()}::timestamptz)`,
        sql`${ticketCategories.quantityTotal} - ${ticketCategories.quantitySold} - ${ticketCategories.quantityReserved} >= ${quantity}`,
      ),
    )
    .returning();
  if (category) return category;
  throw await refusal(tx, event, categoryId);
}

// Aucune ligne réservée : on dit pourquoi, sans rien modifier.
async function refusal(tx: Tx, event: EventRow, categoryId: string): Promise<AppError> {
  const [category] = await tx
    .select()
    .from(ticketCategories)
    .where(and(eq(ticketCategories.id, categoryId), eq(ticketCategories.eventId, event.id)));
  if (!category) {
    return new AppError(400, 'VALIDATION_ERROR', 'Catégorie inconnue pour cet événement.', {
      reason: 'unknown_category',
      categoryId,
    });
  }
  if (category.archivedAt) {
    return new AppError(409, 'CATEGORY_NOT_ON_SALE', 'Cette catégorie n’est plus en vente.', {
      reason: 'archived',
      categoryId,
    });
  }
  // Même horloge que la réservation : celle de la base.
  const { rows } = await tx.execute<{ now: string }>(sql`select now() as now`);
  const availability = categoryAvailability(category, event.startsAt, new Date(rows[0]!.now));
  if (availability === 'upcoming' || availability === 'ended') {
    return new AppError(
      409,
      'CATEGORY_NOT_ON_SALE',
      'Cette catégorie n’est pas en vente en ce moment.',
      {
        reason: availability === 'upcoming' ? 'not_open' : 'ended',
        categoryId,
        saleStartsAt: category.saleStartsAt?.toISOString() ?? null,
      },
    );
  }
  return new AppError(
    409,
    'STOCK_INSUFFICIENT',
    'Il ne reste pas assez de billets dans cette catégorie.',
    {
      categoryId,
      remaining: Math.max(
        0,
        category.quantityTotal - category.quantitySold - category.quantityReserved,
      ),
    },
  );
}

// Référence lisible pour le support : « GT- » + 6 caractères sans 0, O, 1 ni I.
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
async function uniqueReference(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from(
      randomBytes(6),
      (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length],
    ).join('');
    const reference = `GT-${code}`;
    const [existing] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.reference, reference));
    if (!existing) return reference;
  }
  throw new Error('could not generate a unique order reference');
}
