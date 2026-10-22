import type pg from 'pg';
import type { AppDependencies } from './app.js';
import { memoryEmailOutbox } from './modules/email/outbox.js';
import { createTicketSigner, generateSigningKey } from './modules/tickets/signing.js';

// Dépendances de l'application pour les tests (base, signature et emails remplaçables).
export const testOrigin = 'http://localhost:3000';

export function testDependencies(
  pool: pg.Pool,
  overrides: Partial<Omit<AppDependencies, 'pool'>> = {},
): AppDependencies & { emailOutbox: ReturnType<typeof memoryEmailOutbox> } {
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
    ...overrides,
  } as AppDependencies & { emailOutbox: ReturnType<typeof memoryEmailOutbox> };
}
