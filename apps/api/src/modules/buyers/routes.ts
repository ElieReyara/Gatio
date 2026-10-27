import {
  errorResponseSchema,
  myTicketsSchema,
  OTP_LOCKED,
  otpRequestSchema,
  otpVerifySchema,
  type MyTickets,
  type MyTicketsEvent,
} from '@gatio/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import {
  buyers,
  events,
  orderItems,
  orders,
  outboundMessages,
  ticketCategories,
  tickets,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { limits } from '../../lib/limits.js';
import { consumeLimit, ipSubject } from '../../lib/rate-limit.js';
import { maskPhone, serializeError } from '../../lib/redact.js';
import { createBuyerSession, revokeSession } from '../identity/sessions.js';
import type { SmsPort } from '../sms/port.js';
import { limitPdfDownloads, sendTicketPdf } from '../tickets/routes.js';
import type { TicketSigner } from '../tickets/signing.js';
import { currentBuyer, requireBuyer, setBuyerCookie } from './auth.js';
import { checkOtp, createOtp, isOtpLocked, otpSmsText } from './otp.js';

export type BuyerDependencies = {
  db: Db;
  sms: SmsPort;
  otpSecret: string;
  signer: TicketSigner;
  secureCookies: boolean;
};

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
};

const locked = () =>
  new AppError(429, 'RATE_LIMITED', 'Trop d’essais. Réessayez dans 15 minutes.', {
    reason: OTP_LOCKED,
  });

