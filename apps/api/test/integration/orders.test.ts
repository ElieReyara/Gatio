import { errorResponseSchema, orderCreatedSchema, orderSchema } from '@gatio/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import { releaseExpiredReservations } from '../../src/modules/orders/expiry.js';
import { testDependencies, testOrigin } from '../../src/test-support.js';
import { testDatabaseUrl } from './database.js';

// Assez de connexions pour de vraies requêtes simultanées.
const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 20 });
const db = drizzle({ client: pool, schema });
let app: FastifyInstance;
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

function errorOf(response: { json(): unknown }) {
  return errorResponseSchema.parse(response.json()).error;
}

async function setupEvent(
  categories: Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
) {
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
      ...overrides,
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

// Chaque appel vient d'une adresse et d'un numéro différents, sauf indication.
function order(
  slug: string,
  items: Array<{ categoryId: string; quantity: number }>,
  options: { key?: string; phone?: string; ip?: string } = {},
) {
  counter += 1;
  return app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    headers: {
      origin: testOrigin,
      'idempotency-key': options.key ?? `cle-${counter}-${Date.now()}`,
      'x-forwarded-for': options.ip ?? `10.0.${Math.floor(counter / 250) % 250}.${counter % 250}`,
    },
    payload: {
      eventSlug: slug,
      items,
      contact: {
        name: 'Mahamat Idriss',
        phone: options.phone ?? `66${String(100000 + counter).slice(-6)}`,
        email: 'acheteur@exemple.com',
      },
    },
  });
}

const reserved = async (categoryId: string) =>
  (
    await pool.query(
      'select quantity_reserved, quantity_sold from ticket_categories where id = $1',
      [categoryId],
    )
  ).rows[0] as { quantity_reserved: number; quantity_sold: number };

