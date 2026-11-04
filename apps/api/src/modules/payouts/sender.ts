import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { PgBoss } from 'pg-boss';
import type { Db, DbOrTx } from '../../db/client.js';
import { events, orders, organizers, payouts } from '../../db/schema.js';
import { writeAudit } from '../../lib/audit.js';
import { maskPayoutNumber } from '../identity/profile.js';
import type { PayoutPort } from './port.js';

// Reprises après une issue inconnue (panne, délai dépassé), en minutes ; ensuite toutes les
// heures. Une issue inconnue ne devient jamais « échoué » : le transfert a peut-être eu lieu,
// et seule une reprise avec la même clé le dit sans risque de second transfert.
export const PAYOUT_RETRY_MINUTES = [1, 5, 15, 60];
// Un versement réservé et non conclu (processus arrêté pendant l'envoi) repart après ce
// délai, avec la même clé. Le délai maximal d'un envoi reste bien en dessous.
const RESERVATION_MINUTES = 10;
const SEND_TIMEOUT_MS = 2 * 60 * 1000;
const PAYOUT_QUEUE = 'payouts.send';

type Reserved = typeof payouts.$inferSelect;
type Log = Pick<FastifyBaseLogger, 'warn' | 'error'>;

// Clé d'envoi : versement et génération. Une nouvelle génération (nouveau numéro après un
// refus) est un nouvel envoi ; le numéro n'apparaît pas dans la clé.
export const payoutKey = (payout: { id: string; sendGeneration: number }) =>
  `${payout.id}:${payout.sendGeneration}`;

// Réserve le prochain versement à envoyer : un seul processus à la fois sur un versement.
// R21 et R33 : organisateur ou événement suspendu au moment de l'envoi : « retenu ».
async function reserveNext(db: Db): Promise<Reserved | 'held' | null> {
  return db.transaction(async (tx) => {
    const [due] = await tx
      .select({
        payout: payouts,
        organizerStatus: organizers.status,
        eventStatus: events.status,
      })
      .from(payouts)
      .innerJoin(orders, eq(orders.id, payouts.orderId))
      .innerJoin(events, eq(events.id, orders.eventId))
      .innerJoin(organizers, eq(organizers.id, payouts.organizerId))
      .where(and(eq(payouts.status, 'pending'), sql`${payouts.nextAttemptAt} <= now()`))
      .orderBy(payouts.nextAttemptAt)
      .limit(1)
      .for('update', { of: payouts, skipLocked: true });
    if (!due) return null;
    if (due.organizerStatus === 'suspended' || due.eventStatus === 'suspended') {
      await tx
        .update(payouts)
        .set({ status: 'held', updatedAt: sql`now()` })
        .where(eq(payouts.id, due.payout.id));
      return 'held';
    }
    const [reserved] = await tx
      .update(payouts)
      .set({
        attempts: sql`${payouts.attempts} + 1`,
        nextAttemptAt: sql`now() + make_interval(mins => ${RESERVATION_MINUTES})`,
        updatedAt: sql`now()`,
      })
      .where(eq(payouts.id, due.payout.id))
      .returning();
    return reserved!;
  });
}

