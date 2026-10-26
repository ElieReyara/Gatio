import {
  errorResponseSchema,
  funnelEventInputSchema,
  nextActionSchema,
  orderCreatedSchema,
  orderCreateSchema,
  orderSchema,
  type Order,
  type PaymentMethod,
} from '@gatio/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import {
  events,
  funnelEvents,
  orderItems,
  orders,
  outboundMessages,
  payments,
  ticketCategories,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { limits } from '../../lib/limits.js';
import { consumeLimit } from '../../lib/rate-limit.js';
import { orderByToken } from './access.js';
import { loadOrderTickets } from '../tickets/documents.js';
import type { TicketSigner } from '../tickets/signing.js';
import { createOrder, replayOrder } from './reservation.js';

const errors = {
  400: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  429: errorResponseSchema,
};

// Commande et réservation (contrat §6.2).
export const orderRoutes =
  (db: Db, signer: TicketSigner): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/orders',
      {
        schema: {
          body: orderCreateSchema,
          response: { 201: orderCreatedSchema, 200: orderCreatedSchema, ...errors },
        },
      },
      async (request, reply) => {
        // Rejeu sûr (§6.1) : la clé est obligatoire ; elle n'est unique que pour ce client.
        const key = request.headers['idempotency-key'];
        if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'En-tête Idempotency-Key manquant ou invalide.',
            {
              reason: 'idempotency_key_required',
            },
          );
        }
        // Le quota compte aussi les rejeus : une clé ne se devine pas par essais répétés.
        if (!(await consumeLimit(db, `order_ip:${request.ip}`, limits.orderPerIp))) {
          throw new AppError(429, 'RATE_LIMITED', 'Trop de commandes. Réessayez plus tard.', {
            reason: 'too_many_orders',
          });
        }
        const idempotency = { key, scope: `ip:${request.ip}` };
        const replay = await replayOrder(db, idempotency, request.body);
        if (replay) return reply.code(200).send(replay);
        try {
          return reply.code(201).send(await createOrder(db, request.body, idempotency));
        } catch (error) {
          // Deux envois simultanés avec la même clé : le second rejoue le premier.
          if (isIdempotencyConflict(error)) {
            const again = await replayOrder(db, idempotency, request.body);
            if (again) return reply.code(200).send(again);
          }
          throw error;
        }
      },
    );

    // Accès « commande » : jeton de commande en en-tête (la session acheteur arrive en
    // tranche 8). Commande introuvable ou jeton faux : même réponse.
    app.get(
      '/orders/:id',
      {
        schema: {
          params: z.object({ id: z.uuid() }),
          response: { 200: orderSchema, ...errors },
        },
      },
      async (request, reply): Promise<Order> => {
        // Réponse propre à un jeton : jamais gardée par un cache intermédiaire.
        void reply.header('cache-control', 'no-store');
        const found = await orderByToken(db, request.params.id, request.headers['x-order-token']);
        if (!found) throw new AppError(404, 'NOT_FOUND', 'Commande introuvable.');
        const [row] = await db
          .select({
            order: orders,
            event: events,
            remaining: sql<number>`greatest(0, floor(extract(epoch from (${orders.reservationExpiresAt} - now()))))::int`,
          })
          .from(orders)
          .innerJoin(events, eq(events.id, orders.eventId))
          .where(eq(orders.id, found.id));
        if (!row) throw new AppError(404, 'NOT_FOUND', 'Commande introuvable.');
        const lines = await db
          .select({ item: orderItems, categoryName: ticketCategories.name })
          .from(orderItems)
          .innerJoin(ticketCategories, eq(ticketCategories.id, orderItems.categoryId))
          .where(eq(orderItems.orderId, row.order.id))
          .orderBy(asc(ticketCategories.position));
        const [payment] = await db
          .select()
          .from(payments)
          .where(eq(payments.orderId, row.order.id))
          .orderBy(desc(payments.createdAt))
          .limit(1);
        const parsedNext = nextActionSchema.safeParse(payment?.nextAction);
        // R23 : billets seulement pour une commande payée ; QR signé à la lecture (la
        // signature Ed25519 est déterministe, rien n'est stocké).
        const issued =
          row.order.status === 'paid' ? await loadOrderTickets(db, signer, row.order.id) : [];
        const [email] = await db
          .select({ status: outboundMessages.status })
          .from(outboundMessages)
          .where(
            and(eq(outboundMessages.orderId, row.order.id), eq(outboundMessages.purpose, 'ticket')),
          )
          .orderBy(desc(outboundMessages.createdAt))
          .limit(1);
        return {
          id: row.order.id,
          reference: row.order.reference,
          status: row.order.status,
          event: {
            slug: row.event.slug,
            title: row.event.title,
            startsAt: row.event.startsAt.toISOString(),
            venue: row.event.venue,
            city: row.event.city,
          },
          items: lines.map(({ item, categoryName }) => ({
            categoryName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.unitPrice * item.quantity,
          })),
          total: row.order.totalAmount,
          currency: row.order.currency,
          reservationExpiresAt: row.order.reservationExpiresAt.toISOString(),
          remainingSeconds: row.order.status === 'pending' ? row.remaining : 0,
          payment: payment
            ? {
                method: payment.method as PaymentMethod,
                status: payment.status,
                failureReason: payment.failureReason,
                next: payment.status === 'pending' && parsedNext.success ? parsedNext.data : null,
              }
            : null,
          tickets: issued.map((ticket) => ({
            id: ticket.ticketId,
            categoryName: ticket.categoryName,
            status: ticket.status,
            qr: ticket.qr,
          })),
          ticketEmail: (email?.status as 'queued' | 'sent' | 'failed' | undefined) ?? null,
        };
      },
    );

    // Mesures du parcours (§8) : aucune donnée personnelle, identifiant de session anonyme.
    app.post(
      '/funnel-events',
      { schema: { body: funnelEventInputSchema, response: { 202: z.object({}), ...errors } } },
      async (request, reply) => {
        if (await consumeLimit(db, `funnel_ip:${request.ip}`, limits.funnelPerIp)) {
          const [event] = await db
            .select({ id: events.id })
            .from(events)
            .where(
              and(
                eq(events.slug, request.body.eventSlug),
                inArray(events.status, ['published', 'postponed', 'cancelled']),
              ),
            );
          // Commande gardée seulement si elle est bien de cet événement.
          const [order] =
            event && request.body.orderId
              ? await db
                  .select({ id: orders.id })
                  .from(orders)
                  .where(and(eq(orders.id, request.body.orderId), eq(orders.eventId, event.id)))
              : [];
          if (event) {
            await db.insert(funnelEvents).values({
              anonSessionId: request.body.anonSessionId,
              eventId: event.id,
              orderId: order?.id ?? null,
              type: request.body.type,
            });
          }
        }
        return reply.code(202).send({});
      },
    );
  };

function isIdempotencyConflict(error: unknown): boolean {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const { code, constraint } = cause as { code?: string; constraint?: string };
  return code === '23505' && constraint === 'orders_idempotency_idx';
}