beforeEach(async () => {
  await pool.query(
    'truncate users, organizers, auth_sessions, password_resets, rate_limit_counters, events, ticket_categories, fee_rules, audit_log, buyers, orders, order_items, funnel_events, payments, payment_webhook_events, reconciliation_runs, discrepancies, payouts, tickets, email_verifications, outbound_messages cascade',
  );
  await pool.query(`insert into fee_rules (scope, scope_id, calc_type, params, currency, valid_from)
    values ('platform', null, 'percent_fixed', '{"percent_bps": 400, "fixed_amount": 100}', 'XAF', now() - interval '1 minute')`);
  app = await buildApp(testDependencies(pool));
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

describe('réservation (R5, R8, R30)', () => {
  it('crée la commande, réserve le stock, fige les trois montants et donne un jeton de commande', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const response = await order(slug, [{ categoryId: categoryIds[0]!, quantity: 2 }], {
      phone: '66 12 34 56',
    });
    expect(response.statusCode).toBe(201);
    const created = orderCreatedSchema.parse(response.json());
    expect(created.reference).toMatch(/^GT-[2-9A-HJ-NP-Z]{6}$/);
    expect(created.total).toBe(10_000);
    const minutes = (new Date(created.reservationExpiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15.1);
    expect((await reserved(categoryIds[0]!)).quantity_reserved).toBe(2);

    const { rows } = await pool.query(
      'select o.total_amount, o.fee_total, o.payout_total, i.unit_price, i.unit_fee, i.unit_payout, o.access_token_hash, b.phone_e164 from orders o join order_items i on i.order_id = o.id join buyers b on b.id = o.buyer_id',
    );
    expect(rows[0]).toMatchObject({
      total_amount: '10000',
      fee_total: '600',
      payout_total: '9400',
      unit_price: '5000',
      unit_fee: '300',
      unit_payout: '4700',
      phone_e164: '+23566123456',
    });
    expect(rows[0].access_token_hash).not.toBe(created.orderToken);

    const read = await app.inject({
      url: `/api/v1/orders/${created.orderId}`,
      headers: { 'x-order-token': created.orderToken },
    });
    expect(orderSchema.parse(read.json())).toMatchObject({
      status: 'pending',
      total: 10_000,
      items: [{ categoryName: 'Standard', quantity: 2, lineTotal: 10_000 }],
    });
    const wrong = await app.inject({
      url: `/api/v1/orders/${created.orderId}`,
      headers: { 'x-order-token': 'faux' },
    });
    expect(wrong.statusCode).toBe(404);
  });

  it('un numéro = un compte : deux commandes du même numéro gardent le même acheteur', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    await order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }], { phone: '66 12 34 56' });
    await order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }], { phone: '+235 66123456' });
    const { rows } = await pool.query('select count(*)::int as n from buyers');
    expect(rows[0].n).toBe(1);
  });

  it('exige la clé de rejeu ; rejouer la même clé ne crée pas deux commandes', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const items = [{ categoryId: categoryIds[0]!, quantity: 1 }];
    const noKey = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { origin: testOrigin },
      payload: { eventSlug: slug, items, contact: { name: 'A', phone: '66123456' } },
    });
    expect(errorOf(noKey).details).toMatchObject({ reason: 'idempotency_key_required' });

    const options = { key: 'cle-rejeu-unique', ip: '10.9.9.9', phone: '66 55 44 33' };
    const [first, second] = await Promise.all([
      order(slug, items, options),
      order(slug, items, options),
    ]);
    const ids = [first, second].map(
      (response) => orderCreatedSchema.parse(response.json()).orderId,
    );
    expect(ids[0]).toBe(ids[1]);
    expect((await reserved(categoryIds[0]!)).quantity_reserved).toBe(1);
    const third = orderCreatedSchema.parse((await order(slug, items, options)).json());
    expect(third.orderId).toBe(ids[0]);
    // Le dernier jeton donné ouvre la commande.
    const read = await app.inject({
      url: `/api/v1/orders/${third.orderId}`,
      headers: { 'x-order-token': third.orderToken },
    });
    expect(read.statusCode).toBe(200);
  });

  it('100 acheteurs simultanés pour le dernier billet : un seul gagne (invariant 1)', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Dernier', priceAmount: 5_000, quantityTotal: 1 },
    ]);
    const responses = await Promise.all(
      Array.from({ length: 100 }, () =>
        order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]),
      ),
    );
    const codes = responses.map((response) => response.statusCode);
    expect(codes.filter((code) => code === 201)).toHaveLength(1);
    const refused = responses.filter((response) => response.statusCode !== 201);
    expect(new Set(refused.map((response) => errorOf(response).code))).toEqual(
      new Set(['STOCK_INSUFFICIENT']),
    );
    expect(await reserved(categoryIds[0]!)).toEqual({ quantity_reserved: 1, quantity_sold: 0 });
  });

  it('10 billets au plus par commande ; 3 commandes en attente au plus par numéro (R10)', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const tooMany = await order(slug, [{ categoryId: categoryIds[0]!, quantity: 11 }]);
    expect(errorOf(tooMany).code).toBe('VALIDATION_ERROR');
    for (let i = 0; i < 3; i++) {
      expect(
        (
          await order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }], {
            phone: '66 12 34 56',
          })
        ).statusCode,
      ).toBe(201);
    }
    const fourth = await order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }], {
      phone: '66 12 34 56',
    });
    expect(errorOf(fourth)).toMatchObject({
      code: 'RATE_LIMITED',
      details: { reason: 'too_many_pending' },
    });
  });

  it('une commande sur plusieurs catégories est tout ou rien', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
      { name: 'VIP', priceAmount: 20_000, quantityTotal: 1 },
    ]);
    const response = await order(slug, [
      { categoryId: categoryIds[0]!, quantity: 3 },
      { categoryId: categoryIds[1]!, quantity: 2 },
    ]);
    expect(errorOf(response)).toMatchObject({
      code: 'STOCK_INSUFFICIENT',
      details: { remaining: 1 },
    });
    expect((await reserved(categoryIds[0]!)).quantity_reserved).toBe(0);
  });
});

