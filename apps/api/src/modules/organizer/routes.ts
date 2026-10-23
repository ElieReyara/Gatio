import { randomBytes } from 'node:crypto';
import {
  categoryCreateSchema,
  categorySchema,
  categoryUpdateSchema,
  CURRENCY,
  errorResponseSchema,
  eventCreateSchema,
  eventUpdateSchema,
  feePreviewRequestSchema,
  feePreviewSchema,
  IMAGE_MAX_BYTES,
  organizerEventDetailSchema,
  organizerEventListSchema,
  organizerEventSchema,
  organizerProfileSchema,
  payoutAccountSchema,
  profileUpdateSchema,
  type Category,
  type OrganizerEvent,
} from '@gatio/shared';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db, DbOrTx } from '../../db/client.js';
import { events, organizers, ticketCategories } from '../../db/schema.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { computeFee } from '../fees/compute.js';
import { resolveFeeRule } from '../fees/rules.js';
import { requireOrganizer } from '../identity/auth.js';
import { loadProfile } from '../identity/profile.js';
import { toEventImage } from '../media/images.js';
import type { StoragePort } from '../media/storage.js';

export type OrganizerDependencies = { db: Db; storage: StoragePort; secureCookies: boolean };

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  404: errorResponseSchema,
};

type EventRow = typeof events.$inferSelect;
type CategoryRow = typeof ticketCategories.$inferSelect;

