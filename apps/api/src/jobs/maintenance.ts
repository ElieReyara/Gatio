import type pg from 'pg';
import type { PgBoss } from 'pg-boss';

// Purge quotidienne : compteurs de limites passés (ils contiennent emails et adresses IP,
// S7), liens de réinitialisation et de validation d'email expirés depuis plus de 7 jours,
// destinataires des messages au-delà de 90 jours, codes SMS de plus d'un jour.
const PURGE_QUEUE = 'maintenance.purge';

export async function startMaintenance(boss: PgBoss, pool: pg.Pool) {
  await boss.createQueue(PURGE_QUEUE);
  await boss.schedule(PURGE_QUEUE, '17 3 * * *');
  await boss.work(PURGE_QUEUE, async () => {
    await pool.query(
      "delete from rate_limit_counters where window_start < now() - interval '1 day'",
    );
    await pool.query("delete from password_resets where expires_at < now() - interval '7 days'");
    // S7 : destinataires des messages gardés 90 jours ; liens de validation expirés.
    await pool.query(
      "update outbound_messages set recipient = null where recipient is not null and created_at < now() - interval '90 days'",
    );
    await pool.query(
      "delete from email_verifications where expires_at < now() - interval '7 days'",
    );
    // Codes SMS (R31) : inutiles après expiration ; un jour gardé pour le blocage de 15 min.
    await pool.query("delete from otp_codes where created_at < now() - interval '1 day'");
  });
}
