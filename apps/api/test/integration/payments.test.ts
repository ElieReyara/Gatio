import {
  errorResponseSchema,
  orderCreatedSchema,
  orderSchema,
  paymentStartedSchema,
  parseTicketQr,
} from '@gatio/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { createPublicKey, verify } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import { releaseExpiredReservations } from '../../src/modules/orders/expiry.js';
import type { FakePaymentProvider } from '../../src/modules/payments/fake-provider.js';
import { applyProviderResult } from '../../src/modules/payments/confirmation.js';
import { pollPendingPayments } from '../../src/modules/payments/jobs.js';
import { testDependencies, testOrigin } from '../../src/test-support.js';
import { testDatabaseUrl } from './database.js';

const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 20 });
const db = drizzle({ client: pool, schema });
let app: FastifyInstance;
let deps: ReturnType<typeof testDependencies>;
let fake: FakePaymentProvider;
let organizer: string;
let counter = 0;

const days = (n: number) => new Date(Date.now() + n * 24 * 3600 * 1000);

function call(options: InjectOptions & { cookie?: string }) {
  const { cookie, headers, ...rest } = options;
  return app.inject({
    ...rest,
    headers: { origin: testOrigin, ...(cookie ? { cookie } : {}), ...headers },
  });
}

const errorOf = (response: { json(): unknown }) => errorResponseSchema.parse(response.json()).error;

async function setupEvent(categories: Array<Record<string, unknown>>) {
  const created = await call({
    method: 'POST',
    url: '/api/v1/organizer/events',
    cookie: organizer,
    payload: {
      title: 'Soirée Sahel Live',
      description: 'Musique',
      eventType: 'concert',
      city: "N'Djamena",
      venue: 'Salle des fêtes',
      startsAt: days(30).toISOString(),
      capacity: 1000,
    },
  });
  const event = created.json() as { id: string; slug: string };
  const ids: string[] = [];
  for (const category of categories) {
    const response = await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${event.id}/categories`,
      cookie: organizer,
      payload: category,
    });
    ids.push((response.json() as { id: string }).id);
  }
  await call({
    method: 'POST',
    url: `/api/v1/organizer/events/${event.id}/publish`,
    cookie: organizer,
  });
  return { ...event, categoryIds: ids };
}

async function reserve(slug: string, items: Array<{ categoryId: string; quantity: number }>) {
  counter += 1;
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    headers: {
      origin: testOrigin,
      'idempotency-key': `cle-commande-${counter}-${Date.now()}`,
      'x-forwarded-for': `10.1.${Math.floor(counter / 250) % 250}.${counter % 250}`,
    },
    payload: {
      eventSlug: slug,
      items,
      contact: { name: 'Mahamat Idriss', phone: `66${String(200000 + counter).slice(-6)}` },
    },
  });
  return orderCreatedSchema.parse(response.json());
}

function pay(
  order: { orderId: string; orderToken: string },
  method: 'airtel_money' | 'moov_money' = 'airtel_money',
  key = `cle-paiement-${++counter}-${Date.now()}`,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/orders/${order.orderId}/payments`,
    headers: { origin: testOrigin, 'idempotency-key': key, 'x-order-token': order.orderToken },
    payload: { method },
  });
}

async function readOrder(order: { orderId: string; orderToken: string }) {
  const response = await app.inject({
    url: `/api/v1/orders/${order.orderId}`,
    headers: { 'x-order-token': order.orderToken },
  });
  return orderSchema.parse(response.json());
}