// Compte acheteur (contrat §6.3, maquettes B6 et B7).
export const buyerRoutes =
  ({ db, sms, otpSecret, signer, secureCookies }: BuyerDependencies): FastifyPluginAsyncZod =>
  async (app) => {
    // R31 : réponse identique que le numéro ait un compte ou non (le code est envoyé dans
    // tous les cas : il sert aussi avant la première réservation, n° 71).
    app.post(
      '/auth/buyer/otp/request',
      { schema: { body: otpRequestSchema, response: { 202: z.object({}), ...errors } } },
      async (request, reply) => {
        const { phone } = request.body;
        if (await isOtpLocked(db, phone)) throw locked();
        const allowed =
          (await consumeLimit(db, `otp_send_ip:${ipSubject(request.ip)}`, limits.otpSendPerIp)) &&
          (await consumeLimit(db, `otp_send_min:${phone}`, limits.otpSendPerPhoneMinute)) &&
          (await consumeLimit(db, `otp_send:${phone}`, limits.otpSendPerPhone)) &&
          (await consumeLimit(db, `otp_send_day:${phone}`, limits.otpSendPerPhoneDay)) &&
          (await consumeLimit(db, 'otp_send_global', limits.otpSendGlobalDay));
        if (!allowed) {
          throw new AppError(429, 'RATE_LIMITED', 'Trop de codes demandés. Réessayez plus tard.');
        }
        const code = await createOtp(db, otpSecret, phone, request.ip);
        await sendOtp(db, sms, phone, code, request.log);
        return reply.code(202).send({});
      },
    );

    app.post(
      '/auth/buyer/otp/verify',
      { schema: { body: otpVerifySchema, response: { 200: z.object({}), ...errors } } },
      async (request, reply) => {
        const ip = ipSubject(request.ip);
        if (!(await consumeLimit(db, `otp_verify_ip:${ip}`, limits.otpVerifyPerIp))) {
          throw new AppError(429, 'RATE_LIMITED', 'Trop d’essais. Réessayez plus tard.');
        }
        const { phone, code } = request.body;
        const result = await checkOtp(db, otpSecret, phone, code);
        if (!result.ok) {
          if (result.locked) throw locked();
          throw new AppError(400, 'TOKEN_INVALID', 'Ce code est incorrect ou expiré.', {
            attemptsLeft: result.attemptsLeft,
          });
        }
        // Le numéro est prouvé (modèle : phone_verified_at, première connexion par code) ;
        // le compte est créé s'il n'existe pas encore (achat suivant, « Mes billets » vide).
        const [buyer] = await db
          .insert(buyers)
          .values({ phoneE164: phone, name: '', phoneVerifiedAt: sql`now()` })
          .onConflictDoUpdate({
            target: buyers.phoneE164,
            set: {
              phoneVerifiedAt: sql`coalesce(${buyers.phoneVerifiedAt}, now())`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: buyers.id });
        // Une session précédente de ce navigateur (autre numéro, peut-être) est fermée.
        const previous = await currentBuyer(db, request, null, secureCookies);
        if (previous) await revokeSession(db, previous.sessionId);
        setBuyerCookie(
          reply,
          await createBuyerSession(db, buyer!.id, request.headers['user-agent']),
          secureCookies,
        );
        return reply.code(200).send({});
      },
    );

    // B7 : seulement les billets du compte de la session (appartenance vérifiée ici).
    app.get(
      '/me/tickets',
      { schema: { response: { 200: myTicketsSchema, ...errors } } },
      async (request, reply): Promise<MyTickets> => {
        void reply.header('cache-control', 'no-store');
        const buyer = await requireBuyer(db, request, reply, secureCookies);
        return { items: await loadMyTickets(db, buyer.buyerId), nextCursor: null };
      },
    );

    app.get(
      '/me/tickets/:ticketId/pdf',
      { schema: { params: z.object({ ticketId: z.uuid() }) } },
      async (request, reply) => {
        const buyer = await requireBuyer(db, request, reply, secureCookies);
        await limitPdfDownloads(db, request.ip);
        const [owned] = await db
          .select({ order: orders })
          .from(tickets)
          .innerJoin(orders, eq(orders.id, tickets.orderId))
          .where(and(eq(tickets.id, request.params.ticketId), eq(tickets.buyerId, buyer.buyerId)));
        return sendTicketPdf(db, signer, reply, owned?.order ?? null, request.params.ticketId);
      },
    );
  };

// Le code est enregistré avant l'envoi ; un échec d'envoi n'est pas révélé (réponse
// identique), il reste visible dans outbound_messages et les journaux.
async function sendOtp(db: Db, sms: SmsPort, phone: string, code: string, log: FastifyBaseLogger) {
  const [message] = await db
    .insert(outboundMessages)
    .values({ channel: 'sms', purpose: 'otp', recipient: phone })
    .returning({ id: outboundMessages.id });
  try {
    const { providerRef } = await sms.send({ to: phone, text: otpSmsText(code) });
    await db
      .update(outboundMessages)
      .set({ status: 'sent', providerRef, attempts: 1, updatedAt: sql`now()` })
      .where(eq(outboundMessages.id, message!.id));
  } catch (error) {
    await db
      .update(outboundMessages)
      .set({ status: 'failed', attempts: 1, updatedAt: sql`now()` })
      .where(eq(outboundMessages.id, message!.id));
    log.error({ err: serializeError(error), to: maskPhone(phone) }, 'sms send failed');
  }
}

// Billets du compte, par événement (à venir d'abord, puis passés) et par commande, dans
// l'ordre des PDF (« billet 1 sur 2 »).
async function loadMyTickets(db: Db, buyerId: string): Promise<MyTicketsEvent[]> {
  const rows = await db
    .select({
      ticketId: tickets.id,
      status: tickets.status,
      categoryName: ticketCategories.name,
      orderId: orders.id,
      reference: orders.reference,
      event: {
        id: events.id,
        slug: events.slug,
        title: events.title,
        startsAt: events.startsAt,
        venue: events.venue,
        city: events.city,
        status: events.status,
      },
      // Passé : le lendemain du début (le billet sert encore pendant la soirée). Reporté :
      // l'ancienne date ne compte plus, le billet reste valable (revue de la tranche 8).
      past: sql<boolean>`${events.status} <> 'postponed' and ${events.startsAt} < now() - interval '1 day'`,
    })
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .innerJoin(events, eq(events.id, tickets.eventId))
    .innerJoin(ticketCategories, eq(ticketCategories.id, tickets.categoryId))
    .innerJoin(orderItems, eq(orderItems.id, tickets.orderItemId))
    .where(eq(tickets.buyerId, buyerId))
    .orderBy(
      asc(events.startsAt),
      asc(orders.createdAt),
      asc(ticketCategories.position),
      asc(orderItems.id),
      asc(tickets.ordinal),
    );

  const byEvent = new Map<string, MyTicketsEvent>();
  for (const row of rows) {
    let group = byEvent.get(row.event.id);
    if (!group) {
      group = {
        event: {
          slug: row.event.slug,
          title: row.event.title,
          startsAt: row.event.startsAt.toISOString(),
          venue: row.event.venue,
          city: row.event.city,
          status: row.event.status,
        },
        past: row.past,
        orders: [],
      };
      byEvent.set(row.event.id, group);
    }
    let order = group.orders.find((candidate) => candidate.orderId === row.orderId);
    if (!order) {
      order = { orderId: row.orderId, reference: row.reference, lines: [], tickets: [] };
      group.orders.push(order);
    }
    order.tickets.push({
      id: row.ticketId,
      index: order.tickets.length + 1,
      categoryName: row.categoryName,
      status: row.status,
    });
    const line = order.lines.find((candidate) => candidate.categoryName === row.categoryName);
    if (line) line.quantity += 1;
    else order.lines.push({ categoryName: row.categoryName, quantity: 1 });
  }
  const groups = [...byEvent.values()];
  return [
    ...groups.filter((group) => !group.past),
    ...groups.filter((group) => group.past).reverse(),
  ];
}
