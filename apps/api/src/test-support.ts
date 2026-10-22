import type pg from 'pg';
import type { AppDependencies } from './app.js';
import { memoryEmailOutbox } from './modules/email/outbox.js';
import { createTicketSigner, generateSigningKey } from './modules/tickets/signing.js';

// Dépendances de l'application pour les tests (base, signature et emails remplaçables).
export const testOrigin = 'http://localhost:3000';

type TestDependencies = AppDependencies & {
  emailOutbox: ReturnType<typeof memoryEmailOutbox>;
  // Attend le travail lancé après les réponses (envoi d'emails).
  settle: () => Promise<void>;
};

export function testDependencies(
  pool: pg.Pool,
  overrides: Partial<Omit<AppDependencies, 'pool'>> = {},
): TestDependencies {
  const pending: Promise<void>[] = [];
  return {
    config: {
      logLevel: 'silent',
      nodeEnv: 'test',
      webUrl: 'http://localhost:3000',
      allowedOrigins: [testOrigin],
    },
    pool,
    ticketSigner: createTicketSigner(1, generateSigningKey()),
    emailOutbox: memoryEmailOutbox(),
    runInBackground: (task) => {
      pending.push(task());
    },
    settle: async () => {
      await Promise.all(pending.splice(0));
    },
    ...overrides,
  } as TestDependencies;
}
