import { eventStatsSchema, orderCreatedSchema } from '@gatio/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FakePaymentProvider } from '../../src/modules/payments/fake-provider.js';
import { testDependencies, testOrigin } from '../../src/test-support.js';
import { testDatabaseUrl } from './database.js';

const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 10 });
let app: FastifyInstance;
let deps: ReturnType<typeof testDependencies>;
let organizer: string;
let counter = 0;

function call(options: InjectOptions & { cookie?: string }) {
  const { cookie, headers, ...rest } = options;
  counter += 1;
  return app.inject({
    ...rest,
    headers: {
      origin: testOrigin,
      'x-forwarded-for': `10.6.${Math.floor(counter / 250) % 250}.${counter % 250}`,
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
  });
}

async function register(email: string) {
  const response = await call({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'motdepasse1', displayName: 'Sahel Culture' },
  });
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  await call({
    method: 'PUT',
    url: '/api/v1/organizer/payout-account',
    cookie,
    payload: { method: 'airtel_money', number: '66 99 88 77' },
  });
  return cookie;
}

async function publishedEvent() {
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
      startsAt: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
      capacity: 500,
    },
  });
  const event = created.json() as { id: string; slug: string };
  const category = async (name: string, priceAmount: number, quantityTotal: number) =>
    (
      (
        await call({
          method: 'POST',
          url: `/api/v1/organizer/events/${event.id}/categories`,
          cookie: organizer,
          payload: { name, priceAmount, quantityTotal },
        })
      ).json() as { id: string }
    ).id;
  const standard = await category('Standard', 5_000, 150);
  const vip = await category('VIP', 20_000, 50);
  await call({
    method: 'POST',
    url: `/api/v1/organizer/events/${event.id}/publish`,
    cookie: organizer,
  });
  return { ...event, standard, vip };
}

function reserve(
  event: { slug: string },
  items: Array<{ categoryId: string; quantity: number }>,
  contact: { name: string; phone: string; email?: string },
) {
  return call({
    method: 'POST',
    url: '/api/v1/orders',
    headers: { 'idempotency-key': `cle-stats-${counter}-${Date.now()}` },
    payload: { eventSlug: event.slug, items, contact },
  });
}

async function paidOrder(
  event: { slug: string },
  items: Array<{ categoryId: string; quantity: number }>,
  contact: { name: string; phone: string; email?: string },
) {
  const order = orderCreatedSchema.parse((await reserve(event, items, contact)).json());
  await call({
    method: 'POST',
    url: `/api/v1/orders/${order.orderId}/payments`,
    headers: {
      'idempotency-key': `cle-paiement-stats-${counter}`,
      'x-order-token': order.orderToken,
    },
    payload: { method: 'airtel_money' },
  });
  const fake = deps.payments as FakePaymentProvider;
  const ref = fake.list().find((payment) => payment.status === 'pending')!.providerRef;
  await call({
    method: 'POST',
    url: `/api/v1/dev/fake-payments/${ref}`,
    payload: { outcome: 'accept' },
  });
  await deps.settle();
  return order;
}

const stats = async (eventId: string, cookie = organizer) =>
  call({ url: `/api/v1/organizer/events/${eventId}/stats`, cookie });
const csv = (eventId: string, cookie = organizer) =>
  call({ url: `/api/v1/organizer/events/${eventId}/buyers.csv`, cookie });

beforeEach(async () => {
  await pool.query(
    'truncate users, organizers, auth_sessions, password_resets, rate_limit_counters, events, ticket_categories, fee_rules, audit_log, buyers, orders, order_items, funnel_events, payments, payment_webhook_events, tickets, email_verifications, outbound_messages, otp_codes, scanner_invites, scanner_sessions, manifest_downloads, passages cascade',
  );
  await pool.query(`insert into fee_rules (scope, scope_id, calc_type, params, currency, valid_from)
    values ('platform', null, 'percent_fixed', '{"percent_bps": 400, "fixed_amount": 100}', 'XAF', now() - interval '1 minute')`);
  deps = testDependencies(pool);
  app = await buildApp(deps);
  organizer = await register('orga@exemple.com');
});

afterAll(async () => {
  await pool.end();
});

