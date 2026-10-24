import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { Db } from '../../db/client.js';

/**
 * R9 : libère les réservations expirées. Dans une transaction, les commandes passent à
 * « expirée » et leurs billets réservés reviennent au stock ; rejouable sans effet double
 * (seules les commandes encore « en attente » sont prises).
 * Une commande dont un paiement est encore en attente n'est jamais libérée ici : la tâche
 * des paiements interroge d'abord le prestataire, puis abandonne le paiement après le délai
 * de grâce de 30 minutes (R9, R16).
 */
export async function releaseExpiredReservations(db: Db, batchSize = 200): Promise<number> {
  return db.transaction(async (tx) => {
    // 1. Verrou des commandes candidates (celles déjà prises par une autre transaction sont
    // laissées). 2. Mise à jour par une seconde instruction, qui voit tout paiement démarré
    // entre-temps : une commande avec un paiement en attente n'est jamais libérée.
    const candidates = await tx.execute<{ id: string }>(sql`
      select id from orders
      where status = 'pending' and reservation_expires_at < now()
        and not exists (
          select 1 from payments p where p.order_id = orders.id and p.status = 'pending'
        )
      order by reservation_expires_at
      limit ${batchSize}
      for update skip locked`);
    if (candidates.rows.length === 0) return 0;
    const ids = sql.join(
      candidates.rows.map((row) => sql`${row.id}::uuid`),
      sql`, `,
    );
    const expired = await tx.execute<{ category_id: string; quantity: number; orders: number }>(sql`
      with expired as (
        update orders set status = 'expired', updated_at = now()
        where id in (${ids}) and status = 'pending'
          and not exists (
            select 1 from payments p where p.order_id = orders.id and p.status = 'pending'
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
      const categoryIds = released.map((row) => row.category_id).sort();
      await tx.execute(
        sql`select id from ticket_categories where id in (${sql.join(
          categoryIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) order by id for no key update`,
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
