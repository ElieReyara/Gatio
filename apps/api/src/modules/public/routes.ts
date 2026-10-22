import {
  CURRENCY,
  errorResponseSchema,
  publicEventListSchema,
  publicEventQuerySchema,
  publicEventSchema,
  type PublicEvent,
  type PublicEventSummary,
} from '@gatio/shared';
import { and, asc, eq, gt, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { events, organizers, ticketCategories } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { categoryAvailability, effectiveSaleEnd } from './availability.js';

type EventRow = typeof events.$inferSelect;
type CategoryRow = typeof ticketCategories.$inferSelect;

// Pages publiques (contrat §6.2). La liste ne montre que les événements publiés à venir
// (R34 : ni annulés ni reportés) ; la page d'un événement reporté ou annulé reste
// accessible par son lien, avec son bandeau. Brouillons et suspendus : introuvables (R33).
const VISIBLE_BY_LINK = ['published', 'postponed', 'cancelled'] as const;

export const publicRoutes =
  (db: Db): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/events',
      {
        schema: {
          querystring: publicEventQuerySchema,
          response: { 200: publicEventListSchema, 400: errorResponseSchema },
        },
      },
      async (request) => {
        const { city, type, from, to, q, limit } = request.query;
        const cursor = decodeCursor(request.query.cursor);
        const rows = await db
          .select({ event: events })
          .from(events)
          .innerJoin(organizers, eq(organizers.id, events.organizerId))
          .where(
            and(
              eq(events.status, 'published'),
              // R33 : un organisateur suspendu disparaît du site avec ses événements.
              eq(organizers.status, 'active'),
              gte(events.startsAt, sql`now()`),
              city ? eq(events.city, city) : undefined,
              type ? eq(events.eventType, type) : undefined,
              from ? gte(events.startsAt, new Date(from)) : undefined,
              to ? lte(events.startsAt, new Date(to)) : undefined,
              q
                ? ilike(events.title, `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
                : undefined,
              cursor
                ? or(
                    gt(sql`date_trunc('milliseconds', ${events.startsAt})`, cursor.startsAt),
                    and(
                      eq(sql`date_trunc('milliseconds', ${events.startsAt})`, cursor.startsAt),
                      gt(events.id, cursor.id),
                    ),
                  )
                : undefined,
            ),
          )
          // Tri sur la même valeur que le curseur (milliseconde) : aucun événement sauté.
          .orderBy(asc(sql`date_trunc('milliseconds', ${events.startsAt})`), asc(events.id))
          .limit(limit + 1)
          .then((result) => result.map(({ event }) => event));
        const page = rows.slice(0, limit);
        const prices = await minPrices(
          db,
          page.map((row) => row.id),
        );
        const last = page.at(-1);
        return {
          items: page.map((row) => summary(row, prices.get(row.id) ?? null)),
          nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
        };
      },
    );

    app.get(
      '/events/:slug',
      {
        schema: {
          params: z.object({ slug: z.string().regex(/^[a-z0-9]{4,32}$/) }),
          response: { 200: publicEventSchema, 400: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request): Promise<PublicEvent> => {
        const [row] = await db
          .select({ event: events, organizerName: organizers.displayName })
          .from(events)
          .innerJoin(organizers, eq(organizers.id, events.organizerId))
          .where(
            and(
              eq(events.slug, request.params.slug),
              inArray(events.status, [...VISIBLE_BY_LINK]),
              eq(organizers.status, 'active'),
            ),
          );
        if (!row) throw new AppError(404, 'NOT_FOUND', 'Événement introuvable.');
        const categories = await db
          .select()
          .from(ticketCategories)
          .where(
            and(eq(ticketCategories.eventId, row.event.id), isNull(ticketCategories.archivedAt)),
          )
          .orderBy(asc(ticketCategories.position), asc(ticketCategories.createdAt));
        const now = new Date();
        const sellable = categories.filter(
          (category) => publicCategory(category, row.event, now).availability === 'available',
        );
        return {
          ...summary(row.event, minOf(sellable)),
          description: row.event.description,
          status: row.event.status,
          organizerName: row.organizerName,
          categories: categories.map((category) => publicCategory(category, row.event, now)),
        };
      },
    );
  };

function publicCategory(category: CategoryRow, event: EventRow, now: Date) {
  return {
    id: category.id,
    name: category.name,
    priceAmount: category.priceAmount,
    currency: category.currency,
    saleStartsAt: category.saleStartsAt?.toISOString() ?? null,
    saleEndsAt: effectiveSaleEnd(category, event.startsAt).toISOString(),
    // R12 : seul un événement publié vend. Reporté ou annulé : aucune catégorie n'est
    // « disponible », quelle que soit sa période (l'écran affiche « Vente arrêtée »).
    availability:
      event.status === 'published'
        ? categoryAvailability(category, event.startsAt, now)
        : ('ended' as const),
  };
}

function summary(row: EventRow, minPriceAmount: number | null): PublicEventSummary {
  return {
    slug: row.slug,
    title: row.title,
    eventType: row.eventType,
    city: row.city,
    venue: row.venue,
    startsAt: row.startsAt.toISOString(),
    imageUrl: row.imageKey ? `/api/v1/media/${row.imageKey}` : null,
    minPriceAmount,
    currency: CURRENCY,
  };
}

function minOf(categories: CategoryRow[]): number | null {
  return categories.length > 0
    ? Math.min(...categories.map((category) => category.priceAmount))
    : null;
}

// « À partir de » : seulement les catégories actuellement en vente.
async function minPrices(db: Db, eventIds: string[]): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(ticketCategories)
    .innerJoin(events, eq(events.id, ticketCategories.eventId))
    .where(and(inArray(ticketCategories.eventId, eventIds), isNull(ticketCategories.archivedAt)));
  const now = new Date();
  const result = new Map<string, number>();
  for (const { ticket_categories: category, events: event } of rows) {
    if (categoryAvailability(category, event.startsAt, now) !== 'available') continue;
    const current = result.get(event.id);
    if (current === undefined || category.priceAmount < current)
      result.set(event.id, category.priceAmount);
  }
  return result;
}

function encodeCursor(row: EventRow): string {
  return Buffer.from(`${row.startsAt.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { startsAt: Date; id: string } | null {
  if (!cursor) return null;
  const [startsAt, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!startsAt || !id || Number.isNaN(Date.parse(startsAt)) || !z.uuid().safeParse(id).success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Curseur invalide.');
  }
  return { startsAt: new Date(startsAt), id };
}