export const organizerRoutes =
  ({ db, storage, secureCookies }: OrganizerDependencies): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', requireOrganizer(db, secureCookies));
    const me = (request: { organizer?: { organizerId: string; userId: string } }) =>
      request.organizer!;

    // Image envoyée telle quelle (JPEG, PNG ou WebP) : pas de multipart.
    app.addContentTypeParser(
      /^image\/(jpeg|png|webp)$/,
      { parseAs: 'buffer', bodyLimit: IMAGE_MAX_BYTES },
      (_request, body, done) => done(null, body),
    );

    // Profil (maquette O2).
    app.put(
      '/organizer/profile',
      {
        schema: { body: profileUpdateSchema, response: { 200: organizerProfileSchema, ...errors } },
      },
      async (request) => {
        const { displayName, description, contactPhone } = request.body;
        await db
          .update(organizers)
          .set({
            displayName,
            description: description ?? null,
            contactPhone: contactPhone ?? null,
            updatedAt: sql`now()`,
          })
          .where(eq(organizers.id, me(request).organizerId));
        return loadProfile(db, me(request).userId);
      },
    );

    // Moyen de versement, obligatoire avant de publier (R21).
    app.put(
      '/organizer/payout-account',
      {
        schema: { body: payoutAccountSchema, response: { 200: organizerProfileSchema, ...errors } },
      },
      async (request) => {
        await db
          .update(organizers)
          .set({
            payoutMethod: request.body.method,
            payoutDestination: request.body.number,
            updatedAt: sql`now()`,
          })
          .where(eq(organizers.id, me(request).organizerId));
        return loadProfile(db, me(request).userId);
      },
    );

    // Aperçu des frais (R7) : même calcul que celui figé à la commande.
    app.post(
      '/organizer/fee-preview',
      { schema: { body: feePreviewRequestSchema, response: { 200: feePreviewSchema, ...errors } } },
      async (request) => {
        const { price, eventId } = request.body;
        if (eventId) await ownedEvent(db, me(request).organizerId, eventId);
        const rule = await resolveFeeRule(db, {
          organizerId: me(request).organizerId,
          ...(eventId ? { eventId } : {}),
        });
        return computeFee(price, rule.params, rule.currency);
      },
    );

    app.post(
      '/organizer/events',
      { schema: { body: eventCreateSchema, response: { 201: organizerEventSchema, ...errors } } },
      async (request, reply) => {
        const body = request.body;
        assertFuture(body.startsAt);
        const row = await insertWithUniqueSlug(db, {
          organizerId: me(request).organizerId,
          title: body.title,
          description: body.description,
          eventType: body.eventType,
          city: body.city,
          venue: body.venue,
          startsAt: new Date(body.startsAt),
          capacity: body.capacity,
        });
        return reply.code(201).send(serializeEvent(row));
      },
    );

    app.get(
      '/organizer/events',
      {
        schema: { querystring: listQuery, response: { 200: organizerEventListSchema, ...errors } },
      },
      async (request) => {
        const { limit } = request.query;
        const cursor = decodeCursor(request.query.cursor);
        const rows = await db
          .select()
          .from(events)
          .where(
            and(
              eq(events.organizerId, me(request).organizerId),
              cursor
                ? or(
                    // Curseur à la milliseconde, comme la base comparée (sinon un événement
                    // créé dans la même milliseconde serait sauté).
                    lt(sql`date_trunc('milliseconds', ${events.createdAt})`, cursor.createdAt),
                    and(
                      eq(sql`date_trunc('milliseconds', ${events.createdAt})`, cursor.createdAt),
                      lt(events.id, cursor.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(events.createdAt), desc(events.id))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return {
          items: page.map(serializeEvent),
          nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
        };
      },
    );

    app.get(
      '/organizer/events/:id',
      { schema: { params: idParams, response: { 200: organizerEventDetailSchema, ...errors } } },
      async (request) =>
        eventDetail(db, await ownedEvent(db, me(request).organizerId, request.params.id)),
    );

    app.patch(
      '/organizer/events/:id',
      {
        schema: {
          params: idParams,
          body: eventUpdateSchema,
          response: { 200: organizerEventDetailSchema, ...errors },
        },
      },
      async (request) => {
        const body = request.body;
        const updated = await db.transaction(async (tx) => {
          const event = await ownedEvent(tx, me(request).organizerId, request.params.id, true);
          assertNotCancelled(event);
          const dateChanged =
            body.startsAt !== undefined &&
            new Date(body.startsAt).getTime() !== event.startsAt.getTime();
          if (dateChanged && body.startsAt) {
            // R34 : la date d'un événement en vente ne change que par un report (bandeau,
            // ventes arrêtées, trace) ; en brouillon ou reporté, elle se modifie librement.
            if (event.status === 'published') {
              throw new AppError(
                400,
                'VALIDATION_ERROR',
                'Reportez l’événement pour changer sa date.',
                {
                  field: 'startsAt',
                  reason: 'postpone_required',
                },
              );
            }
            assertFuture(body.startsAt);
            await assertCategoryPeriodsStillValid(tx, event.id, new Date(body.startsAt));
          }
          if (body.capacity !== undefined) {
            const used = await allocatedQuantity(tx, event.id);
            if (body.capacity < used) {
              throw new AppError(
                400,
                'VALIDATION_ERROR',
                'Capacité inférieure aux billets déjà prévus.',
                {
                  field: 'capacity',
                  reason: 'below_categories',
                  allocated: used,
                },
              );
            }
          }
          const [row] = await tx
            .update(events)
            .set({
              ...(body.title !== undefined ? { title: body.title } : {}),
              ...(body.description !== undefined ? { description: body.description } : {}),
              ...(body.eventType !== undefined ? { eventType: body.eventType } : {}),
              ...(body.city !== undefined ? { city: body.city } : {}),
              ...(body.venue !== undefined ? { venue: body.venue } : {}),
              ...(body.startsAt !== undefined ? { startsAt: new Date(body.startsAt) } : {}),
              ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
              updatedAt: sql`now()`,
            })
            .where(eq(events.id, event.id))
            .returning();
          if (dateChanged && event.status === 'postponed') {
            await writeAudit(tx, auditEntry(request, 'event.reschedule', event, row!));
          }
          return row!;
        });
        return eventDetail(db, updated);
      },
    );

    app.post(
      '/organizer/events/:id/image',
      { schema: { params: idParams, response: { 200: organizerEventSchema, ...errors } } },
      async (request) => {
        const event = await ownedEvent(db, me(request).organizerId, request.params.id);
        assertNotCancelled(event);
        const image = Buffer.isBuffer(request.body) ? await toEventImage(request.body) : null;
        if (!image) {
          throw new AppError(400, 'VALIDATION_ERROR', 'Image illisible.', {
            field: 'image',
            reason: 'invalid_image',
          });
        }
        const key = `events/${event.id}/${randomBytes(16).toString('base64url')}.webp`;
        await storage.put(key, image);
        const [row] = await db
          .update(events)
          .set({ imageKey: key, updatedAt: sql`now()` })
          .where(eq(events.id, event.id))
          .returning();
        return serializeEvent(row!);
      },
    );

    app.post(
      '/organizer/events/:id/categories',
      {
        schema: {
          params: idParams,
          body: categoryCreateSchema,
          response: { 201: categorySchema, ...errors },
        },
      },
      async (request, reply) => {
        const body = request.body;
        const category = await db.transaction(async (tx) => {
          // Verrou de l'événement : deux créations simultanées ne dépassent pas la capacité (R11).
          const event = await ownedEvent(tx, me(request).organizerId, request.params.id, true);
          assertNotCancelled(event);
          assertSalePeriod(body.saleStartsAt ?? null, body.saleEndsAt ?? null, event.startsAt);
          await assertPriceNotTooLow(tx, event, null, body.priceAmount);
          const used = await allocatedQuantity(tx, event.id);
          assertCapacity(event.capacity, used, body.quantityTotal);
          const [position] = await tx
            .select({ next: sql<number>`coalesce(max(${ticketCategories.position}), -1) + 1` })
            .from(ticketCategories)
            .where(eq(ticketCategories.eventId, event.id));
          const [row] = await tx
            .insert(ticketCategories)
            .values({
              eventId: event.id,
              name: body.name,
              priceAmount: body.priceAmount,
              currency: CURRENCY,
              quantityTotal: body.quantityTotal,
              position: Number(position?.next ?? 0),
              saleStartsAt: body.saleStartsAt ? new Date(body.saleStartsAt) : null,
              saleEndsAt: body.saleEndsAt ? new Date(body.saleEndsAt) : null,
            })
            .returning();
          return serializeCategory(tx, event, row!);
        });
        return reply.code(201).send(category);
      },
    );

    app.patch(
      '/organizer/categories/:id',
      {
        schema: {
          params: idParams,
          body: categoryUpdateSchema,
          response: { 200: categorySchema, ...errors },
        },
      },
      async (request) => {
        const body = request.body;
        return db.transaction(async (tx) => {
          const { event, category } = await ownedCategory(
            tx,
            me(request).organizerId,
            request.params.id,
          );
          if (category.archivedAt) {
            throw new AppError(400, 'VALIDATION_ERROR', 'Catégorie archivée.', {
              reason: 'archived',
            });
          }
          const saleStartsAt =
            body.saleStartsAt !== undefined
              ? body.saleStartsAt
              : (category.saleStartsAt?.toISOString() ?? null);
          const saleEndsAt =
            body.saleEndsAt !== undefined
              ? body.saleEndsAt
              : (category.saleEndsAt?.toISOString() ?? null);
          assertSalePeriod(saleStartsAt, saleEndsAt, event.startsAt);
          if (body.priceAmount !== undefined) {
            await assertPriceNotTooLow(tx, event, category.id, body.priceAmount);
          }
          if (body.quantityTotal !== undefined) {
            const used = (await allocatedQuantity(tx, event.id)) - category.quantityTotal;
            assertCapacity(event.capacity, used, body.quantityTotal);
          }
          // R11 : jamais sous les billets vendus ou réservés ; condition vérifiée dans la
          // mise à jour elle-même (pas de lecture puis écriture).
          const [row] = await tx
            .update(ticketCategories)
            .set({
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.priceAmount !== undefined ? { priceAmount: body.priceAmount } : {}),
              ...(body.quantityTotal !== undefined ? { quantityTotal: body.quantityTotal } : {}),
              saleStartsAt: saleStartsAt ? new Date(saleStartsAt) : null,
              saleEndsAt: saleEndsAt ? new Date(saleEndsAt) : null,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(ticketCategories.id, category.id),
                body.quantityTotal !== undefined
                  ? sql`${ticketCategories.quantitySold} + ${ticketCategories.quantityReserved} <= ${body.quantityTotal}`
                  : undefined,
              ),
            )
            .returning();
          if (!row) {
            throw new AppError(
              400,
              'VALIDATION_ERROR',
              'Moins de billets que ceux déjà vendus ou réservés.',
              {
                field: 'quantityTotal',
                reason: 'below_sold',
              },
            );
          }
          return serializeCategory(tx, event, row);
        });
      },
    );

    // Publication, report et annulation (R34). Chaque passage est une mise à jour
    // conditionnelle sur le statut : deux demandes simultanées ne se contredisent pas.
    app.post(
      '/organizer/events/:id/publish',
      { schema: { params: idParams, response: { 200: organizerEventDetailSchema, ...errors } } },
      async (request) =>
        db.transaction(async (tx) => {
          const event = await ownedEvent(tx, me(request).organizerId, request.params.id, true);
          const [organizer] = await tx
            .select({ payoutMethod: organizers.payoutMethod })
            .from(organizers)
            .where(eq(organizers.id, event.organizerId));
          if (!organizer?.payoutMethod) {
            throw new AppError(
              400,
              'VALIDATION_ERROR',
              'Un moyen de versement est nécessaire pour publier.',
              {
                reason: 'payout_account_missing',
              },
            );
          }
          assertFuture(event.startsAt.toISOString());
          // Décision du responsable (PC-4) : pas de page publique sans billet à vendre.
          const [active] = await tx
            .select({ id: ticketCategories.id })
            .from(ticketCategories)
            .where(and(eq(ticketCategories.eventId, event.id), isNull(ticketCategories.archivedAt)))
            .limit(1);
          if (!active) {
            throw new AppError(
              400,
              'VALIDATION_ERROR',
              'Ajoutez au moins une catégorie de billets.',
              {
                reason: 'no_active_category',
              },
            );
          }
          const row = await changeStatus(tx, event, ['draft', 'postponed'], 'published');
          if (event.status === 'postponed') {
            await writeAudit(tx, auditEntry(request, 'event.republish', event, row));
          }
          return eventDetail(tx, row);
        }),
    );

    app.post(
      '/organizer/events/:id/unpublish',
      { schema: { params: idParams, response: { 200: organizerEventDetailSchema, ...errors } } },
      async (request) =>
        db.transaction(async (tx) => {
          const event = await ownedEvent(tx, me(request).organizerId, request.params.id, true);
          return eventDetail(tx, await changeStatus(tx, event, ['published'], 'draft'));
        }),
    );

    app.post(
      '/organizer/events/:id/postpone',
      { schema: { params: idParams, response: { 200: organizerEventDetailSchema, ...errors } } },
      async (request) =>
        db.transaction(async (tx) => {
          const event = await ownedEvent(tx, me(request).organizerId, request.params.id, true);
          const row = await changeStatus(tx, event, ['published'], 'postponed');
          await writeAudit(tx, auditEntry(request, 'event.postpone', event, row));
          return eventDetail(tx, row);
        }),
    );

    app.post(
      '/organizer/events/:id/cancel',
      { schema: { params: idParams, response: { 200: organizerEventDetailSchema, ...errors } } },
      async (request) =>
        db.transaction(async (tx) => {
          const event = await ownedEvent(tx, me(request).organizerId, request.params.id, true);
          const row = await changeStatus(tx, event, ['published', 'postponed'], 'cancelled');
          await writeAudit(tx, auditEntry(request, 'event.cancel', event, row));
          return eventDetail(tx, row);
        }),
    );

    // Remettre en vente une catégorie archivée (décision du responsable, PC-4 ; route
    // absente du contrat §6.4, signalée dans la référence d'API). La capacité est revérifiée.
    app.post(
      '/organizer/categories/:id/restore',
      { schema: { params: idParams, response: { 200: categorySchema, ...errors } } },
      async (request) =>
        db.transaction(async (tx) => {
          const { event, category } = await ownedCategory(
            tx,
            me(request).organizerId,
            request.params.id,
          );
          if (!category.archivedAt) return serializeCategory(tx, event, category);
          const allocated = await allocatedQuantity(tx, event.id);
          const alreadyCounted = category.quantitySold + category.quantityReserved;
          assertCapacity(event.capacity, allocated - alreadyCounted, category.quantityTotal);
          const [row] = await tx
            .update(ticketCategories)
            .set({ archivedAt: null, updatedAt: sql`now()` })
            .where(eq(ticketCategories.id, category.id))
            .returning();
          return serializeCategory(tx, event, row!);
        }),
    );

    // DELETE = archivage (contrat §6.4) : une catégorie n'est jamais supprimée (R11).
    app.delete(
      '/organizer/categories/:id',
      { schema: { params: idParams, response: { 200: categorySchema, ...errors } } },
      async (request) =>
        db.transaction(async (tx) => {
          const { event, category } = await ownedCategory(
            tx,
            me(request).organizerId,
            request.params.id,
          );
          const [row] = await tx
            .update(ticketCategories)
            .set({
              archivedAt: sql`coalesce(${ticketCategories.archivedAt}, now())`,
              updatedAt: sql`now()`,
            })
            .where(eq(ticketCategories.id, category.id))
            .returning();
          return serializeCategory(tx, event, row!);
        }),
    );
  };

type EventStatus = EventRow['status'];

async function changeStatus(db: DbOrTx, event: EventRow, from: EventStatus[], to: EventStatus) {
  const [row] = await db
    .update(events)
    .set({ status: to, updatedAt: sql`now()` })
    .where(and(eq(events.id, event.id), inArray(events.status, from)))
    .returning();
  if (!row) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Ce changement n’est pas possible pour cet événement.',
      {
        reason: 'invalid_status',
        status: event.status,
      },
    );
  }
  return row;
}

