import { formatDateTime } from '@gatio/shared';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { PgBoss } from 'pg-boss';
import type { Db, Tx } from '../../db/client.js';
import { buyers, emailVerifications, events, orders, outboundMessages } from '../../db/schema.js';
import { newToken } from '../../lib/tokens.js';
import type { EmailMessage, EmailPort } from '../email/port.js';
import { ticketEmail } from '../email/templates.js';
import { loadOrderTickets } from './documents.js';
import { renderTicketPdf } from './pdf.js';
import type { TicketSigner } from './signing.js';

// Lien de validation de l'email (R32) : durée non fixée par les sources, 7 jours.
export const EMAIL_VERIFICATION_DAYS = 7;

// Relances espacées (minutes) ; au-delà, le message est abandonné et signalé au journal.
const RETRY_MINUTES = [1, 5, 15, 30, 60, 120, 240];

/**
 * R14 : l'envoi du billet est mis en file dans la transaction de confirmation. Seule une
 * ligne de suivi est écrite ici ; les liens secrets sont créés au moment de l'envoi, pour
 * qu'aucun jeton ne soit jamais gardé en clair.
 * Destinataire : l'email saisi à l'achat ; à défaut, l'email validé du compte d'un numéro
 * vérifié (B9, journal de bord n° 73). Une adresse n'est rattachée au compte que par une
 * commande passée avec le numéro prouvé (voir prepareNext) : un tiers qui achète avec le
 * numéro d'un autre ne peut pas y rattacher la sienne (revue de la tranche 7).
 */
export async function queueTicketEmail(tx: Tx, order: typeof orders.$inferSelect) {
  let recipient = order.contactEmail;
  if (!recipient) {
    const [buyer] = await tx
      .select({ email: buyers.email })
      .from(buyers)
      .where(and(eq(buyers.id, order.buyerId), isNotNull(buyers.phoneVerifiedAt)));
    recipient = buyer?.email ?? null;
  }
  if (!recipient) return;
  await tx.insert(outboundMessages).values({
    channel: 'email',
    purpose: 'ticket',
    recipient,
    orderId: order.id,
  });
}

export type TicketEmailDeps = {
  email: EmailPort;
  signer: TicketSigner;
  webUrl: string;
  log?: Pick<FastifyBaseLogger, 'error' | 'warn'>;
};

type Prepared = { messageId: string; build: () => Promise<EmailMessage> };

/**
 * Envoie les emails de billets en file, en deux temps :
 * 1. transaction courte : le message est réservé (prochain essai repoussé, essai compté) et
 *    les jetons de ses liens enregistrés ;
 * 2. envoi hors transaction, puis message marqué « envoyé ».
 * Un email parti dont la confirmation se perd garde donc des liens valables ; il sera
 * renvoyé au prochain essai (doublon rare), jamais en boucle chaque minute.
 */
export async function sendQueuedTicketEmails(db: Db, deps: TicketEmailDeps, batchSize = 20) {
  // Trop d'essais ou plus d'un jour : abandonné, avec une trace.
  const abandoned = await db
    .update(outboundMessages)
    .set({ status: 'failed', updatedAt: sql`now()` })
    .where(
      and(
        eq(outboundMessages.status, 'queued'),
        eq(outboundMessages.purpose, 'ticket'),
        sql`${outboundMessages.nextAttemptAt} <= now()`,
        sql`(${outboundMessages.attempts} >= ${RETRY_MINUTES.length + 1} or ${outboundMessages.createdAt} <= now() - interval '1 day')`,
      ),
    )
    .returning({ id: outboundMessages.id, orderId: outboundMessages.orderId });
  for (const message of abandoned) {
    deps.log?.warn({ messageId: message.id, orderId: message.orderId }, 'ticket email abandoned');
  }

  for (let sent = 0; sent < batchSize; sent++) {
    let prepared: Prepared | 'skipped' | null;
    try {
      prepared = await db.transaction((tx) => prepareNext(tx, deps));
    } catch (error) {
      deps.log?.error({ err: error }, 'ticket email preparation failed');
      return;
    }
    if (!prepared) return;
    if (prepared === 'skipped') continue;
    try {
      await deps.email.send(await prepared.build());
      await db
        .update(outboundMessages)
        .set({ status: 'sent', updatedAt: sql`now()` })
        .where(eq(outboundMessages.id, prepared.messageId));
    } catch (error) {
      deps.log?.error(
        { err: error, messageId: prepared.messageId },
        'ticket email failed (retried later)',
      );
    }
  }
}

