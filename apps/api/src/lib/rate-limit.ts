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

/**
 * Sujet d'une limite par adresse : une adresse IPv4, ou la plage /64 d'une adresse IPv6 (un
 * seul abonné en reçoit une entière : compter chaque adresse laisserait contourner la limite).
 */
export function ipSubject(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => parseInt(group || '0', 16).toString(16))
    .join(':')}::/64`;
}