function assertNotCancelled(event: EventRow) {
  if (event.status === 'cancelled') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Cet événement est annulé : il ne peut plus être modifié.',
      {
        reason: 'event_cancelled',
      },
    );
  }
}

function auditEntry(
  request: { ip: string; organizer?: { userId: string } },
  action: string,
  before: EventRow,
  after: EventRow,
) {
  return {
    actorUserId: request.organizer!.userId,
    action,
    entityType: 'event',
    entityId: before.id,
    before: { status: before.status, startsAt: before.startsAt.toISOString() },
    after: { status: after.status, startsAt: after.startsAt.toISOString() },
    ip: request.ip,
  };
}

// S5 : un organisateur ne voit que ses événements ; un autre reçoit « introuvable ».
async function ownedEvent(
  db: DbOrTx,
  organizerId: string,
  eventId: string,
  lock = false,
): Promise<EventRow> {
  const query = db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizerId, organizerId)));
  const [event] = lock ? await query.for('update') : await query;
  if (!event) throw new AppError(404, 'NOT_FOUND', 'Événement introuvable.');
  return event;
}

// Ordre des verrous toujours le même (événement, puis catégorie) : aucun interblocage
// avec la création de catégorie, ni plus tard avec la réservation (tranche 5).
async function ownedCategory(db: DbOrTx, organizerId: string, categoryId: string) {
  const [found] = await db
    .select({ eventId: ticketCategories.eventId })
    .from(ticketCategories)
    .innerJoin(events, eq(events.id, ticketCategories.eventId))
    .where(and(eq(ticketCategories.id, categoryId), eq(events.organizerId, organizerId)));
  if (!found) throw new AppError(404, 'NOT_FOUND', 'Catégorie introuvable.');
  const event = await ownedEvent(db, organizerId, found.eventId, true);
  assertNotCancelled(event);
  const [category] = await db
    .select()
    .from(ticketCategories)
    .where(eq(ticketCategories.id, categoryId))
    .for('update');
  return { event, category: category! };
}