// Ce que fait l'acheteur sur son téléphone, par la route de l'outil d'essai.
async function phone(outcome: string, providerRef?: string) {
  const ref =
    providerRef ?? fake.list().find((payment) => payment.status === 'pending')!.providerRef;
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/dev/fake-payments/${ref}`,
    headers: { origin: testOrigin },
    payload: { outcome },
  });
  await deps.settle();
  return response;
}

const count = async (table: string, where = 'true') =>
  (await pool.query(`select count(*)::int as n from ${table} where ${where}`)).rows[0].n as number;

const stock = async (categoryId: string) =>
  (
    await pool.query(
      'select quantity_reserved as reserved, quantity_sold as sold from ticket_categories where id = $1',
      [categoryId],
    )
  ).rows[0] as { reserved: number; sold: number };

beforeEach(async () => {
  await pool.query(
    'truncate users, organizers, auth_sessions, password_resets, rate_limit_counters, events, ticket_categories, fee_rules, audit_log, buyers, orders, order_items, funnel_events, payments, payment_webhook_events, reconciliation_runs, discrepancies, payouts, tickets, email_verifications, outbound_messages cascade',
  );
  await pool.query(`insert into fee_rules (scope, scope_id, calc_type, params, currency, valid_from)
    values ('platform', null, 'percent_fixed', '{"percent_bps": 400, "fixed_amount": 100}', 'XAF', now() - interval '1 minute')`);
  deps = testDependencies(pool);
  fake = deps.payments as FakePaymentProvider;
  app = await buildApp(deps);
  const register = await call({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: 'orga@exemple.com', password: 'motdepasse1', displayName: 'Sahel Culture' },
  });
  organizer = String(register.headers['set-cookie']).split(';')[0]!;
  await call({
    method: 'PUT',
    url: '/api/v1/organizer/payout-account',
    cookie: organizer,
    payload: { method: 'airtel_money', number: '66 99 88 77' },
  });
});

afterAll(async () => {
  await pool.end();
});

describe('paiement confirmé (R14, R23, invariant 2)', () => {
  it('aucun billet avant la confirmation ; ensuite billets signés, stock vendu, un versement', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 2 }]);
    const started = await pay(order);
    expect(started.statusCode).toBe(201);
    expect(paymentStartedSchema.parse(started.json()).next).toMatchObject({
      type: 'await_phone',
      hint: expect.stringMatching(/^\+235/),
    });
    expect(await readOrder(order)).toMatchObject({
      status: 'pending',
      payment: { status: 'pending', method: 'airtel_money' },
      tickets: [],
    });
    expect(await count('tickets')).toBe(0);

    await phone('accept');
    const paid = await readOrder(order);
    expect(paid).toMatchObject({ status: 'paid', payment: { status: 'confirmed', next: null } });
    expect(paid.tickets).toHaveLength(2);
    expect(await stock(categoryIds[0]!)).toEqual({ reserved: 0, sold: 2 });

    // Invariant 2 : billets = quantités ; prix = frais + reversé ; un seul versement.
    const { rows } = await pool.query(
      'select o.total_amount, o.fee_total, o.payout_total, p.amount as payout, p.status from orders o join payouts p on p.order_id = o.id',
    );
    expect(rows).toEqual([
      {
        total_amount: '10000',
        fee_total: '600',
        payout_total: '9400',
        payout: '9400',
        status: 'pending',
      },
    ]);

    // QR signé par la clé du serveur, sans donnée personnelle (§3.6).
    const qr = parseTicketQr(paid.tickets[0]!.qr)!;
    const publicKey = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: deps.ticketSigner.publicKey },
      format: 'jwk',
    });
    expect(verify(null, qr.signed, publicKey, qr.signature)).toBe(true);
    expect(qr.ticketId).toBe(paid.tickets[0]!.id);
  });

  it('démarrage rejoué avec la même clé : même paiement ; clé et jeton exigés', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    const first = await pay(order, 'airtel_money', 'cle-paiement-rejouee-01');
    const again = await pay(order, 'airtel_money', 'cle-paiement-rejouee-01');
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect(await count('payments')).toBe(1);
    const noKey = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.orderId}/payments`,
      headers: { origin: testOrigin, 'x-order-token': order.orderToken },
      payload: { method: 'airtel_money' },
    });
    expect(errorOf(noKey).details).toMatchObject({ reason: 'idempotency_key_required' });
    const wrongToken = await pay({ orderId: order.orderId, orderToken: 'faux' });
    expect(wrongToken.statusCode).toBe(404);
  });
});

