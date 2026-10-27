import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, or } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client.js';
import { orders } from '../../db/schema.js';
import { hashToken } from '../../lib/tokens.js';
import { currentBuyer } from '../buyers/auth.js';

// Accès « commande » (§3.5) : jeton gardé par le navigateur, ou jeton du lien de l'email
// du billet. Commande inconnue ou jeton faux : même résultat (null).
export async function orderByToken(db: DbOrTx, orderId: string, token: unknown) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 100) return null;
  const hash = hashToken(token);
  const [order] = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.id, orderId),
        or(eq(orders.accessTokenHash, hash), eq(orders.emailAccessTokenHash, hash)),
      ),
    );
  return order ?? null;
}

// Accès « commande » du contrat (§6.1) : jeton de commande, ou session acheteur du compte
// de la commande (le titulaire du numéro, après son code SMS).
export async function orderForRequest(
  db: Db,
  request: FastifyRequest,
  orderId: string,
  // Pour renouveler le cookie d'une session qui a glissé.
  cookie: { reply: FastifyReply; secure: boolean } | null = null,
) {
  const byToken = await orderByToken(db, orderId, request.headers['x-order-token']);
  if (byToken) return byToken;
  const buyer = await currentBuyer(db, request, cookie?.reply ?? null, cookie?.secure ?? false);
  if (!buyer) return null;
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.buyerId, buyer.buyerId)));
  return order ?? null;
}