describe('tableau de bord et export (O6, S4, S5)', () => {
  it('chiffres exacts : commandes payées seulement, réservations en cours retirées des restants', async () => {
    const event = await publishedEvent();
    await paidOrder(event, [{ categoryId: event.standard, quantity: 2 }], {
      name: 'Mahamat Idriss',
      phone: '66 12 34 56',
    });
    await paidOrder(
      event,
      [
        { categoryId: event.standard, quantity: 1 },
        { categoryId: event.vip, quantity: 1 },
      ],
      { name: 'Fatimé Ali', phone: '66 65 43 21' },
    );
    // Réservation en cours, non payée : ni vendue ni comptée dans les montants.
    await reserve(event, [{ categoryId: event.vip, quantity: 3 }], {
      name: 'Moussa',
      phone: '66 11 22 33',
    });

    const response = await stats(event.id);
    expect(response.statusCode).toBe(200);
    const result = eventStatsSchema.parse(response.json());
    // Frais : 4 % + 100 FCFA par billet (règle de départ) : 3 × 300 (Standard) + 900 (VIP).
    expect(result).toEqual({
      sold: 4,
      total: 200,
      paidAmount: 35_000,
      payoutAmount: 33_200,
      currency: 'XAF',
      categories: [
        { id: event.standard, name: 'Standard', sold: 3, remaining: 147, archived: false },
        { id: event.vip, name: 'VIP', sold: 1, remaining: 46, archived: false },
      ],
    });
  });

  it('commandes expirées, autre événement, catégorie retirée avec des ventes', async () => {
    const event = await publishedEvent();
    const other = await publishedEvent();
    await paidOrder(event, [{ categoryId: event.vip, quantity: 2 }], {
      name: 'Mahamat Idriss',
      phone: '66 12 34 56',
    });
    await paidOrder(other, [{ categoryId: other.standard, quantity: 5 }], {
      name: 'Fatimé Ali',
      phone: '66 65 43 21',
    });
    const expired = orderCreatedSchema.parse(
      (
        await reserve(event, [{ categoryId: event.standard, quantity: 4 }], {
          name: 'Moussa',
          phone: '66 11 22 33',
        })
      ).json(),
    );
    // Réservation expirée : ni vendue, ni dans les montants, ni dans l'export.
    await pool.query("update orders set status = 'expired' where id = $1", [expired.orderId]);
    // Catégorie VIP retirée de la vente après deux ventes.
    await pool.query('update ticket_categories set archived_at = now() where id = $1', [event.vip]);

    const result = eventStatsSchema.parse((await stats(event.id)).json());
    expect(result).toMatchObject({ sold: 2, total: 152, paidAmount: 40_000 });
    expect(result.categories).toEqual([
      expect.objectContaining({ name: 'Standard', sold: 0, archived: false }),
      { id: event.vip, name: 'VIP', sold: 2, remaining: 0, archived: true },
    ]);
    const exported = (await csv(event.id)).body;
    expect(exported).toContain('Mahamat Idriss');
    expect(exported).not.toContain('Moussa');
    expect(exported).not.toContain('Fatimé');
  });

  it('événement sans vente : zéros', async () => {
    const event = await publishedEvent();
    const result = eventStatsSchema.parse((await stats(event.id)).json());
    expect(result).toMatchObject({ sold: 0, total: 200, paidAmount: 0, payoutAmount: 0 });
  });

  it('export des acheteurs : colonnes, formules neutralisées, accents, trace d’audit', async () => {
    const event = await publishedEvent();
    await paidOrder(event, [{ categoryId: event.standard, quantity: 2 }], {
      name: '=HYPERLINK("https://exemple.com","Cliquez")',
      phone: '66 12 34 56',
      email: 'acheteur@exemple.com',
    });
    await paidOrder(
      event,
      [
        { categoryId: event.standard, quantity: 1 },
        { categoryId: event.vip, quantity: 1 },
      ],
      { name: 'Fatimé; Ali', phone: '+235 66 65 43 21' },
    );
    await reserve(event, [{ categoryId: event.vip, quantity: 1 }], {
      name: 'Moussa',
      phone: '66 11 22 33',
    });

    const response = await csv(event.id);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="acheteurs-${event.slug}.csv"`,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    const text = response.body;
    expect(text.startsWith('\uFEFF')).toBe(true);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      '"Référence";"Nom";"Téléphone";"Billets";"Montant payé (FCFA)";"Payée le"',
    );
    expect(lines).toHaveLength(4); // en-tête, deux commandes payées, fin de fichier
    const first = lines[1]!.split(';');
    expect(first[0]).toMatch(/^"GT-/);
    // Formule neutralisée par une apostrophe, puis protégée par des guillemets.
    expect(lines[1]).toContain('"\'=HYPERLINK(""https://exemple.com"",""Cliquez"")"');
    expect(lines[1]).toContain(';"66 12 34 56";"2 × Standard";10000;');
    // L'email saisi à l'achat (non vérifié) n'est pas exporté.
    expect(text).not.toContain('acheteur@exemple.com');
    expect(lines[2]).toContain('"Fatimé; Ali";"66 65 43 21";"1 × Standard, 1 × VIP";25000;');
    expect(lines[1]).toMatch(/;"\d{4}-\d{2}-\d{2} \d{2}:\d{2}"$/);
    expect(text).not.toContain('Moussa');

    const audit = await pool.query(
      "select action, entity_id, after from audit_log where action = 'event.buyers_export'",
    );
    expect(audit.rows).toEqual([
      { action: 'event.buyers_export', entity_id: event.id, after: { rows: 2 } },
    ]);
  });

  it('isolation : un autre organisateur ne voit ni chiffres ni acheteurs (S5)', async () => {
    const event = await publishedEvent();
    await paidOrder(event, [{ categoryId: event.standard, quantity: 1 }], {
      name: 'Mahamat Idriss',
      phone: '66 12 34 56',
    });
    const intruder = await register('autre@exemple.com');
    expect((await stats(event.id, intruder)).statusCode).toBe(404);
    const stolen = await csv(event.id, intruder);
    expect(stolen.statusCode).toBe(404);
    expect(stolen.body).not.toContain('Mahamat');
    expect(
      (await call({ url: `/api/v1/organizer/events/${event.id}/buyers.csv` })).statusCode,
    ).toBe(401);
    // Pas de route HEAD : elle produirait l'export et sa trace.
    const head = await call({
      method: 'HEAD',
      url: `/api/v1/organizer/events/${event.id}/buyers.csv`,
      cookie: organizer,
    });
    expect(head.statusCode).toBe(404);
    const audit = await pool.query(
      "select count(*)::int as n from audit_log where action = 'event.buyers_export'",
    );
    expect(audit.rows[0].n).toBe(0);
  });
});
