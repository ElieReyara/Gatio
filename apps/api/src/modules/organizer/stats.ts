import { CURRENCY, errorResponseSchema, eventStatsSchema } from '@gatio/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { orderItems, orders, ticketCategories } from '../../db/schema.js';
import { writeAudit } from '../../lib/audit.js';
import { toCsv } from '../../lib/csv.js';
import { requireOrganizer } from '../identity/auth.js';
import { ownedEvent } from './routes.js';

const idParams = z.object({ id: z.uuid() });
const errors = { 401: errorResponseSchema, 404: errorResponseSchema };

// Commandes payées de l'événement : seule source des « vendus », des montants et de l'export
// (une commande remboursée plus tard, R20, en sortira d'elle-même).
const paidOfEvent = (eventId: string) =>
  and(eq(orders.eventId, eventId), eq(orders.status, 'paid'));

// Tableau de bord (maquette O6) : vendus et montants tirés des commandes payées ; « restants »
// = encore en vente (total moins vendus et réservations en cours, compteurs de la catégorie).
export async function eventStats(db: Db, eventId: string) {
  const [categories, soldRows, [totals]] = await Promise.all([
    db
      .select({
        id: ticketCategories.id,
        name: ticketCategories.name,
        total: ticketCategories.quantityTotal,
        counted: ticketCategories.quantitySold,
        reserved: ticketCategories.quantityReserved,
        archivedAt: ticketCategories.archivedAt,
      })
      .from(ticketCategories)
      .where(eq(ticketCategories.eventId, eventId))
      .orderBy(asc(ticketCategories.position), asc(ticketCategories.createdAt)),
    db
      .select({
        categoryId: orderItems.categoryId,
        sold: sql<number>`sum(${orderItems.quantity})`.mapWith(Number),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(paidOfEvent(eventId))
      .groupBy(orderItems.categoryId),
    db
      .select({
        paid: sql<number>`coalesce(sum(${orders.totalAmount}), 0)`.mapWith(Number),
        payout: sql<number>`coalesce(sum(${orders.payoutTotal}), 0)`.mapWith(Number),
      })
      .from(orders)
      .where(paidOfEvent(eventId)),
  ]);
  const soldBy = new Map(soldRows.map((row) => [row.categoryId, row.sold]));
  // Une catégorie archivée sans vente n'a plus rien à montrer.
  const shown = categories
    .map((category) => ({ ...category, sold: soldBy.get(category.id) ?? 0 }))
    .filter((category) => !category.archivedAt || category.sold > 0);
  return {
    sold: shown.reduce((sum, category) => sum + category.sold, 0),
    total: shown.reduce(
      (sum, category) => sum + (category.archivedAt ? category.sold : category.total),
      0,
    ),
    paidAmount: totals?.paid ?? 0,
    payoutAmount: totals?.payout ?? 0,
    currency: CURRENCY,
    categories: shown.map((category) => ({
      id: category.id,
      name: category.name,
      sold: category.sold,
      remaining: category.archivedAt
        ? 0
        : Math.max(0, category.total - category.counted - category.reserved),
      archived: category.archivedAt !== null,
    })),
  };
}

// « 66 12 34 56 » : numéros du Tchad seulement (R30) ; sans « + » en tête, la cellule n'est
// pas prise pour une formule et reste lisible.
function nationalPhone(e164: string): string {
  const match = /^\+235(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  return match ? match.slice(1).join(' ') : e164;
}

// Heure du Tchad (UTC+1), triable : « 2026-11-03 19:42 ».
function chadDateTime(date: Date): string {
  return new Date(date.getTime() + 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

// Colonnes à valider au PC-12 (données personnelles). L'email saisi à l'achat n'est pas
// vérifié (une faute de frappe désignerait un tiers) : il n'est pas exporté.
export const BUYERS_CSV_HEADER = [
  'Référence',
  'Nom',
  'Téléphone',
  'Billets',
  'Montant payé (FCFA)',
  'Payée le',
];

export async function buyersCsv(db: Db, eventId: string) {
  const paid = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      name: orders.contactName,
      phone: orders.contactPhone,
      total: orders.totalAmount,
      paidAt: orders.paidAt,
    })
    .from(orders)
    .where(paidOfEvent(eventId))
    .orderBy(asc(orders.paidAt));
  // Une seule requête pour toutes les lignes, dans l'ordre des catégories de l'événement.
  const lines = await db
    .select({
      orderId: orderItems.orderId,
      quantity: orderItems.quantity,
      category: ticketCategories.name,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(ticketCategories, eq(ticketCategories.id, orderItems.categoryId))
    .where(paidOfEvent(eventId))
    .orderBy(asc(ticketCategories.position), asc(ticketCategories.createdAt));
  const tickets = new Map<string, string[]>();
  for (const line of lines) {
    tickets.set(line.orderId, [
      ...(tickets.get(line.orderId) ?? []),
      `${line.quantity} × ${line.category}`,
    ]);
  }
  return {
    count: paid.length,
    csv: toCsv([
      BUYERS_CSV_HEADER,
      ...paid.map((order) => [
        order.reference,
        order.name,
        nationalPhone(order.phone),
        (tickets.get(order.id) ?? []).join(', '),
        order.total,
        order.paidAt ? chadDateTime(order.paidAt) : null,
      ]),
    ]),
  };
}

// Contrat §6.4 : chiffres de l'événement et export des acheteurs (S4, S5).
export const organizerStatsRoutes =
  ({ db, secureCookies }: { db: Db; secureCookies: boolean }): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', requireOrganizer(db, secureCookies));

    app.get(
      '/organizer/events/:id/stats',
      { schema: { params: idParams, response: { 200: eventStatsSchema, ...errors } } },
      async (request) => {
        const event = await ownedEvent(db, request.organizer!.organizerId, request.params.id);
        return eventStats(db, event.id);
      },
    );

    // Données personnelles des acheteurs : chaque export est tracé (qui, quand, combien).
    app.get(
      '/organizer/events/:id/buyers.csv',
      {
        // Pas de route HEAD automatique : elle produirait l'export et sa trace d'audit.
        exposeHeadRoute: false,
        schema: { params: idParams, response: { 200: z.string(), ...errors } },
      },
      async (request, reply) => {
        const event = await ownedEvent(db, request.organizer!.organizerId, request.params.id);
        const { csv, count } = await buyersCsv(db, event.id);
        await writeAudit(db, {
          actorUserId: request.organizer!.userId,
          action: 'event.buyers_export',
          entityType: 'event',
          entityId: event.id,
          before: null,
          after: { rows: count },
          ip: request.ip,
        });
        reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="acheteurs-${event.slug}.csv"`)
          .header('cache-control', 'no-store');
        return csv;
      },
    );
  };
