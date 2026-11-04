import { orderCreatedSchema, payoutsOverviewSchema } from '@gatio/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import type { FakePaymentProvider } from '../../src/modules/payments/fake-provider.js';
import {
  fakePayoutProvider,
  type FakePayoutProvider,
  type PayoutPort,
} from '../../src/modules/payouts/port.js';
import {
  PAYOUT_RETRY_MINUTES,
  payoutKey,
  sendDuePayouts,
} from '../../src/modules/payouts/sender.js';
import { testDependencies, testOrigin } from '../../src/test-support.js';
import { testDatabaseUrl } from './database.js';

const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 10 });
const db = drizzle({ client: pool, schema });
let app: FastifyInstance;
let deps: ReturnType<typeof testDependencies>;
let payout: FakePayoutProvider;
let organizer: string;
let counter = 0;

function call(options: InjectOptions & { cookie?: string }) {
  const { cookie, headers, ...rest } = options;
  counter += 1;
  return app.inject({
    ...rest,
    headers: {
      origin: testOrigin,
      'x-forwarded-for': `10.5.${Math.floor(counter / 250) % 250}.${counter % 250}`,
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
  });
}

async function register(email: string, payoutNumber = '66 99 88 77') {
  const response = await call({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'motdepasse1', displayName: 'Sahel Culture' },
  });
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  await setPayoutNumber(cookie, payoutNumber);
  return cookie;
}

const setPayoutNumber = (cookie: string, number: string) =>
  call({
    method: 'PUT',
    url: '/api/v1/organizer/payout-account',
    cookie,
    payload: { method: 'airtel_money', number },
  });

