import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import type { Limit } from './limits.js';

/**
 * Compte un essai et dit s'il reste sous la limite. Compteur par fenêtre fixe,
 * incrémenté par une seule requête atomique (aucune lecture puis écriture).
 */
export async function consumeLimit(
  db: Db,
  key: string,
  { limit, windowSeconds }: Limit,
): Promise<boolean> {
  const result = await db.execute<{ count: number }>(sql`
    insert into rate_limit_counters (key, window_start, count)
    values (${key}, to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}), 1)
    on conflict (key, window_start) do update set count = rate_limit_counters.count + 1
    returning count`);
  return Number(result.rows[0]?.count) <= limit;
}
