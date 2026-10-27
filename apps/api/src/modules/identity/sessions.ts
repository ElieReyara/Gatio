import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import { authSessions, buyers } from '../../db/schema.js';
import { hashToken, newToken } from '../../lib/tokens.js';

// Session opaque, hachée en base, révocable (conception §3.5). Organisateur : 30 jours
// glissants (durée non fixée par les sources, journal du 22/10/2026).
export const SESSION_DAYS = 30;
// Acheteur : 90 jours glissants sur le même téléphone (§3.5).
export const BUYER_SESSION_DAYS = 90;
const SLIDE_AFTER_MS = 60 * 60 * 1000;

const expiresIn = (days = SESSION_DAYS) => sql`now() + make_interval(days => ${days})`;

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
  const slid = Date.now() - session.lastSeenAt.getTime() > SLIDE_AFTER_MS;
  if (slid) {
    await db
      .update(authSessions)
      .set({ lastSeenAt: sql`now()`, expiresAt: expiresIn() })
      .where(eq(authSessions.id, session.id));
  }
  return { sessionId: session.id, userId: session.userId, slid };
}

export async function createBuyerSession(
  db: DbOrTx,
  buyerId: string,
  userAgent: string | undefined,
) {
  const { token, hash } = newToken();
  await db.insert(authSessions).values({
    buyerId,
    tokenHash: hash,
    expiresAt: expiresIn(BUYER_SESSION_DAYS),
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

export async function findBuyerSession(db: Db, token: string) {
  const [session] = await db
    .select({
      id: authSessions.id,
      buyerId: authSessions.buyerId,
      lastSeenAt: authSessions.lastSeenAt,
      phone: buyers.phoneE164,
    })
    .from(authSessions)
    .innerJoin(buyers, eq(buyers.id, authSessions.buyerId))
    .where(
      and(
        eq(authSessions.tokenHash, hashToken(token)),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, sql`now()`),
      ),
    );
  if (!session?.buyerId) return null;
  const slid = Date.now() - session.lastSeenAt.getTime() > SLIDE_AFTER_MS;
  if (slid) {
    await db
      .update(authSessions)
      .set({ lastSeenAt: sql`now()`, expiresAt: expiresIn(BUYER_SESSION_DAYS) })
      .where(eq(authSessions.id, session.id));
  }
  return { sessionId: session.id, buyerId: session.buyerId, phone: session.phone, slid };
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