describe('notifications (R15, R16, invariant 4)', () => {
  it('notification en double, et livrée plusieurs fois en même temps : un seul effet', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 3 }]);
    await pay(order);
    await phone('accept_twice');
    expect(await count('payment_webhook_events')).toBe(1);

    const order2 = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 2 }]);
    await pay(order2);
    const ref = fake.list().find((payment) => payment.status === 'pending')!.providerRef;
    const [notification] = fake.simulate(ref, 'accept');
    await Promise.all([
      ...Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/webhooks/payments/fake',
          payload: notification!.rawBody,
          headers: notification!.headers,
        }),
      ),
      pollPendingPayments(db, fake),
    ]);
    await deps.settle();
    expect(await count('tickets')).toBe(5);
    expect(await count('payouts')).toBe(2);
    expect(await stock(categoryIds[0]!)).toEqual({ reserved: 0, sold: 5 });
  });

  it('signature fausse : refusée, gardée pour l’enquête, rien ne change', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pay(order);
    const ref = fake.list()[0]!.providerRef;
    const forged = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments/fake',
      headers: { 'content-type': 'application/json', 'x-fake-signature': '00'.repeat(32) },
      payload: JSON.stringify({
        eventId: 'evt-1',
        providerRef: ref,
        status: 'confirmed',
        amount: 5000,
        currency: 'XAF',
        payerPhone: null,
      }),
    });
    expect(forged.statusCode).toBe(401);
    await deps.settle();
    expect((await readOrder(order)).status).toBe('pending');
    expect(await count('payment_webhook_events', 'signature_valid = false')).toBe(1);
    expect(await count('tickets')).toBe(0);
  });

  it('notification perdue : l’interrogation après 2 minutes confirme (R16)', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pay(order);
    await phone('accept_silent');
    await pollPendingPayments(db, fake);
    expect((await readOrder(order)).status).toBe('pending');
    await pool.query("update payments set created_at = now() - interval '3 minutes'");
    await pollPendingPayments(db, fake);
    expect((await readOrder(order)).status).toBe('paid');
  });

  it('montant différent : aucune confirmation, écart ouvert, l’acheteur peut réessayer', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pay(order);
    await phone('wrong_amount');
    expect(await readOrder(order)).toMatchObject({
      status: 'pending',
      payment: { status: 'failed', failureReason: 'amount_mismatch' },
      tickets: [],
    });
    expect(await count('discrepancies', "kind = 'amount_mismatch'")).toBe(1);
    expect((await pay(order)).statusCode).toBe(201);
  });

  it('paiement refusé : échec, nouvel essai possible, un seul paiement en attente (R13)', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pay(order);
    await phone('refuse');
    expect((await readOrder(order)).payment).toMatchObject({ status: 'failed' });
    await pay(order, 'moov_money');
    await pay(order, 'airtel_money');
    expect(await count('payments', "status = 'pending'")).toBe(1);
    expect(await count('payments', "failure_reason = 'replaced'")).toBe(1);
  });
});

