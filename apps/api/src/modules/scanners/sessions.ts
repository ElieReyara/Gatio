import { SCAN_SESSION_ENDED, SCANNER_INVITE_HOURS } from '@gatio/shared';
import { and, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db, DbOrTx } from '../../db/client.js';
import { events, organizers, scannerInvites, scannerSessions } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { hashToken, newToken } from '../../lib/tokens.js';
import { cookie, readCookie } from '../identity/auth.js';

// Session de scan (§3.5) : cookie distinct de ceux des organisateurs et des acheteurs, ou
// en-tête Authorization pour le futur mobile.
export const SCAN_COOKIE = 'gatio_scan';

// Un événement annulé ne se contrôle plus. Un événement suspendu, si (R33 : « le scan des
// billets déjà vendus continue »).
export const CLOSED_STATUS = 'cancelled';

const toDate = (value: string | Date) => new Date(value);

// Fin d'une session : celle de son lien, ou début de l'événement + 24 h pour l'organisateur
// qui scanne lui-même (R29).
export const sessionExpiry =
  sql<Date>`coalesce(${scannerInvites.expiresAt}, ${events.startsAt} + make_interval(hours => ${SCANNER_INVITE_HOURS}))`.mapWith(
    toDate,
  );

export const eventEnd = (startsAt: Date) =>
  new Date(startsAt.getTime() + SCANNER_INVITE_HOURS * 3600 * 1000);

export function readScanToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim() || null;
  return readCookie(request.headers.cookie, SCAN_COOKIE);
}

export function setScanCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  secure: boolean,
) {
  const seconds = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  reply.header('set-cookie', cookie(SCAN_COOKIE, token, seconds, secure));
}

export function clearScanCookie(reply: FastifyReply, secure: boolean) {
  reply.header('set-cookie', cookie(SCAN_COOKIE, '', 0, secure));
}

// Déconnexion : la session de scan de ce navigateur est fermée avec les autres.
export async function revokeScannerSessionByToken(db: DbOrTx, token: string) {
  await db
    .update(scannerSessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(scannerSessions.tokenHash, hashToken(token)), isNull(scannerSessions.revokedAt)));
}

// Mot de passe réinitialisé (R36 : toutes les sessions du compte sont fermées) : les sessions
// « scanner moi-même » de l'organisateur aussi (téléphone perdu).
export async function revokeOrganizerScannerSessions(db: DbOrTx, userId: string) {
  const owned = db
    .select({ id: events.id })
    .from(events)
    .innerJoin(organizers, eq(organizers.id, events.organizerId))
    .where(eq(organizers.userId, userId));
  await db
    .update(scannerSessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        isNull(scannerSessions.inviteId),
        isNull(scannerSessions.revokedAt),
        inArray(scannerSessions.eventId, owned),
      ),
    );
}

// R29 : la date d'un événement reporté peut changer ; ses liens actifs suivent. Un lien déjà
// expiré reste expiré (il ne ranime pas les sessions qu'il avait ouvertes).
export async function syncInviteExpiry(db: DbOrTx, eventId: string, startsAt: Date) {
  await db
    .update(scannerInvites)
    .set({ expiresAt: eventEnd(startsAt) })
    .where(
      and(
        eq(scannerInvites.eventId, eventId),
        isNull(scannerInvites.revokedAt),
        gt(scannerInvites.expiresAt, sql`now()`),
      ),
    );
}

export async function openScannerSession(
  db: DbOrTx,
  values: { eventId: string; inviteId: string | null; firstName: string },
) {
  const { token, hash } = newToken();
  await db.insert(scannerSessions).values({ ...values, tokenHash: hash });
  return token;
}

// Session valable : ni retirée, ni ouverte par un lien désactivé, ni expirée. Désactiver un
// lien coupe donc aussi les sessions ouvertes par lui (R29), même celles créées pendant.
export const validSession = sessionValidity(0);

// F11 du PC-10 : les passages faits hors réseau peuvent encore partir 24 h après la fin de la
// session (soirée qui finit tard, téléphone resté hors ligne). Rien d'autre n'est permis.
export const UPLOAD_GRACE_HOURS = 24;

function sessionValidity(graceHours: number) {
  return and(
    isNull(scannerSessions.revokedAt),
    isNull(scannerInvites.revokedAt),
    ne(events.status, CLOSED_STATUS),
    sql`${sessionExpiry} + make_interval(hours => ${graceHours}) > now()`,
  );
}

export async function findScannerSession(db: Db, token: string, graceHours = 0) {
  const [row] = await db
    .select({
      id: scannerSessions.id,
      eventId: scannerSessions.eventId,
      firstName: scannerSessions.firstName,
      lastSeenAt: scannerSessions.lastSeenAt,
      expiresAt: sessionExpiry,
      event: {
        title: events.title,
        startsAt: events.startsAt,
        venue: events.venue,
        city: events.city,
      },
    })
    .from(scannerSessions)
    .innerJoin(events, eq(events.id, scannerSessions.eventId))
    .leftJoin(scannerInvites, eq(scannerInvites.id, scannerSessions.inviteId))
    .where(and(eq(scannerSessions.tokenHash, hashToken(token)), sessionValidity(graceHours)));
  if (!row) return null;
  // Dernière activité (liste des contrôleurs) notée au plus une fois par minute.
  if (Date.now() - row.lastSeenAt.getTime() > 60_000) {
    await db
      .update(scannerSessions)
      .set({ lastSeenAt: sql`now()` })
      .where(eq(scannerSessions.id, row.id));
  }
  return row;
}

export async function requireScanner(db: Db, request: FastifyRequest, graceHours = 0) {
  const token = readScanToken(request);
  const session = token ? await findScannerSession(db, token, graceHours) : null;
  if (!token || !session) {
    throw new AppError(
      401,
      'UNAUTHENTICATED',
      'Accès au scan retiré ou expiré.',
      token ? { reason: SCAN_SESSION_ENDED } : {},
    );
  }
  return { ...session, token };
}

export const scanEvent = (event: {
  title: string;
  startsAt: Date;
  venue: string;
  city: string;
}) => ({
  title: event.title,
  startsAt: event.startsAt.toISOString(),
  venue: event.venue,
  city: event.city,
});