// La conclusion d'un envoi ne touche que l'envoi réservé : si le versement a changé entre-temps
// (réservation reprise, relance vers un autre numéro), rien n'est écrasé.
const stillReserved = (reserved: Reserved) =>
  and(
    eq(payouts.id, reserved.id),
    eq(payouts.status, 'pending'),
    eq(payouts.attempts, reserved.attempts),
    eq(payouts.sendGeneration, reserved.sendGeneration),
  );

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('délai d’envoi dépassé')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * R21 : envoie les versements en attente, un par commande payée, hors transaction (l'appel
 * au prestataire peut être lent). Issue inconnue : reprise avec la même clé, sans fin ;
 * refus du prestataire : « échoué » (l'organisateur corrige son numéro).
 */
export async function sendDuePayouts(
  db: Db,
  port: PayoutPort,
  log?: Log,
  batchSize = 20,
  timeoutMs = SEND_TIMEOUT_MS,
) {
  for (let done = 0; done < batchSize; done++) {
    const reserved = await reserveNext(db);
    if (!reserved) return;
    if (reserved === 'held') continue;
    let result;
    try {
      result = await withTimeout(
        port.send({
          key: payoutKey(reserved),
          amount: reserved.amount,
          currency: reserved.currency,
          method: reserved.method,
          destination: reserved.destination,
        }),
        timeoutMs,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erreur inconnue';
      const wait = PAYOUT_RETRY_MINUTES[reserved.attempts - 1] ?? PAYOUT_RETRY_MINUTES.at(-1)!;
      await db
        .update(payouts)
        .set({
          lastError: message,
          nextAttemptAt: sql`now() + make_interval(mins => ${wait})`,
          updatedAt: sql`now()`,
        })
        .where(stillReserved(reserved));
      log?.warn({ payoutId: reserved.id, attempts: reserved.attempts }, 'payout outcome unknown');
      continue;
    }
    const recorded = await db
      .update(payouts)
      .set(
        result.status === 'sent'
          ? {
              status: 'sent',
              providerRef: result.providerRef,
              sentAt: sql`now()`,
              lastError: null,
              updatedAt: sql`now()`,
            }
          : { status: 'failed', lastError: result.reason, updatedAt: sql`now()` },
      )
      .where(stillReserved(reserved))
      .returning({ id: payouts.id });
    if (recorded.length === 0) {
      // Le prestataire a répondu pour un envoi qui n'est plus le dernier : à vérifier.
      log?.error(
        { payoutId: reserved.id, outcome: result.status },
        'payout outcome not recorded (payout changed during send)',
      );
    } else if (result.status === 'failed') {
      log?.warn({ payoutId: reserved.id, reason: result.reason }, 'payout refused');
    }
  }
}

/**
 * Nouveau moyen de versement : les versements refusés par le prestataire, et ceux retenus
 * faute de moyen, repartent vers ce numéro par un nouvel envoi (nouvelle génération). Une
 * issue inconnue n'est jamais relancée ainsi (elle reste « en attente »). Chaque relance est
 * tracée au journal d'audit, avec l'ancien numéro masqué (décision H3 du PC-13).
 */
export async function requeuePayouts(
  db: DbOrTx,
  actor: { userId: string; organizerId: string; ip: string },
  account: { method: string; destination: string },
) {
  const candidates = await db
    .select({
      id: payouts.id,
      status: payouts.status,
      destination: payouts.destination,
      lastError: payouts.lastError,
      sendGeneration: payouts.sendGeneration,
    })
    .from(payouts)
    .where(
      and(
        eq(payouts.organizerId, actor.organizerId),
        sql`(${payouts.status} = 'failed' or (${payouts.status} = 'held' and ${payouts.method} = 'none'))`,
      ),
    )
    .for('update');
  if (candidates.length === 0) return;
  await db
    .update(payouts)
    .set({
      status: 'pending',
      method: account.method,
      destination: account.destination,
      sendGeneration: sql`${payouts.sendGeneration} + 1`,
      attempts: 0,
      lastError: null,
      nextAttemptAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      inArray(
        payouts.id,
        candidates.map((payout) => payout.id),
      ),
    );
  for (const payout of candidates) {
    await writeAudit(db, {
      actorUserId: actor.userId,
      action: 'payout.requeue',
      entityType: 'payout',
      entityId: payout.id,
      before: {
        status: payout.status,
        destination: payout.destination ? maskPayoutNumber(payout.destination) : null,
        lastError: payout.lastError,
        sendGeneration: payout.sendGeneration,
      },
      after: {
        status: 'pending',
        method: account.method,
        destination: maskPayoutNumber(account.destination),
        sendGeneration: payout.sendGeneration + 1,
      },
      ip: actor.ip,
    });
  }
}

export async function startPayoutJobs(boss: PgBoss, db: Db, port: PayoutPort, log: Log) {
  await boss.createQueue(PAYOUT_QUEUE);
  await boss.schedule(PAYOUT_QUEUE, '* * * * *');
  await boss.work(PAYOUT_QUEUE, async () => {
    await sendDuePayouts(db, port, log);
  });
}
