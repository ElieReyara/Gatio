import type { FastifyBaseLogger } from 'fastify';
import type { PgBoss } from 'pg-boss';
import { maskPersonalData } from '../../lib/redact.js';
import type { EmailMessage, EmailPort } from './port.js';

// Les emails partent par une tâche de fond, avec reprises : une panne passagère du
// service d'envoi ne fait perdre aucun message (conception §3.4).
export type EmailOutbox = { enqueue(message: EmailMessage): Promise<void> };

export const EMAIL_QUEUE = 'email.send';
const RETRY_LIMIT = 5;

export function jobEmailOutbox(boss: PgBoss): EmailOutbox {
  return {
    async enqueue(message) {
      await boss.send(EMAIL_QUEUE, message, {
        retryLimit: RETRY_LIMIT,
        retryDelay: 30,
        retryBackoff: true,
      });
    },
  };
}

export async function startEmailWorker(boss: PgBoss, email: EmailPort, log: FastifyBaseLogger) {
  // Un email en file contient son destinataire et parfois un lien secret (réinitialisation) :
  // supprimé une heure après l'envoi, abandonné au bout d'un jour (le lien a expiré).
  const retention = { deleteAfterSeconds: 60 * 60, retentionSeconds: 24 * 60 * 60 };
  await boss.createQueue(EMAIL_QUEUE, retention);
  // Une file déjà créée garde ses réglages : on les impose à chaque démarrage.
  await boss.updateQueue(EMAIL_QUEUE, retention);
  await boss.work<EmailMessage>(EMAIL_QUEUE, async (jobs) => {
    for (const job of jobs) {
      try {
        await email.send(job.data);
      } catch (error) {
        log.error(
          { err: error, to: maskPersonalData(job.data.to), jobId: job.id },
          'email send failed (retried up to 5 times)',
        );
        throw error;
      }
    }
  });
}

// Tests : les messages sont gardés en mémoire pour être lus par les assertions.
export function memoryEmailOutbox(): EmailOutbox & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async enqueue(message) {
      sent.push(message);
    },
  };
}