describe('période de vente et statut (R12)', () => {
  it('refuse hors période ; la catégorie « jour J » s’ouvre à son heure, à son propre prix', async () => {
    const start = days(30);
    const { slug, categoryIds } = await setupEvent(
      [
        { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
        {
          name: 'Jour J',
          priceAmount: 7_000,
          quantityTotal: 50,
          saleStartsAt: new Date(start.getTime() - 10 * 3600 * 1000).toISOString(),
          saleEndsAt: new Date(start.getTime() + 4 * 3600 * 1000).toISOString(),
        },
      ],
      { startsAt: start.toISOString() },
    );
    const early = await order(slug, [{ categoryId: categoryIds[1]!, quantity: 1 }]);
    expect(errorOf(early)).toMatchObject({
      code: 'CATEGORY_NOT_ON_SALE',
      details: { reason: 'not_open' },
    });
    await pool.query(
      "update ticket_categories set sale_starts_at = now() - interval '1 minute' where id = $1",
      [categoryIds[1]],
    );
    const open = orderCreatedSchema.parse(
      (await order(slug, [{ categoryId: categoryIds[1]!, quantity: 1 }])).json(),
    );
    expect(open.total).toBe(7_000);
  });

  it('refuse un événement qui n’est pas publié', async () => {
    const { id, slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${id}/postpone`,
      cookie: organizer,
    });
    expect(errorOf(await order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }])).code).toBe(
      'EVENT_NOT_ON_SALE',
    );
  });

  it('annuler pendant des réservations simultanées : aucune réservation après l’annulation (invariant 6)', async () => {
    const { id, slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 500 },
    ]);
    const reservations = Array.from({ length: 30 }, () =>
      order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]),
    );
    const cancel = call({
      method: 'POST',
      url: `/api/v1/organizer/events/${id}/cancel`,
      cookie: organizer,
    });
    const results = await Promise.all([...reservations, cancel]);
    expect(results.at(-1)!.statusCode).toBe(200);
    const codes = results
      .slice(0, -1)
      .map((response) => (response.statusCode === 201 ? 'ok' : errorOf(response).code));
    expect(new Set(codes)).toSatisfy((set: Set<string>) =>
      [...set].every((code) => ['ok', 'EVENT_NOT_ON_SALE'].includes(code)),
    );
    // Le stock réservé correspond exactement aux commandes acceptées.
    expect((await reserved(categoryIds[0]!)).quantity_reserved).toBe(
      codes.filter((code) => code === 'ok').length,
    );
    const after = await Promise.all(
      Array.from({ length: 5 }, () => order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }])),
    );
    expect(after.map((response) => errorOf(response).code)).toEqual(
      Array(5).fill('EVENT_NOT_ON_SALE'),
    );
  });
});

describe('expiration des réservations (R9)', () => {
  it('libère le stock d’une réservation expirée, sans effet double si on rejoue', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 2 },
    ]);
    const created = orderCreatedSchema.parse(
      (await order(slug, [{ categoryId: categoryIds[0]!, quantity: 2 }])).json(),
    );
    expect(errorOf(await order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }])).code).toBe(
      'STOCK_INSUFFICIENT',
    );
    await pool.query("update orders set reservation_expires_at = now() - interval '1 second'");
    expect(await releaseExpiredReservations(db)).toBe(1);
    expect(await releaseExpiredReservations(db)).toBe(0);
    expect((await reserved(categoryIds[0]!)).quantity_reserved).toBe(0);
    const read = await app.inject({
      url: `/api/v1/orders/${created.orderId}`,
      headers: { 'x-order-token': created.orderToken },
    });
    expect(orderSchema.parse(read.json())).toMatchObject({
      status: 'expired',
      remainingSeconds: 0,
    });
    expect((await order(slug, [{ categoryId: categoryIds[0]!, quantity: 2 }])).statusCode).toBe(
      201,
    );
  });
});

describe('frais figés (R5, invariant 5)', () => {
  it('changer la règle de frais ou le prix ne change pas une commande existante', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 20_000, quantityTotal: 100 },
    ]);
    const before = orderCreatedSchema.parse(
      (await order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }])).json(),
    );
    await pool.query(`insert into fee_rules (scope, scope_id, calc_type, params, currency, valid_from)
      values ('platform', null, 'percent_fixed', '{"percent_bps": 1000, "fixed_amount": 0}', 'XAF', now() - interval '1 second')`);
    await call({
      method: 'PATCH',
      url: `/api/v1/organizer/categories/${categoryIds[0]}`,
      cookie: organizer,
      payload: { priceAmount: 25_000 },
    });
    const { rows } = await pool.query(
      'select unit_price, unit_fee, unit_payout from order_items where order_id = $1',
      [before.orderId],
    );
    expect(rows[0]).toEqual({ unit_price: '20000', unit_fee: '900', unit_payout: '19100' });
    const after = orderCreatedSchema.parse(
      (await order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }])).json(),
    );
    const { rows: newRows } = await pool.query(
      'select unit_price, unit_fee from order_items where order_id = $1',
      [after.orderId],
    );
    expect(newRows[0]).toEqual({ unit_price: '25000', unit_fee: '2500' });
  });
});

describe('mesures du parcours (§8)', () => {
  it('enregistre une ouverture de page sans donnée personnelle', async () => {
    const { slug } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 10 },
    ]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/funnel-events',
      headers: { origin: testOrigin },
      payload: { type: 'event_view', eventSlug: slug, anonSessionId: 'session-anonyme-1' },
    });
    expect(response.statusCode).toBe(202);
    const { rows } = await pool.query('select type, anon_session_id from funnel_events');
    expect(rows).toEqual([{ type: 'event_view', anon_session_id: 'session-anonyme-1' }]);
  });
});

describe('cas relevés par la revue isolée', () => {
  it('5 commandes simultanées du même numéro : 3 au plus réussissent (R10)', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }], { phone: '66 77 77 77' }),
      ),
    );
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(3);
    expect((await reserved(categoryIds[0]!)).quantity_reserved).toBe(3);
  });

  it('rejeu : autre demande refusée, réservation expirée signalée', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const options = { key: 'cle-rejeu-0000000002', ip: '10.9.9.8', phone: '66 55 44 34' };
    await order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }], options);
    const other = await order(slug, [{ categoryId: categoryIds[0]!, quantity: 2 }], options);
    expect(errorOf(other).details).toMatchObject({ reason: 'idempotency_key_reused' });
    await pool.query("update orders set reservation_expires_at = now() - interval '1 second'");
    await releaseExpiredReservations(db);
    const late = await order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }], options);
    expect(errorOf(late).code).toBe('RESERVATION_EXPIRED');
    expect((await reserved(categoryIds[0]!)).quantity_reserved).toBe(0);
  });

  it('brouillon : 404 comme un lien inconnu ; catégorie archivée ou inconnue refusée', async () => {
    const { id, slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
      { name: 'VIP', priceAmount: 20_000, quantityTotal: 10 },
    ]);
    await call({
      method: 'DELETE',
      url: `/api/v1/organizer/categories/${categoryIds[1]}`,
      cookie: organizer,
    });
    expect(
      errorOf(await order(slug, [{ categoryId: categoryIds[1]!, quantity: 1 }])),
    ).toMatchObject({
      code: 'CATEGORY_NOT_ON_SALE',
      details: { reason: 'archived' },
    });
    const unknown = await order(slug, [
      { categoryId: '00000000-0000-4000-8000-000000000000', quantity: 1 },
    ]);
    expect(errorOf(unknown).details).toMatchObject({ reason: 'unknown_category' });
    await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${id}/unpublish`,
      cookie: organizer,
    });
    const draft = await order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }]);
    expect(draft.statusCode).toBe(404);
  });

  it('même catégorie écrite en majuscules et en minuscules : refusée comme doublon', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const response = await order(slug, [
      { categoryId: categoryIds[0]!, quantity: 1 },
      { categoryId: categoryIds[0]!.toUpperCase(), quantity: 1 },
    ]);
    expect(errorOf(response).code).toBe('VALIDATION_ERROR');
  });

  it('lecture d’une commande sans jeton : 404, jamais gardée en cache', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
    ]);
    const created = orderCreatedSchema.parse(
      (await order(slug, [{ categoryId: categoryIds[0]!, quantity: 1 }])).json(),
    );
    expect((await app.inject({ url: `/api/v1/orders/${created.orderId}` })).statusCode).toBe(404);
    const read = await app.inject({
      url: `/api/v1/orders/${created.orderId}`,
      headers: { 'x-order-token': created.orderToken },
    });
    expect(read.headers['cache-control']).toBe('no-store');
  });

  it('expirations pendant des commandes sur deux catégories : aucun interblocage', async () => {
    const { slug, categoryIds } = await setupEvent([
      { name: 'Standard', priceAmount: 5_000, quantityTotal: 500 },
      { name: 'VIP', priceAmount: 20_000, quantityTotal: 500 },
    ]);
    const both = [
      { categoryId: categoryIds[0]!, quantity: 1 },
      { categoryId: categoryIds[1]!, quantity: 1 },
    ];
    for (let round = 0; round < 3; round++) {
      await Promise.all(Array.from({ length: 10 }, () => order(slug, both)));
      await pool.query("update orders set reservation_expires_at = now() - interval '1 second'");
      const results = await Promise.all([
        ...Array.from({ length: 10 }, () => order(slug, both)),
        releaseExpiredReservations(db, 3),
        releaseExpiredReservations(db, 3),
        releaseExpiredReservations(db, 3),
      ]);
      const responses = results.slice(0, 10) as Awaited<ReturnType<typeof order>>[];
      expect(responses.map((response) => response.statusCode)).toEqual(Array(10).fill(201));
    }
    while ((await releaseExpiredReservations(db)) > 0) {
      /* continue */
    }
    const { rows } = await pool.query(
      "select count(*)::int as n from orders where status = 'pending'",
    );
    expect((await reserved(categoryIds[0]!)).quantity_reserved).toBe(rows[0].n);
    expect((await reserved(categoryIds[1]!)).quantity_reserved).toBe(rows[0].n);
  });
});
