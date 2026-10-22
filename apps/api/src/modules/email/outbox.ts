import type { PgBoss } from 'pg-boss';
import type { EmailMessage, EmailPort } from './port.js';

// Les emails partent par une tâche de fond, avec reprises : une panne passagère du
// service d'envoi ne fait perdre aucun message (conception §3.4).
export type EmailOutbox = { enqueue(message: EmailMessage): Promise<void> };

export const EMAIL_QUEUE = 'email.send';

export function jobEmailOutbox(boss: PgBoss): EmailOutbox {
  return {
    async enqueue(message) {
      await boss.send(EMAIL_QUEUE, message, { retryLimit: 5, retryDelay: 30, retryBackoff: true });
    },
  };
}

export async function startEmailWorker(boss: PgBoss, email: EmailPort) {
  await boss.createQueue(EMAIL_QUEUE);
  await boss.work<EmailMessage>(EMAIL_QUEUE, async (jobs) => {
    for (const job of jobs) await email.send(job.data);
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
