import {
  errorResponseSchema,
  scanInviteCheckSchema,
  scanInviteInfoSchema,
  scanJoinSchema,
  scannerInviteCreatedSchema,
  scannerInviteListSchema,
  scannerListSchema,
  scanSessionSchema,
} from '@gatio/shared';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { events, organizers, scannerInvites, scannerSessions } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { limits } from '../../lib/limits.js';
import { consumeLimit, ipSubject } from '../../lib/rate-limit.js';
import { hashToken, newToken } from '../../lib/tokens.js';
import { requireOrganizer } from '../identity/auth.js';
import { ownedEvent } from '../organizer/routes.js';
import {
  CLOSED_STATUS,
  eventEnd,
  openScannerSession,
  requireScanner,
  scanEvent,
  setScanCookie,
  validSession,
} from './sessions.js';

const idParams = z.object({ id: z.uuid() });
const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
};

type EventRow = typeof events.$inferSelect;

function assertScannable(event: EventRow) {
  if (event.status === CLOSED_STATUS) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Cet événement n’est plus contrôlé.', {
      reason: 'event_closed',
    });
  }
  if (eventEnd(event.startsAt).getTime() <= Date.now()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Cet événement est terminé.', {
      reason: 'event_over',
    });
  }
}

const serializeInvite = (row: typeof scannerInvites.$inferSelect) => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  active: row.revokedAt === null && row.expiresAt.getTime() > Date.now(),
});

// Contrat §6.4 : liens d'invitation, contrôleurs, « scanner soi-même » (maquette O7).
export const scannerOrganizerRoutes =
  ({ db, secureCookies }: { db: Db; secureCookies: boolean }): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', requireOrganizer(db, secureCookies));
    const me = (request: { organizer?: { organizerId: string; userId: string } }) =>
      request.organizer!;

    app.post(
      '/organizer/events/:id/scanner-invites',
      { schema: { params: idParams, response: { 201: scannerInviteCreatedSchema, ...errors } } },
      async (request, reply) => {
        const event = await ownedEvent(db, me(request).organizerId, request.params.id);
        assertScannable(event);
        const { token, hash } = newToken();
        const [row] = await db
          .insert(scannerInvites)
          .values({
            eventId: event.id,
            tokenHash: hash,
            createdBy: me(request).userId,
            expiresAt: eventEnd(event.startsAt),
          })
          .returning();
        reply.code(201);
        return { invite: serializeInvite(row!), token };
      },
    );

    app.get(
      '/organizer/events/:id/scanner-invites',
      { schema: { params: idParams, response: { 200: scannerInviteListSchema, ...errors } } },
      async (request) => {
        const event = await ownedEvent(db, me(request).organizerId, request.params.id);
        const rows = await db
          .select()
          .from(scannerInvites)
          .where(eq(scannerInvites.eventId, event.id))
          .orderBy(desc(scannerInvites.createdAt));
        return { items: rows.map(serializeInvite) };
      },
    );

    app.delete(
      '/organizer/scanner-invites/:id',
      { schema: { params: idParams, response: { 204: z.null(), ...errors } } },
      async (request, reply) => {
        const [invite] = await db
          .select({ id: scannerInvites.id })
          .from(scannerInvites)
          .innerJoin(events, eq(events.id, scannerInvites.eventId))
          .where(
            and(
              eq(scannerInvites.id, request.params.id),
              eq(events.organizerId, me(request).organizerId),
            ),
          );
        if (!invite) throw new AppError(404, 'NOT_FOUND', 'Lien introuvable.');
        // R29 : désactiver le lien coupe aussi les sessions ouvertes par lui.
        await db.transaction(async (tx) => {
          await tx
            .update(scannerInvites)
            .set({ revokedAt: sql`coalesce(${scannerInvites.revokedAt}, now())` })
            .where(eq(scannerInvites.id, invite.id));
          await tx
            .update(scannerSessions)
            .set({ revokedAt: sql`now()` })
            .where(and(eq(scannerSessions.inviteId, invite.id), isNull(scannerSessions.revokedAt)));
        });
        return reply.code(204).send(null);
      },
    );

    app.get(
      '/organizer/events/:id/scanners',
      { schema: { params: idParams, response: { 200: scannerListSchema, ...errors } } },
      async (request) => {
        const event = await ownedEvent(db, me(request).organizerId, request.params.id);
        const rows = await db
          .select({
            id: scannerSessions.id,
            firstName: scannerSessions.firstName,
            inviteId: scannerSessions.inviteId,
            createdAt: scannerSessions.createdAt,
            lastSeenAt: scannerSessions.lastSeenAt,
          })
          .from(scannerSessions)
          .innerJoin(events, eq(events.id, scannerSessions.eventId))
          .leftJoin(scannerInvites, eq(scannerInvites.id, scannerSessions.inviteId))
          .where(and(eq(scannerSessions.eventId, event.id), validSession))
          .orderBy(scannerSessions.createdAt);
        return {
          items: rows.map((row) => ({
            id: row.id,
            firstName: row.firstName,
            joinedAt: row.createdAt.toISOString(),
            lastSeenAt: row.lastSeenAt.toISOString(),
            organizer: row.inviteId === null,
          })),
        };
      },
    );

    app.delete(
      '/organizer/scanner-sessions/:id',
      { schema: { params: idParams, response: { 204: z.null(), ...errors } } },
      async (request, reply) => {
        const [session] = await db
          .select({ id: scannerSessions.id })
          .from(scannerSessions)
          .innerJoin(events, eq(events.id, scannerSessions.eventId))
          .where(
            and(
              eq(scannerSessions.id, request.params.id),
              eq(events.organizerId, me(request).organizerId),
            ),
          );
        if (!session) throw new AppError(404, 'NOT_FOUND', 'Contrôleur introuvable.');
        await db
          .update(scannerSessions)
          .set({ revokedAt: sql`coalesce(${scannerSessions.revokedAt}, now())` })
          .where(eq(scannerSessions.id, session.id));
        return reply.code(204).send(null);
      },
    );

    // R29 : l'organisateur scanne avec sa propre session, sans invitation.
    app.post(
      '/organizer/events/:id/scanner-session',
      { schema: { params: idParams, response: { 201: scanSessionSchema, ...errors } } },
      async (request, reply) => {
        const event = await ownedEvent(db, me(request).organizerId, request.params.id);
        assertScannable(event);
        const [organizer] = await db
          .select({ displayName: organizers.displayName })
          .from(organizers)
          .where(eq(organizers.id, me(request).organizerId));
        const firstName = organizer?.displayName ?? '';
        const token = await openScannerSession(db, {
          eventId: event.id,
          inviteId: null,
          firstName,
        });
        const expiresAt = eventEnd(event.startsAt);
        setScanCookie(reply, token, expiresAt, secureCookies);
        reply.code(201);
        return { firstName, expiresAt: expiresAt.toISOString(), event: scanEvent(event) };
      },
    );
  };