async function prepareNext(tx: Tx, deps: TicketEmailDeps): Promise<Prepared | 'skipped' | null> {
  // Le plus ancien message dû ; ceux qu'un autre passage prépare sont sautés.
  const [message] = await tx
    .select()
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.status, 'queued'),
        eq(outboundMessages.purpose, 'ticket'),
        sql`${outboundMessages.nextAttemptAt} <= now()`,
      ),
    )
    .orderBy(outboundMessages.nextAttemptAt)
    .limit(1)
    .for('update', { skipLocked: true });
  if (!message) return null;
  const delay = RETRY_MINUTES[Math.min(message.attempts, RETRY_MINUTES.length - 1)]!;
  await tx
    .update(outboundMessages)
    .set({
      attempts: sql`${outboundMessages.attempts} + 1`,
      nextAttemptAt: sql`now() + make_interval(mins => ${delay})`,
      updatedAt: sql`now()`,
    })
    .where(eq(outboundMessages.id, message.id));

  const [row] = message.orderId
    ? await tx
        .select({ order: orders, event: events, buyerEmail: buyers.email })
        .from(orders)
        .innerJoin(events, eq(events.id, orders.eventId))
        .innerJoin(buyers, eq(buyers.id, orders.buyerId))
        .where(eq(orders.id, message.orderId))
    : [];
  const documents = row
    ? (await loadOrderTickets(tx, deps.signer, row.order.id)).filter(
        (ticket) => ticket.status !== 'void',
      )
    : [];
  if (!row || !message.recipient || documents.length === 0) {
    // Rien à envoyer (billets annulés, destinataire effacé) : fermé tout de suite.
    await tx
      .update(outboundMessages)
      .set({ status: 'failed', updatedAt: sql`now()` })
      .where(eq(outboundMessages.id, message.id));
    return 'skipped';
  }

  // Jeton propre au lien de l'email (§3.5) : seule son empreinte est gardée.
  const access = newToken();
  await tx
    .update(orders)
    .set({ emailAccessTokenHash: access.hash, updatedAt: sql`now()` })
    .where(eq(orders.id, row.order.id));
  // Lien de validation (R32) seulement pour une commande passée avec le numéro prouvé
  // (n° 73), et si l'adresse n'est pas déjà celle validée du compte.
  let verifyLink: string | null = null;
  if (
    row.order.phoneVerified &&
    row.buyerEmail?.toLowerCase() !== message.recipient.toLowerCase()
  ) {
    const verification = newToken();
    await tx.insert(emailVerifications).values({
      buyerId: row.order.buyerId,
      email: message.recipient,
      tokenHash: verification.hash,
      expiresAt: sql`now() + make_interval(days => ${EMAIL_VERIFICATION_DAYS})`,
    });
    verifyLink = `${deps.webUrl}/email/confirmer#t=${verification.token}`;
  }

  const recipient = message.recipient;
  const { order, event } = row;
  return {
    messageId: message.id,
    // PDF rendus après la transaction : aucun verrou gardé pendant le rendu et l'envoi.
    build: async () => {
      const attachments = await Promise.all(
        documents.map(async (document) => ({
          filename: `billet-${document.reference}-${document.index}.pdf`,
          contentType: 'application/pdf',
          content: await renderTicketPdf(document),
        })),
      );
      const when = formatDateTime(event.startsAt.toISOString()).replace(', ', ' à ');
      return ticketEmail({
        to: recipient,
        name: order.contactName,
        eventTitle: event.title,
        when:
          event.status === 'postponed'
            ? 'date à confirmer'
            : `le ${when.charAt(0).toLowerCase()}${when.slice(1)}`,
        place: `${event.venue}, ${event.city}`,
        reference: order.reference,
        count: documents.length,
        orderLink: (index) => `${deps.webUrl}/commande/${order.id}#t=${access.token}&b=${index}`,
        verifyLink,
        attachments,
      });
    },
  };
}

const TICKET_EMAIL_QUEUE = 'tickets.email';

export async function startTicketEmailJobs(boss: PgBoss, db: Db, deps: TicketEmailDeps) {
  await boss.createQueue(TICKET_EMAIL_QUEUE);
  await boss.schedule(TICKET_EMAIL_QUEUE, '* * * * *');
  await boss.work(TICKET_EMAIL_QUEUE, async () => {
    await sendQueuedTicketEmails(db, deps);
  });
  // Après une confirmation, sans attendre le passage de la minute suivante.
  return async () => {
    await boss.send(TICKET_EMAIL_QUEUE, {}, { singletonKey: 'kick', singletonSeconds: 5 });
  };
}
