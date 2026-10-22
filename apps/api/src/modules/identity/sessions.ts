import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import { authSessions } from '../../db/schema.js';
import { hashToken, newToken } from '../../lib/tokens.js';

// Session opaque, hachée en base, révocable (conception §3.5). Organisateur : 30 jours
// glissants (durée non fixée par les sources, journal du 22/10/2026).
export const SESSION_DAYS = 30;
const SLIDE_AFTER_MS = 60 * 60 * 1000;

const expiresIn = () => sql`now() + make_interval(days => ${SESSION_DAYS})`;

export async function createUserSession(db: Db, userId: string, userAgent: string | undefined) {
  const { token, hash } = newToken();
  await db.insert(authSessions).values({
    userId,
    tokenHash: hash,
    expiresAt: expiresIn(),
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

export async function findUserSession(db: Db, token: string) {
  const [session] = await db
    .select({
      id: authSessions.id,
      userId: authSessions.userId,
      lastSeenAt: authSessions.lastSeenAt,
    })
    .from(authSessions)
    .where(
      and(
        eq(authSessions.tokenHash, hashToken(token)),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, sql`now()`),
      ),
    );
  if (!session?.userId) return null;
  if (Date.now() - session.lastSeenAt.getTime() > SLIDE_AFTER_MS) {
    await db
      .update(authSessions)
      .set({ lastSeenAt: sql`now()`, expiresAt: expiresIn() })
      .where(eq(authSessions.id, session.id));
  }
  return { sessionId: session.id, userId: session.userId };
}

export async function revokeSession(db: Db, sessionId: string) {
  await db
    .update(authSessions)
    .set({ revokedAt: sql`now()` })
    .where(eq(authSessions.id, sessionId));
}

export async function revokeAllUserSessions(db: DbOrTx, userId: string) {
  await db
    .update(authSessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
}
