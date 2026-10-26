import { and, eq, or } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { orders } from '../../db/schema.js';
import { hashToken } from '../../lib/tokens.js';

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
