import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { AppDependencies } from './app.js';
import { memoryEmailOutbox } from './modules/email/outbox.js';
import { memoryStorage } from './modules/media/storage.js';
import { fakePaymentProvider } from './modules/payments/fake-provider.js';
import { memorySms, type SmsPort } from './modules/sms/port.js';
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
      // Coupée par défaut : les tests des tranches 5 à 7 réservent sans code SMS.
      buyers: { phoneVerification: false, otpSecret: 'secret-des-codes-pour-les-tests-0000' },
    },
    pool,
    ticketSigner: createTicketSigner(1, generateSigningKey()),
    emailOutbox: memoryEmailOutbox(),
    storage: memoryStorage(),
    payments: fakePaymentProvider(),
    sms: memorySms(),
    runInBackground: (task) => {
      pending.push(task());
    },
    settle: async () => {
      await Promise.all(pending.splice(0));
    },
    ...overrides,
  } as TestDependencies;
}

// Session acheteur ouverte par le code SMS (tranche 8) : cookie à renvoyer (« nom=valeur »).
export async function buyerCookie(app: FastifyInstance, sms: SmsPort, phone: string) {
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/buyer/otp/request',
    headers: { origin: testOrigin },
    payload: { phone },
  });
  const text = (sms as ReturnType<typeof memorySms>).sent.at(-1)?.text ?? '';
  const code = /(\d{3}) (\d{3})/.exec(text)?.slice(1).join('');
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/buyer/otp/verify',
    headers: { origin: testOrigin },
    payload: { phone, code },
  });
  const cookies = [response.headers['set-cookie'] ?? []].flat();
  const cookie = cookies.find((value) => value.startsWith('gatio_buyer='))?.split(';')[0];
  if (!cookie) throw new Error(`session acheteur non ouverte (${response.statusCode})`);
  return cookie;
}