// Changer la date de l'événement déplace la fin de vente par défaut (R12) : une catégorie
// ne doit pas se retrouver avec une période impossible.
async function assertCategoryPeriodsStillValid(db: DbOrTx, eventId: string, newStartsAt: Date) {
  const rows = await db
    .select()
    .from(ticketCategories)
    .where(and(eq(ticketCategories.eventId, eventId), isNull(ticketCategories.archivedAt)));
  const conflicts = rows.filter((row) => {
    const start = row.saleStartsAt?.getTime() ?? null;
    const end = (row.saleEndsAt ?? newStartsAt).getTime();
    return start !== null && end <= start;
  });
  if (conflicts.length > 0) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Des périodes de vente deviendraient impossibles.',
      {
        field: 'startsAt',
        reason: 'sale_period_conflict',
        categories: conflicts.map((row) => row.name),
      },
    );
  }
}

// Billets prévus : quantités des catégories actives, et billets déjà vendus ou réservés
// des catégories archivées (ils restent dus aux acheteurs).
async function allocatedQuantity(db: DbOrTx, eventId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(case when ${ticketCategories.archivedAt} is null
        then ${ticketCategories.quantityTotal}
        else ${ticketCategories.quantitySold} + ${ticketCategories.quantityReserved} end), 0)`,
    })
    .from(ticketCategories)
    .where(eq(ticketCategories.eventId, eventId));
  return Number(row?.total ?? 0);
}

function assertCapacity(capacity: number, alreadyAllocated: number, requested: number) {
  if (alreadyAllocated + requested > capacity) {
    throw new AppError(400, 'VALIDATION_ERROR', 'La capacité de l’événement serait dépassée.', {
      field: 'quantityTotal',
      reason: 'capacity_exceeded',
      remaining: Math.max(0, capacity - alreadyAllocated),
    });
  }
}

async function assertPriceNotTooLow(
  db: DbOrTx,
  event: EventRow,
  categoryId: string | null,
  price: number,
) {
  const rule = await resolveFeeRule(db, {
    organizerId: event.organizerId,
    eventId: event.id,
    ...(categoryId ? { categoryId } : {}),
  });
  const fee = computeFee(price, rule.params, rule.currency);
  if (fee.priceTooLow) {
    throw new AppError(
      400,
      'PRICE_TOO_LOW',
      'Ce prix est trop bas : les frais dépasseraient ce que vous recevez.',
      {
        field: 'priceAmount',
        fee,
      },
    );
  }
}

// R12 : fin de vente par défaut = début de l'événement ; elle peut être postérieure.
function assertSalePeriod(startsAt: string | null, endsAt: string | null, eventStartsAt: Date) {
  const start = startsAt ? new Date(startsAt).getTime() : null;
  const end = endsAt ? new Date(endsAt).getTime() : eventStartsAt.getTime();
  if (start !== null && end <= start) {
    // Sans fin choisie, la vente s'arrête au début de l'événement : il faut choisir une fin.
    throw new AppError(400, 'VALIDATION_ERROR', 'La fin de la vente doit être après son début.', {
      field: 'saleEndsAt',
      reason: endsAt ? 'sale_period_invalid' : 'sale_end_required',
    });
  }
}

function assertFuture(startsAt: string) {
  if (new Date(startsAt).getTime() <= Date.now()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'La date doit être dans le futur.', {
      field: 'startsAt',
      reason: 'not_in_future',
    });
  }
}

// Adresse publique courte et aléatoire (contrat §6.1), sans caractères ambigus.
const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function newSlug(): string {
  return Array.from(randomBytes(8), (byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length]).join('');
}

async function insertWithUniqueSlug(db: Db, values: Omit<typeof events.$inferInsert, 'slug'>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await db
        .insert(events)
        .values({ ...values, slug: newSlug() })
        .returning();
      return row!;
    } catch (error) {
      const code =
        (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
      if (code !== '23505') throw error;
    }
  }
  throw new Error('could not generate a unique event slug');
}

function serializeEvent(row: EventRow): OrganizerEvent {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    eventType: row.eventType,
    city: row.city,
    venue: row.venue,
    startsAt: row.startsAt.toISOString(),
    capacity: row.capacity,
    status: row.status,
    imageUrl: row.imageKey ? `/api/v1/media/${row.imageKey}` : null,
  };
}

async function serializeCategory(db: DbOrTx, event: EventRow, row: CategoryRow): Promise<Category> {
  const rule = await resolveFeeRule(db, {
    organizerId: event.organizerId,
    eventId: event.id,
    categoryId: row.id,
  });
  return {
    id: row.id,
    name: row.name,
    priceAmount: row.priceAmount,
    currency: row.currency,
    quantityTotal: row.quantityTotal,
    quantitySold: row.quantitySold,
    quantityReserved: row.quantityReserved,
    saleStartsAt: row.saleStartsAt?.toISOString() ?? null,
    saleEndsAt: row.saleEndsAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    fee: computeFee(row.priceAmount, rule.params, rule.currency),
  };
}

async function eventDetail(db: DbOrTx, event: EventRow) {
  const rows = await db
    .select()
    .from(ticketCategories)
    .where(eq(ticketCategories.eventId, event.id))
    .orderBy(asc(ticketCategories.position), asc(ticketCategories.createdAt));
  const categories = [];
  for (const row of rows) categories.push(await serializeCategory(db, event, row));
  return { ...serializeEvent(event), categories };
}

function encodeCursor(row: EventRow): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt)) || !z.uuid().safeParse(id).success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Curseur invalide.');
  }
  return { createdAt: new Date(createdAt), id };
}