// Contrat §6.5 : rejoindre par un lien (maquette C1), session de scan.
export const scanRoutes =
  ({ db, secureCookies }: { db: Db; secureCookies: boolean }): FastifyPluginAsyncZod =>
  async (app) => {
    const invalid = () => new AppError(400, 'INVITE_INVALID', 'Ce lien n’est plus valable.');
    const limit = async (ip: string) => {
      if (!(await consumeLimit(db, `scan_join_ip:${ipSubject(ip)}`, limits.scanJoinPerIp))) {
        throw new AppError(429, 'RATE_LIMITED', 'Trop d’essais. Réessayez plus tard.');
      }
    };
    const validInvite = async (token: string) => {
      const [row] = await db
        .select({
          id: scannerInvites.id,
          eventId: scannerInvites.eventId,
          expiresAt: scannerInvites.expiresAt,
          event: {
            title: events.title,
            startsAt: events.startsAt,
            venue: events.venue,
            city: events.city,
          },
        })
        .from(scannerInvites)
        .innerJoin(events, eq(events.id, scannerInvites.eventId))
        .where(
          and(
            eq(scannerInvites.tokenHash, hashToken(token)),
            isNull(scannerInvites.revokedAt),
            gt(scannerInvites.expiresAt, sql`now()`),
            ne(events.status, CLOSED_STATUS),
          ),
        );
      return row ?? null;
    };

    // Ajout au contrat : C1 affiche l'événement avant la saisie du prénom, ou « Ce lien n'est
    // plus valable ». Jeton dans le corps : il n'apparaît pas dans les journaux.
    app.post(
      '/scan/invite',
      {
        schema: { body: scanInviteCheckSchema, response: { 200: scanInviteInfoSchema, ...errors } },
      },
      async (request) => {
        await limit(request.ip);
        const invite = await validInvite(request.body.inviteToken);
        if (!invite) throw invalid();
        return { event: scanEvent(invite.event) };
      },
    );

    app.post(
      '/scan/join',
      { schema: { body: scanJoinSchema, response: { 200: scanSessionSchema, ...errors } } },
      async (request, reply) => {
        await limit(request.ip);
        const { inviteToken, firstName } = request.body;
        const invite = await validInvite(inviteToken);
        if (!invite) throw invalid();
        // Un lien désactivé entre la lecture et l'ouverture : la session naît déjà coupée,
        // car sa validité dépend aussi du lien (validSession).
        const token = await openScannerSession(db, {
          eventId: invite.eventId,
          inviteId: invite.id,
          firstName,
        });
        setScanCookie(reply, token, invite.expiresAt, secureCookies);
        return {
          firstName,
          expiresAt: invite.expiresAt.toISOString(),
          event: scanEvent(invite.event),
        };
      },
    );

    app.get(
      '/scan/session',
      { schema: { response: { 200: scanSessionSchema, ...errors } } },
      async (request, reply) => {
        const session = await requireScanner(db, request);
        // La fin de session peut avoir bougé (événement reporté) : le cookie suit.
        if (!request.headers.authorization) {
          setScanCookie(reply, session.token, session.expiresAt, secureCookies);
        }
        return {
          firstName: session.firstName,
          expiresAt: session.expiresAt.toISOString(),
          event: scanEvent(session.event),
        };
      },
    );
  };
