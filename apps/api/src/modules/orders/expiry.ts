import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { Db } from '../../db/client.js';

/**
 * R9 : libère les réservations expirées. Dans une transaction, les commandes passent à
 * « expirée » et leurs billets réservés reviennent au stock ; rejouable sans effet double
 * (seules les commandes encore « en attente » sont prises).
 * Les paiements en cours (délai de grâce de 30 minutes, vérification auprès du
 * prestataire) seront pris en compte avec la tranche 6.
 */
export async function releaseExpiredReservations(db: Db, batchSize = 200): Promise<number> {
  return db.transaction(async (tx) => {
    const expired = await tx.execute<{ category_id: string; quantity: number; orders: number }>(sql`
      with expired as (
        update orders set status = 'expired', updated_at = now()
        where id in (
          select id from orders
          where status = 'pending' and reservation_expires_at < now()
          order by reservation_expires_at
          limit ${batchSize}
          for update skip locked
        )
        returning id
      )
      select oi.category_id, sum(oi.quantity)::int as quantity,
        (select count(*)::int from expired) as orders
      from expired e left join order_items oi on oi.order_id = e.id
      group by oi.category_id`);
    const released = expired.rows.filter((row) => row.category_id !== null);
    if (released.length > 0) {
      // Catégories verrouillées dans l'ordre de leur identifiant, comme la réservation :
      // aucun interblocage avec une commande sur plusieurs catégories.
      const ids = released.map((row) => row.category_id).sort();
      await tx.execute(
        sql`select id from ticket_categories where id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) order by id for update`,
      );
      for (const row of released.sort((a, b) => (a.category_id < b.category_id ? -1 : 1))) {
        await tx.execute(sql`
          update ticket_categories
          set quantity_reserved = quantity_reserved - ${row.quantity}, updated_at = now()
          where id = ${row.category_id}::uuid`);
      }
    }
    return Number(expired.rows[0]?.orders ?? 0);
  });
}

const RELEASE_QUEUE = 'orders.release-expired';

export async function startReservationExpiry(boss: PgBoss, db: Db) {
  await boss.createQueue(RELEASE_QUEUE);
  await boss.schedule(RELEASE_QUEUE, '* * * * *');
  await boss.work(RELEASE_QUEUE, async () => {
    // Plusieurs passes si beaucoup de réservations expirent en même temps.
    while ((await releaseExpiredReservations(db)) > 0) {
      /* continue */
    }
  });
}