describe('paiement tardif et double paiement (R9, R17, R18)', () => {
  async function expireWithPendingPayment(order: { orderId: string }) {
    await pool.query(
      "update orders set reservation_expires_at = now() - interval '31 minutes' where id = $1",
      [order.orderId],
    );
    await pool.query("update payments set created_at = now() - interval '40 minutes'");
  }

  it('une réservation avec un paiement en attente n’expire qu’après le délai de grâce', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pay(order);
    await pool.query(
      "update orders set reservation_expires_at = now() - interval '5 minutes' where id = $1",
      [order.orderId],
    );
    expect(await releaseExpiredReservations(db)).toBe(0);
    await expireWithPendingPayment(order);
    await pollPendingPayments(db, fake);
    expect((await readOrder(order)).payment).toMatchObject({
      status: 'failed',
      failureReason: 'timeout',
    });
    expect(await releaseExpiredReservations(db)).toBe(1);
  });

  it('paiement confirmé après l’expiration, stock encore libre : billets remis', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 10 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 2 }]);
    await pay(order);
    await expireWithPendingPayment(order);
    await pollPendingPayments(db, fake);
    await releaseExpiredReservations(db);
    expect(await stock(categoryIds[0]!)).toEqual({ reserved: 0, sold: 0 });
    await phone('accept');
    const late = await readOrder(order);
    expect(late.status).toBe('paid');
    expect(late.tickets).toHaveLength(2);
    expect(await stock(categoryIds[0]!)).toEqual({ reserved: 0, sold: 2 });
  });

  it('paiement confirmé après l’expiration, stock repris par un autre : à traiter, écart', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Dernier', priceAmount: 5_000, quantityTotal: 1 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pay(order);
    const ref = fake.list()[0]!.providerRef;
    await expireWithPendingPayment(order);
    await pollPendingPayments(db, fake);
    await releaseExpiredReservations(db);
    const other = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pay(other);
    await phone('accept', fake.list().find((payment) => payment.providerRef !== ref)!.providerRef);
    await phone('accept', ref);
    expect(await readOrder(order)).toMatchObject({ status: 'needs_review', tickets: [] });
    expect(await count('discrepancies', "kind = 'late_payment'")).toBe(1);
    expect(await stock(categoryIds[0]!)).toEqual({ reserved: 0, sold: 1 });
    expect(await count('tickets')).toBe(1);
  });

  it('deux paiements confirmés pour une commande : un seul jeu de billets, écart', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 2 }]);
    await pay(order, 'airtel_money');
    const first = fake.list()[0]!.providerRef;
    await pay(order, 'moov_money');
    const second = fake.list().find((payment) => payment.providerRef !== first)!.providerRef;
    await phone('accept', second);
    await phone('accept', first);
    expect((await readOrder(order)).tickets).toHaveLength(2);
    expect(await count('discrepancies', "kind = 'duplicate_payment'")).toBe(1);
    expect(await count('payouts')).toBe(1);
    expect(await stock(categoryIds[0]!)).toEqual({ reserved: 0, sold: 2 });
  });
});

