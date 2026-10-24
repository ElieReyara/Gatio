import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { PgBoss } from 'pg-boss';
import type { Db } from '../../db/client.js';
import { discrepancies, orders, paymentWebhookEvents, payments } from '../../db/schema.js';
import { applyProviderResult, processNotification } from './confirmation.js';
import type { PaymentPort } from './port.js';

// R16 : interrogation après 2 minutes sans réponse. R9 : délai de grâce de 30 minutes après
// la fin de la réservation, puis le paiement est abandonné (une confirmation plus tardive
// suit le cas du paiement tardif, R17).
export const PAYMENT_POLL_AFTER_SECONDS = 2 * 60;
export const PAYMENT_GRACE_SECONDS = 30 * 60;

// Abandonnés de notre côté (remplacés, sans réponse…) : encore interrogés pendant un jour,
// car l'acheteur a pu les confirmer sur son téléphone (paiement tardif ou double, R17, R18).
const WATCH_FAILED_HOURS = 24;
const LOCALLY_FAILED = ['replaced', 'timeout', 'provider_unavailable', 'superseded'];

type Log = Pick<FastifyBaseLogger, 'error'>;

export async function pollPendingPayments(db: Db, port: PaymentPort, log?: Log, batchSize = 50) {
  // Chaque élément est traité à part : une erreur sur l'un ne bloque pas les suivants.
  async function each<T>(items: T[], what: string, task: (item: T) => Promise<void>) {
    for (const item of items) {
      try {
        await task(item);
      } catch (error) {
        log?.error({ err: error }, `payment job: ${what} failed`);
      }
    }
  }

  // Notifications reçues mais jamais traitées (arrêt du serveur, paiement pas encore connu).
  const unprocessed = await db
    .select({
      id: paymentWebhookEvents.id,
      payload: paymentWebhookEvents.payload,
      old: sql<boolean>`${paymentWebhookEvents.createdAt} < now() - interval '1 day'`,
    })
    .from(paymentWebhookEvents)
    .where(
      and(
        isNull(paymentWebhookEvents.processedAt),
        eq(paymentWebhookEvents.provider, port.name),
        sql`${paymentWebhookEvents.createdAt} < now() - interval '1 minute'`,
      ),
    )
    .orderBy(paymentWebhookEvents.createdAt)
    .limit(batchSize);
  await each(unprocessed, 'notification', async (event) => {
    if (!event.old) return processNotification(db, port, event.id);
    // Toujours inconnue après un jour : argent peut-être reçu sans paiement chez nous.
    const result = port.readNotification(event.payload);
    await db.transaction(async (tx) => {
      await tx.insert(discrepancies).values({
        providerRef: result?.providerRef ?? null,
        kind: 'missing_local',
        details: { notificationId: event.id, amount: result?.amount ?? null },
      });
      await tx
        .update(paymentWebhookEvents)
        .set({ outcome: 'missing_local', processedAt: sql`now()` })
        .where(eq(paymentWebhookEvents.id, event.id));
    });
  });

  // R16 : paiements en attente depuis plus de 2 minutes. Les moins récemment interrogés
  // d'abord (la date de mise à jour sert de tour de rôle).
  const pending = await db
    .select({
      id: payments.id,
      providerRef: payments.providerRef,
      graceOver: sql<boolean>`${orders.reservationExpiresAt} + make_interval(secs => ${PAYMENT_GRACE_SECONDS}) < now()`,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(
        eq(payments.status, 'pending'),
        eq(payments.provider, port.name),
        sql`${payments.createdAt} < now() - make_interval(secs => ${PAYMENT_POLL_AFTER_SECONDS})`,
      ),
    )
    .orderBy(payments.updatedAt)
    .limit(batchSize);
  await each(pending, 'pending payment', async (payment) => {
    // Démarrage jamais arrivé chez le prestataire : rien à lui demander.
    const status = payment.providerRef.startsWith('local:')
      ? ({ status: 'unknown' } as const)
      : await port.getStatus(payment.providerRef).catch((error: unknown) => {
          log?.error({ err: error }, 'payment status query failed');
          return { status: 'unknown' } as const;
        });
    if (status.status === 'confirmed' || status.status === 'failed') {
      await applyProviderResult(db, port.name, status);
      return;
    }
    await db
      .update(payments)
      .set(
        payment.graceOver
          ? { status: 'failed', failureReason: 'timeout', updatedAt: sql`now()` }
          : { updatedAt: sql`now()` },
      )
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')));
  });

  const abandoned = await db
    .select({ id: payments.id, providerRef: payments.providerRef })
    .from(payments)
    .where(
      and(
        eq(payments.status, 'failed'),
        eq(payments.provider, port.name),
        inArray(payments.failureReason, LOCALLY_FAILED),
        sql`${payments.providerRef} not like 'local:%'`,
        sql`${payments.createdAt} > now() - make_interval(hours => ${WATCH_FAILED_HOURS})`,
        sql`${payments.updatedAt} < now() - make_interval(secs => ${PAYMENT_POLL_AFTER_SECONDS})`,
      ),
    )
    .orderBy(payments.updatedAt)
    .limit(batchSize);
  await each(abandoned, 'abandoned payment', async (payment) => {
    const status = await port.getStatus(payment.providerRef);
    if (status.status === 'confirmed') {
      await applyProviderResult(db, port.name, status);
      return;
    }
    await db
      .update(payments)
      .set({ updatedAt: sql`now()` })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'failed')));
  });
}

const POLL_QUEUE = 'payments.poll';
const NOTIFICATION_QUEUE = 'payments.notification';

// Une notification enregistrée part en file : reprise automatique si le traitement échoue.
export function jobNotificationQueue(boss: PgBoss) {
  return async (notificationId: string) => {
    await boss.send(
      NOTIFICATION_QUEUE,
      { notificationId },
      { retryLimit: 5, retryDelay: 10, retryBackoff: true },
    );
  };
}

export async function startPaymentJobs(
  boss: PgBoss,
  db: Db,
  port: PaymentPort,
  log: FastifyBaseLogger,
) {
  await boss.createQueue(NOTIFICATION_QUEUE);
  await boss.work<{ notificationId: string }>(NOTIFICATION_QUEUE, async (jobs) => {
    for (const job of jobs) await processNotification(db, port, job.data.notificationId);
  });
  await boss.createQueue(POLL_QUEUE);
  await boss.schedule(POLL_QUEUE, '* * * * *');
  await boss.work(POLL_QUEUE, async () => {
    await pollPendingPayments(db, port, log);
  });
}