async function publishedEvent(cookie = organizer, title = 'Soirée Sahel Live') {
  const created = await call({
    method: 'POST',
    url: '/api/v1/organizer/events',
    cookie,
    payload: {
      title,
      description: 'Musique',
      eventType: 'concert',
      city: "N'Djamena",
      venue: 'Salle des fêtes',
      startsAt: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
      capacity: 500,
    },
  });
  const event = created.json() as { id: string; slug: string };
  const category = await call({
    method: 'POST',
    url: `/api/v1/organizer/events/${event.id}/categories`,
    cookie,
    payload: { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
  });
  await call({ method: 'POST', url: `/api/v1/organizer/events/${event.id}/publish`, cookie });
  return { ...event, categoryId: (category.json() as { id: string }).id };
}

async function paidOrder(event: { slug: string; categoryId: string }, quantity = 2) {
  const reserved = await call({
    method: 'POST',
    url: '/api/v1/orders',
    headers: { 'idempotency-key': `cle-versement-${counter}-${Date.now()}` },
    payload: {
      eventSlug: event.slug,
      items: [{ categoryId: event.categoryId, quantity }],
      contact: { name: 'Mahamat Idriss', phone: '66 12 34 56' },
    },
  });
  const order = orderCreatedSchema.parse(reserved.json());
  await call({
    method: 'POST',
    url: `/api/v1/orders/${order.orderId}/payments`,
    headers: {
      'idempotency-key': `cle-paiement-versement-${counter}`,
      'x-order-token': order.orderToken,
    },
    payload: { method: 'airtel_money' },
  });
  const fake = deps.payments as FakePaymentProvider;
  const ref = fake.list().find((item) => item.status === 'pending')!.providerRef;
  await call({
    method: 'POST',
    url: `/api/v1/dev/fake-payments/${ref}`,
    payload: { outcome: 'accept' },
  });
  await deps.settle();
  return order;
}

const payoutsOf = async () =>
  (
    await pool.query(
      'select p.id, p.order_id, p.amount, p.status, p.attempts, p.destination, p.provider_ref, o.payout_total from payouts p join orders o on o.id = p.order_id order by p.created_at',
    )
  ).rows as Array<{
    id: string;
    order_id: string;
    amount: string;
    status: string;
    attempts: number;
    destination: string;
    provider_ref: string | null;
    payout_total: string;
  }>;
const due = () => pool.query("update payouts set next_attempt_at = now() where status = 'pending'");
const overview = async (cookie = organizer) =>
  payoutsOverviewSchema.parse((await call({ url: '/api/v1/organizer/payouts', cookie })).json());

beforeEach(async () => {
  await pool.query(
    'truncate users, organizers, auth_sessions, password_resets, rate_limit_counters, events, ticket_categories, fee_rules, audit_log, buyers, orders, order_items, funnel_events, payments, payment_webhook_events, payouts, tickets, email_verifications, outbound_messages, otp_codes, scanner_invites, scanner_sessions, manifest_downloads, passages cascade',
  );
  await pool.query(`insert into fee_rules (scope, scope_id, calc_type, params, currency, valid_from)
    values ('platform', null, 'percent_fixed', '{"percent_bps": 400, "fixed_amount": 100}', 'XAF', now() - interval '1 minute')`);
  deps = testDependencies(pool);
  app = await buildApp(deps);
  payout = fakePayoutProvider();
  organizer = await register('orga@exemple.com');
});

afterAll(async () => {
  await pool.end();
});

describe('reversements (R21, R22, O9)', () => {
  it('une commande payée : exactement un versement du bon montant, envoyé une seule fois', async () => {
    const event = await publishedEvent();
    await paidOrder(event, 2);
    const [created] = await payoutsOf();
    // 2 billets à 5 000 FCFA, frais 2 × (200 + 100) : 9 400 FCFA reversés.
    expect(created).toMatchObject({ amount: '9400', payout_total: '9400', status: 'pending' });
    await sendDuePayouts(db, payout);
    await sendDuePayouts(db, payout);
    const [sent] = await payoutsOf();
    expect(sent).toMatchObject({ status: 'sent', attempts: 1, destination: '+23566998877' });
    expect([...payout.transfers.values()]).toEqual([
      expect.objectContaining({ status: 'sent', amount: 9400, destination: '+23566998877' }),
    ]);
    expect(sent!.provider_ref).toBe(
      ([...payout.transfers.values()][0] as { providerRef: string }).providerRef,
    );
  });

  it('deux envois en même temps : chaque versement ne part qu’une fois', async () => {
    const event = await publishedEvent();
    await paidOrder(event, 1);
    await paidOrder(event, 1);
    await paidOrder(event, 1);
    await Promise.all([sendDuePayouts(db, payout), sendDuePayouts(db, payout)]);
    expect((await payoutsOf()).map((row) => row.status)).toEqual(['sent', 'sent', 'sent']);
    expect(payout.transfers.size).toBe(3);
  });

  it('panne passagère : reprise espacée avec la même clé, sans double envoi', async () => {
    const event = await publishedEvent();
    await paidOrder(event);
    payout.unavailable = true;
    await sendDuePayouts(db, payout);
    const [waiting] = await payoutsOf();
    expect(waiting).toMatchObject({ status: 'pending', attempts: 1 });
    // Pas de nouvel essai avant le délai de la première reprise.
    await sendDuePayouts(db, payout);
    expect((await payoutsOf())[0]!.attempts).toBe(1);
    payout.unavailable = false;
    await due();
    await sendDuePayouts(db, payout);
    expect((await payoutsOf())[0]).toMatchObject({ status: 'sent', attempts: 2 });
    expect(payout.transfers.size).toBe(1);
  });

  it('coupure entre l’envoi et son enregistrement : reprise sans second transfert', async () => {
    const event = await publishedEvent();
    await paidOrder(event);
    const [row] = await payoutsOf();
    // Le prestataire a fait le transfert, mais le processus s'est arrêté avant de le noter.
    const first = await payout.send({
      key: payoutKey({ id: row!.id, sendGeneration: 0 }),
      amount: Number(row!.amount),
      destination: row!.destination,
    });
    await sendDuePayouts(db, payout);
    const [after] = await payoutsOf();
    expect(after!.status).toBe('sent');
    expect(after!.provider_ref).toBe((first as { providerRef: string }).providerRef);
    expect(payout.transfers.size).toBe(1);
  });

  it('issue inconnue répétée : jamais « échoué », jamais relancée vers un autre numéro (revue B1)', async () => {
    const event = await publishedEvent();
    await paidOrder(event);
    const [row] = await payoutsOf();
    // Le transfert a eu lieu chez le prestataire, mais chaque réponse se perd ensuite.
    const first = await payout.send({
      key: payoutKey({ id: row!.id, sendGeneration: 0 }),
      amount: Number(row!.amount),
      destination: row!.destination,
    });
    payout.unavailable = true;
    for (let attempt = 0; attempt <= PAYOUT_RETRY_MINUTES.length + 2; attempt += 1) {
      await due();
      await sendDuePayouts(db, payout);
    }
    expect((await payoutsOf())[0]).toMatchObject({
      status: 'pending',
      destination: '+23566998877',
    });
    // L'organisateur change de numéro : un versement à l'issue inconnue ne repart pas ailleurs.
    await setPayoutNumber(organizer, '66 99 88 11');
    expect((await payoutsOf())[0]).toMatchObject({
      status: 'pending',
      destination: '+23566998877',
    });
    payout.unavailable = false;
    await due();
    await sendDuePayouts(db, payout);
    const [after] = await payoutsOf();
    expect(after).toMatchObject({ status: 'sent', destination: '+23566998877' });
    expect(after!.provider_ref).toBe((first as { providerRef: string }).providerRef);
    expect(payout.transfers.size).toBe(1);
  });

  it('envoi trop long : abandonné et repris plus tard avec la même clé', async () => {
    const event = await publishedEvent();
    await paidOrder(event);
    const slow: PayoutPort = {
      name: 'lent',
      send: () => new Promise(() => undefined),
    };
    await sendDuePayouts(db, slow, undefined, 20, 50);
    expect((await payoutsOf())[0]).toMatchObject({ status: 'pending', attempts: 1 });
    await due();
    await sendDuePayouts(db, payout);
    expect((await payoutsOf())[0]).toMatchObject({ status: 'sent', attempts: 2 });
    expect(payout.transfers.size).toBe(1);
  });

  it('numéro refusé : « échoué » ; nouveau numéro : le versement repart vers lui', async () => {
    const refused = await register('refus@exemple.com', '66 99 88 00');
    const event = await publishedEvent(refused);
    await paidOrder(event);
    await sendDuePayouts(db, payout);
    expect((await payoutsOf())[0]).toMatchObject({ status: 'failed' });
    const failed = await overview(refused);
    expect(failed.hasFailed).toBe(true);
    expect(failed.groups[0]).toMatchObject({ status: 'failed', amount: 9400 });

    await setPayoutNumber(refused, '66 99 88 11');
    expect((await payoutsOf())[0]).toMatchObject({
      status: 'pending',
      attempts: 0,
      destination: '+23566998811',
    });
    await sendDuePayouts(db, payout);
    expect((await payoutsOf())[0]).toMatchObject({ status: 'sent' });
    expect((await overview(refused)).hasFailed).toBe(false);
    // Nouvel envoi (nouvelle clé), tracé avec l'ancien numéro masqué et la raison du refus.
    expect([...payout.transfers.keys()].map((key) => key.split(':')[1])).toEqual(['0', '1']);
    const audit = await pool.query(
      "select before, after from audit_log where action = 'payout.requeue'",
    );
    expect(audit.rows).toEqual([
      {
        before: {
          status: 'failed',
          destination: '+235 66 •• •• 00',
          lastError: 'invalid_destination',
          sendGeneration: 0,
        },
        after: {
          status: 'pending',
          method: 'airtel_money',
          destination: '+235 66 •• •• 11',
          sendGeneration: 1,
        },
      },
    ]);
  });

  it('retenu faute de moyen de versement : repart quand l’organisateur en enregistre un', async () => {
    const event = await publishedEvent();
    await paidOrder(event);
    await pool.query("update payouts set status = 'held', method = 'none', destination = ''");
    await setPayoutNumber(organizer, '66 99 88 22');
    expect((await payoutsOf())[0]).toMatchObject({
      status: 'pending',
      destination: '+23566998822',
    });
    // Un versement retenu pour suspension, lui, ne bouge pas.
    await pool.query("update payouts set status = 'held', method = 'airtel_money'");
    await setPayoutNumber(organizer, '66 99 88 33');
    expect((await payoutsOf())[0]).toMatchObject({ status: 'held', destination: '+23566998822' });
  });

  it('organisateur ou événement suspendu au moment de l’envoi : « retenu », rien ne part', async () => {
    const event = await publishedEvent();
    await paidOrder(event);
    await pool.query("update organizers set status = 'suspended'");
    await sendDuePayouts(db, payout);
    expect((await payoutsOf())[0]).toMatchObject({ status: 'held' });

    await pool.query("update organizers set status = 'active'");
    const other = await publishedEvent(organizer, 'Autre soirée');
    await paidOrder(other);
    await pool.query("update events set status = 'suspended' where id = $1", [other.id]);
    await sendDuePayouts(db, payout);
    expect((await payoutsOf()).map((row) => row.status)).toEqual(['held', 'held']);
    expect(payout.transfers.size).toBe(0);
  });

  it('vue de l’organisateur : par événement et statut, prochain reversement ; isolation', async () => {
    const first = await publishedEvent(organizer, 'Soirée Sahel Live');
    const second = await publishedEvent(organizer, 'Concert de la Paix');
    await paidOrder(first, 1);
    await sendDuePayouts(db, payout);
    await paidOrder(first, 2);
    await paidOrder(second, 1);
    const result = await overview();
    expect(result.pendingTo).toEqual({ method: 'airtel_money', maskedNumber: '+235 66 •• •• 77' });
    expect(result.pendingAmount).toBe(9400 + 4700);
    expect(result.hasFailed).toBe(false);
    // À traiter d'abord (en attente), le plus récent en tête ; puis les envois faits.
    expect(
      result.groups.map((group) => [group.title, group.status, group.amount, group.count]),
    ).toEqual([
      ['Concert de la Paix', 'pending', 4700, 1],
      ['Soirée Sahel Live', 'pending', 9400, 1],
      ['Soirée Sahel Live', 'sent', 4700, 1],
    ]);
    expect(result.groups.find((group) => group.status === 'sent')!.date).not.toBeNull();

    // Retenus et échoués ne comptent pas dans le prochain reversement.
    await pool.query(
      "update payouts set status = 'held' where order_id in (select o.id from orders o join events e on e.id = o.event_id where e.title = 'Concert de la Paix')",
    );
    const held = await overview();
    expect(held.pendingAmount).toBe(9400);
    expect(held.groups[0]).toMatchObject({ title: 'Concert de la Paix', status: 'held' });

    const intruder = await register('autre@exemple.com');
    expect((await overview(intruder)).groups).toEqual([]);
    expect((await call({ url: '/api/v1/organizer/payouts' })).statusCode).toBe(401);
  });
});
