import { and, eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../../db/client.js';
import { organizers, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { findUserSession, SESSION_DAYS } from './sessions.js';

// Cookie HttpOnly / SameSite=Lax, ou en-tête Authorization pour le futur mobile (§3.5).
export const SESSION_COOKIE = 'gatio_session';

export type OrganizerContext = { userId: string; organizerId: string; sessionId: string };

declare module 'fastify' {
  interface FastifyRequest {
    organizer?: OrganizerContext;
  }
}

export function readSessionToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim() || null;
  return readCookie(request.headers.cookie, SESSION_COOKIE);
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean) {
  reply.header('set-cookie', cookie(token, SESSION_DAYS * 24 * 60 * 60, secure));
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean) {
  reply.header('set-cookie', cookie('', 0, secure));
}

export const requireOrganizer = (db: Db) => async (request: FastifyRequest) => {
  const token = readSessionToken(request);
  const session = token ? await findUserSession(db, token) : null;
  if (session) {
    const [organizer] = await db
      .select({ id: organizers.id })
      .from(organizers)
      .innerJoin(users, eq(users.id, organizers.userId))
      .where(and(eq(users.id, session.userId), eq(users.role, 'organizer')));
    if (organizer) {
      request.organizer = {
        userId: session.userId,
        organizerId: organizer.id,
        sessionId: session.sessionId,
      };
      return;
    }
  }
  throw new AppError(401, 'UNAUTHENTICATED', 'Connexion requise.');
};

function cookie(value: string, maxAgeSeconds: number, secure: boolean) {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}
