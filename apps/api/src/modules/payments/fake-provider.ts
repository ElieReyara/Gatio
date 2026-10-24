import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { PaymentPort, ProviderStatus } from './port.js';

// Faux prestataire (conception §3.11, tranches 6 à 15) : se comporte comme un opérateur
// Mobile Money qui envoie une demande de confirmation sur le téléphone de l'acheteur.
// Son état est en mémoire ; ses notifications sont signées comme celles d'un vrai.
export const fakeOutcomes = [
  'accept',
  'refuse',
  // Paiement confirmé chez l'opérateur, notification perdue (R16).
  'accept_silent',
  // Même notification envoyée deux fois (R15).
  'accept_twice',
  // Montant notifié différent de celui demandé (R15).
  'wrong_amount',
] as const;
export type FakeOutcome = (typeof fakeOutcomes)[number];

type FakePayment = {
  providerRef: string;
  reference: string;
  amount: number;
  currency: string;
  method: string;
  phone: string;
  status: 'pending' | 'confirmed' | 'failed';
  paidAmount: number;
  createdAt: Date;
};

export type FakeNotification = { rawBody: string; headers: Record<string, string> };

const notificationSchema = z.object({
  eventId: z.string(),
  providerRef: z.string(),
  reference: z.string(),
  status: z.enum(['confirmed', 'failed']),
  amount: z.number().int(),
  currency: z.string(),
  payerPhone: z.string().nullable(),
});

const SIGNATURE_HEADER = 'x-fake-signature';

export type FakePaymentProvider = PaymentPort & {
  list(): FakePayment[];
  // Ce que ferait l'acheteur sur son téléphone ; renvoie les notifications à livrer.
  simulate(providerRef: string, outcome: FakeOutcome): FakeNotification[];
};

export function fakePaymentProvider(): FakePaymentProvider {
  // Secret propre à ce processus : seul ce faux prestataire sait signer.
  const secret = randomBytes(32);
  const payments = new Map<string, FakePayment>();
  const sign = (body: string | Buffer) => createHmac('sha256', secret).update(body).digest('hex');

  function notification(payment: FakePayment, eventId = randomUUID()): FakeNotification {
    const rawBody = JSON.stringify({
      eventId,
      providerRef: payment.providerRef,
      reference: payment.reference,
      status: payment.status,
      amount: payment.paidAmount,
      currency: payment.currency,
      payerPhone: payment.status === 'confirmed' ? payment.phone : null,
    });
    return {
      rawBody,
      headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: sign(rawBody) },
    };
  }

  return {
    name: 'fake',
    async start({ reference, amount, currency, method, phone }) {
      const providerRef = `fake_${randomBytes(9).toString('base64url')}`;
      payments.set(providerRef, {
        providerRef,
        reference,
        amount,
        currency,
        method,
        phone,
        status: 'pending',
        paidAmount: amount,
        createdAt: new Date(),
      });
      return { providerRef, next: { type: 'await_phone', hint: phone } };
    },
    verifyNotification(headers, rawBody) {
      const received = headers[SIGNATURE_HEADER];
      const expected = Buffer.from(sign(rawBody), 'hex');
      const given = typeof received === 'string' ? Buffer.from(received, 'hex') : Buffer.alloc(0);
      const signatureValid = given.length === expected.length && timingSafeEqual(given, expected);
      const text = rawBody.toString('utf8');
      let payload: unknown = text;
      try {
        payload = JSON.parse(text);
      } catch {
        /* contenu gardé tel quel */
      }
      const eventId =
        typeof payload === 'object' && payload !== null && 'eventId' in payload
          ? String(payload.eventId).slice(0, 200)
          : `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;
      return { eventId, signatureValid, payload };
    },
    readNotification(payload) {
      const parsed = notificationSchema.safeParse(payload);
      return parsed.success ? parsed.data : null;
    },
    async getStatus(providerRef): Promise<ProviderStatus> {
      const payment = payments.get(providerRef);
      if (!payment) return { status: 'unknown' };
      if (payment.status === 'pending') return { status: 'pending' };
      return {
        status: payment.status,
        providerRef,
        reference: payment.reference,
        amount: payment.paidAmount,
        currency: payment.currency,
        payerPhone: payment.status === 'confirmed' ? payment.phone : null,
        failureReason: payment.status === 'failed' ? 'refused_by_payer' : null,
      };
    },
    list() {
      return [...payments.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    simulate(providerRef, outcome) {
      const payment = payments.get(providerRef);
      if (!payment || payment.status !== 'pending') return [];
      payment.status = outcome === 'refuse' ? 'failed' : 'confirmed';
      if (outcome === 'wrong_amount') payment.paidAmount = payment.amount - 100;
      if (outcome === 'accept_silent') return [];
      const sent = notification(payment);
      return outcome === 'accept_twice' ? [sent, sent] : [sent];
    },
  };
}
