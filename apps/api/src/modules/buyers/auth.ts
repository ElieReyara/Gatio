import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { cookie, readCookie } from '../identity/auth.js';
import { BUYER_SESSION_DAYS, findBuyerSession } from '../identity/sessions.js';

// Session acheteur (§3.5) : cookie distinct de celui des organisateurs (un même navigateur
// peut avoir les deux), ou en-tête Authorization pour le futur mobile.
export const BUYER_COOKIE = 'gatio_buyer';

export type BuyerContext = { buyerId: string; phone: string; sessionId: string };

export function readBuyerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim() || null;
  return readCookie(request.headers.cookie, BUYER_COOKIE);
}

export function setBuyerCookie(reply: FastifyReply, token: string, secure: boolean) {
  reply.header(
    'set-cookie',
    cookie(BUYER_COOKIE, token, BUYER_SESSION_DAYS * 24 * 60 * 60, secure),
  );
}

export function clearBuyerCookie(reply: FastifyReply, secure: boolean) {
  reply.header('set-cookie', cookie(BUYER_COOKIE, '', 0, secure));
}

// Session acheteur de la requête, ou null. La session a glissé en base : le cookie suit.
export async function currentBuyer(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply | null,
  secure: boolean,
): Promise<BuyerContext | null> {
  const token = readBuyerToken(request);
  const session = token ? await findBuyerSession(db, token) : null;
  if (!token || !session) return null;
  if (reply && session.slid && !request.headers.authorization) {
    setBuyerCookie(reply, token, secure);
  }
  return { buyerId: session.buyerId, phone: session.phone, sessionId: session.sessionId };
}

export async function requireBuyer(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply,
  secure: boolean,
): Promise<BuyerContext> {
  const buyer = await currentBuyer(db, request, reply, secure);
  if (!buyer) throw new AppError(401, 'UNAUTHENTICATED', 'Connexion requise.');
  return buyer;
}