describe('démarrage refusé et annulation (R34)', () => {
  it('réservation expirée ou événement annulé : pas de nouveau paiement ; un paiement en cours reste traité', async () => {
    const { id, slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const expired = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pool.query(
      "update orders set reservation_expires_at = now() - interval '1 second' where id = $1",
      [expired.orderId],
    );
    expect(errorOf(await pay(expired)).code).toBe('RESERVATION_EXPIRED');

    const inProgress = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    const notStarted = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pay(inProgress);
    await call({ method: 'POST', url: `/api/v1/organizer/events/${id}/cancel`, cookie: organizer });
    expect(errorOf(await pay(notStarted)).code).toBe('EVENT_NOT_ON_SALE');
    await phone('accept');
    expect((await readOrder(inProgress)).status).toBe('paid');
  });
});

describe('cas relevés par la revue isolée de la tranche 6', () => {
  it('confirmations simultanées (notification, interrogation, cinq applications) : un seul effet', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 3 }]);
    await pay(order);
    await pool.query("update payments set created_at = now() - interval '3 minutes'");
    const ref = fake.list()[0]!.providerRef;
    const [notification] = fake.simulate(ref, 'accept');
    const status = await fake.getStatus(ref);
    if (status.status !== 'confirmed') throw new Error('fake status');
    await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/payments/fake',
        payload: notification!.rawBody,
        headers: notification!.headers,
      }),
      pollPendingPayments(db, fake),
      ...Array.from({ length: 5 }, () => applyProviderResult(db, 'fake', status)),
    ]);
    await deps.settle();
    expect(await count('tickets')).toBe(3);
    expect(await count('payouts')).toBe(1);
    expect(await stock(categoryIds[0]!)).toEqual({ reserved: 0, sold: 3 });
  });

  it('confirmations pendant des modifications de la catégorie par l’organisateur : aucun interblocage', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 200 },
    ]);
    const orders = [];
    for (let i = 0; i < 8; i++) {
      const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
      await pay(order);
      orders.push(order);
    }
    const notifications = fake
      .list()
      .flatMap((payment) => fake.simulate(payment.providerRef, 'accept'));
    const results = await Promise.all([
      ...notifications.map((notification) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/webhooks/payments/fake',
          payload: notification.rawBody,
          headers: notification.headers,
        }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        call({
          method: 'PATCH',
          url: `/api/v1/organizer/categories/${categoryIds[0]}`,
          cookie: organizer,
          payload: { quantityTotal: 300 + i },
        }),
      ),
    ]);
    await deps.settle();
    expect(results.map((response) => response.statusCode)).toEqual(Array(16).fill(200));
    for (const order of orders) expect((await readOrder(order)).status).toBe('paid');
  });

  it('organisateur suspendu : versement retenu (R33)', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pay(order);
    await pool.query("update organizers set status = 'suspended'");
    await phone('accept');
    const { rows } = await pool.query('select status from payouts');
    expect(rows).toEqual([{ status: 'held' }]);
  });

  it('réponse de démarrage perdue : le paiement est retrouvé par notre référence', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pay(order);
    const ref = fake.list()[0]!.providerRef;
    await pool.query("update payments set provider_ref = 'local:' || id");
    await phone('accept', ref);
    expect((await readOrder(order)).status).toBe('paid');
    const { rows } = await pool.query('select provider_ref from payments');
    expect(rows).toEqual([{ provider_ref: ref }]);
  });

  it('notification toujours inconnue après un jour : écart « manquant chez nous »', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pay(order);
    const ref = fake.list()[0]!.providerRef;
    await pool.query("update payments set provider_ref = 'autre-reference'");
    await phone('accept', ref);
    expect(await count('payment_webhook_events', "outcome = 'unknown_payment'")).toBe(1);
    await pool.query("update payment_webhook_events set created_at = now() - interval '2 days'");
    await pollPendingPayments(db, fake);
    expect(await count('discrepancies', "kind = 'missing_local'")).toBe(1);
    expect(await count('payment_webhook_events', 'processed_at is null')).toBe(0);
  });

  it('refus perdu : l’interrogation passe le paiement en échec', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pay(order);
    fake.simulate(fake.list()[0]!.providerRef, 'refuse');
    await pool.query("update payments set created_at = now() - interval '3 minutes'");
    await pollPendingPayments(db, fake);
    expect((await readOrder(order)).payment).toMatchObject({ status: 'failed' });
  });

  it('paiement remplacé puis confirmé sans notification : vu par l’interrogation (R18)', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const order = await reserve(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    await pay(order, 'airtel_money');
    const first = fake.list()[0]!.providerRef;
    await pay(order, 'moov_money');
    const second = fake.list().find((payment) => payment.providerRef !== first)!.providerRef;
    await phone('accept', second);
    await phone('accept_silent', first);
    await pool.query("update payments set updated_at = now() - interval '3 minutes'");
    await pollPendingPayments(db, fake);
    expect(await count('discrepancies', "kind = 'duplicate_payment'")).toBe(1);
    expect(await count('tickets')).toBe(1);
  });

  it('notification : prestataire inconnu, corps trop gros ; routes d’essai absentes en production', async () => {
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments/autre',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(unknown.statusCode).toBe(404);
    const big = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments/fake',
      headers: { 'content-type': 'application/json' },
      payload: 'x'.repeat(70 * 1024),
    });
    expect(big.statusCode).toBe(413);

    const production = await buildApp(
      testDependencies(pool, {
        config: {
          logLevel: 'silent',
          nodeEnv: 'production',
          webUrl: 'http://localhost:3000',
          allowedOrigins: [testOrigin],
        },
      }),
    );
    const dev = await production.inject({ url: '/api/v1/dev/fake-payments' });
    expect(dev.statusCode).toBe(404);
    await production.close();
  });
});
