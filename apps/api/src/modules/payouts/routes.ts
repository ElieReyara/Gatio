import {
  errorResponseSchema,
  payoutMethods,
  payoutsOverviewSchema,
  type PayoutMethod,
  type PayoutStatus,
} from '@gatio/shared';
import { and, count, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Db } from '../../db/client.js';
import { events, orders, payouts } from '../../db/schema.js';
import { requireOrganizer } from '../identity/auth.js';
import { maskPayoutNumber } from '../identity/profile.js';

const errors = { 401: errorResponseSchema };
// Ce qui demande une action d'abord : échoués, retenus, en attente, puis envoyés.
const STATUS_ORDER: PayoutStatus[] = ['failed', 'held', 'pending', 'sent'];
const toDate = (value: string | Date | null) => (value ? new Date(value) : null);

// Reversements de l'organisateur (maquette O9) : R21 envoie un versement par commande payée ;
// l'écran les présente par événement et par statut (écart E4 du PC-00, conception suivie).
export async function payoutsOverview(db: Db, organizerId: string) {
  const [destinations, rows] = await Promise.all([
    db
      .selectDistinct({ method: payouts.method, destination: payouts.destination })
      .from(payouts)
      .where(and(eq(payouts.organizerId, organizerId), eq(payouts.status, 'pending'))),
    db
      .select({
        eventId: events.id,
        title: events.title,
        status: payouts.status,
        amount: sql<number>`sum(${payouts.amount})`.mapWith(Number),
        count: count(),
        lastSentAt: sql<Date | null>`max(${payouts.sentAt})`.mapWith(toDate),
        lastChangedAt: sql<Date | null>`max(${payouts.updatedAt})`.mapWith(toDate),
      })
      .from(payouts)
      .innerJoin(orders, eq(orders.id, payouts.orderId))
      .innerJoin(events, eq(events.id, orders.eventId))
      .where(and(eq(payouts.organizerId, organizerId)))
      .groupBy(events.id, events.title, payouts.status),
  ]);
  const latest = (row: (typeof rows)[number]) =>
    (row.lastSentAt ?? row.lastChangedAt)?.getTime() ?? 0;
  const groups = [...rows]
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || latest(b) - latest(a),
    )
    .map((row) => ({
      eventId: row.eventId,
      title: row.title,
      status: row.status,
      amount: row.amount,
      count: row.count,
      date:
        row.status === 'sent'
          ? (row.lastSentAt?.toISOString() ?? null)
          : row.status === 'failed'
            ? (row.lastChangedAt?.toISOString() ?? null)
            : null,
    }));
  const [only] = destinations.length === 1 ? destinations : [];
  return {
    pendingTo:
      only && payoutMethods.includes(only.method as PayoutMethod)
        ? {
            method: only.method as PayoutMethod,
            maskedNumber: maskPayoutNumber(only.destination),
          }
        : null,
    pendingAmount: groups
      .filter((group) => group.status === 'pending')
      .reduce((sum, group) => sum + group.amount, 0),
    hasFailed: groups.some((group) => group.status === 'failed'),
    groups,
  };
}

export const payoutRoutes =
  ({ db, secureCookies }: { db: Db; secureCookies: boolean }): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', requireOrganizer(db, secureCookies));
    app.get(
      '/organizer/payouts',
      { schema: { response: { 200: payoutsOverviewSchema, ...errors } } },
      async (request) => payoutsOverview(db, request.organizer!.organizerId),
    );
  };
