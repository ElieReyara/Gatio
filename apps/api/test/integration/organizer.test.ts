import { categorySchema, errorResponseSchema, organizerEventDetailSchema } from '@gatio/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testDependencies, testOrigin } from '../../src/test-support.js';
import { testDatabaseUrl } from './database.js';

const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 4 });
let deps: ReturnType<typeof testDependencies>;
let app: FastifyInstance;
let alice: string;
let bob: string;

const inOneMonth = () => new Date(Date.now() + 30 * 24 * 3600 * 1000);
const event = (overrides: Record<string, unknown> = {}) => ({
  title: 'Soirée Sahel Live',
  description: 'Une soirée de musique.',
  eventType: 'concert',
  city: "N'Djamena",
  venue: 'Salle des fêtes',
  startsAt: inOneMonth().toISOString(),
  capacity: 500,
  ...overrides,
});

function call(cookie: string, options: InjectOptions) {
  return app.inject({ ...options, headers: { origin: testOrigin, cookie, ...options.headers } });
}

async function account(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin: testOrigin },
    payload: { email, password: 'motdepasse1', displayName: email },
  });
  return String(response.headers['set-cookie']).split(';')[0]!;
}

async function createEvent(cookie: string, overrides: Record<string, unknown> = {}) {
  const response = await call(cookie, {
    method: 'POST',
    url: '/api/v1/organizer/events',
    payload: event(overrides),
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; slug: string };
}

function createCategory(cookie: string, eventId: string, payload: Record<string, unknown>) {
  return call(cookie, {
    method: 'POST',
    url: `/api/v1/organizer/events/${eventId}/categories`,
    payload,
  });
}

function errorOf(response: { json(): unknown }) {
  return errorResponseSchema.parse(response.json()).error;
}

beforeEach(async () => {
  await pool.query(
    'truncate users, organizers, auth_sessions, password_resets, rate_limit_counters, events, ticket_categories, fee_rules, buyers, orders, order_items, funnel_events, payments, payment_webhook_events, reconciliation_runs, discrepancies, payouts, tickets cascade',
  );
  // Vider users en cascade vide aussi fee_rules (created_by) : on remet la règle de départ
  // de la migration 0003 (4 % + 100 FCFA).
  await pool.query(`insert into fee_rules (scope, scope_id, calc_type, params, currency, valid_from)
    values ('platform', null, 'percent_fixed', '{"percent_bps": 400, "fixed_amount": 100}', 'XAF', now() - interval '1 minute')`);
  deps = testDependencies(pool);
  app = await buildApp(deps);
  alice = await account('alice@exemple.com');
  bob = await account('bob@exemple.com');
});

afterAll(async () => {
  await pool.end();
});

describe('aperçu des frais (R2, R7) avec la règle de départ en base', () => {
  it.each([
    [1_000, 860],
    [5_000, 4_700],
    [20_000, 19_100],
    [50_000, 47_900],
  ])('billet à %i FCFA : l’organisateur reçoit %i', async (price, payout) => {
    const response = await call(alice, {
      method: 'POST',
      url: '/api/v1/organizer/fee-preview',
      payload: { price },
    });
    expect(response.json()).toMatchObject({
      price,
      payoutAmount: payout,
      percentBps: 400,
      fixedAmount: 100,
    });
  });

  it('applique la règle la plus précise : catégorie > événement > organisateur > plateforme (R4)', async () => {
    const { id: eventId } = await createEvent(alice);
    const { rows } = await pool.query('select organizer_id from events where id = $1', [eventId]);
    const organizerId = rows[0].organizer_id;
    const insertRule = (scope: string, scopeId: string, bps: number) =>
      pool.query(
        `insert into fee_rules (scope, scope_id, calc_type, params, currency, valid_from)
         values ($1, $2, 'percent_fixed', $3, 'XAF', now() - interval '1 minute')`,
        [scope, scopeId, JSON.stringify({ percent_bps: bps, fixed_amount: 0 })],
      );
    const preview = async () =>
      (
        await call(alice, {
          method: 'POST',
          url: '/api/v1/organizer/fee-preview',
          payload: { price: 10_000, eventId },
        })
      ).json() as {
        percentBps: number;
      };
    await insertRule('organizer', organizerId, 300);
    expect((await preview()).percentBps).toBe(300);
    await insertRule('event', eventId, 200);
    expect((await preview()).percentBps).toBe(200);
    // La règle d'un autre événement ne s'applique pas.
    await insertRule('event', '00000000-0000-4000-8000-000000000000', 100);
    expect((await preview()).percentBps).toBe(200);
  });
});

describe('événements', () => {
  it('crée un brouillon avec une adresse publique courte, visible seulement de son organisateur (S5)', async () => {
    const { id, slug } = await createEvent(alice);
    expect(slug).toMatch(/^[a-z2-9]{8}$/);
    const mine = await call(alice, { method: 'GET', url: `/api/v1/organizer/events/${id}` });
    expect(organizerEventDetailSchema.parse(mine.json())).toMatchObject({
      status: 'draft',
      capacity: 500,
    });
    expect(
      errorOf(await call(bob, { method: 'GET', url: `/api/v1/organizer/events/${id}` })).code,
    ).toBe('NOT_FOUND');
    expect(
      errorOf(
        await call(bob, {
          method: 'PATCH',
          url: `/api/v1/organizer/events/${id}`,
          payload: { title: 'Volé' },
        }),
      ).code,
    ).toBe('NOT_FOUND');
    const bobList = await call(bob, { method: 'GET', url: '/api/v1/organizer/events' });
    expect(bobList.json()).toEqual({ items: [], nextCursor: null });
  });

  it('refuse une date passée (maquette O3)', async () => {
    const response = await call(alice, {
      method: 'POST',
      url: '/api/v1/organizer/events',
      payload: event({ startsAt: '2020-01-05T18:00:00.000Z' }),
    });
    expect(errorOf(response).details).toMatchObject({ reason: 'not_in_future' });
  });

  it('pagine la liste avec un curseur', async () => {
    for (let i = 0; i < 3; i++) await createEvent(alice, { title: `Événement ${i}` });
    const first = (
      await call(alice, { method: 'GET', url: '/api/v1/organizer/events?limit=2' })
    ).json() as {
      items: unknown[];
      nextCursor: string;
    };
    expect(first.items).toHaveLength(2);
    const second = (
      await call(alice, {
        method: 'GET',
        url: `/api/v1/organizer/events?limit=2&cursor=${first.nextCursor}`,
      })
    ).json() as { items: unknown[]; nextCursor: string | null };
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('enregistre l’image en WebP de 1 200 px au plus', async () => {
    const { id } = await createEvent(alice);
    const png = await sharp({
      create: { width: 2400, height: 1200, channels: 3, background: '#a8431a' },
    })
      .png()
      .toBuffer();
    const response = await call(alice, {
      method: 'POST',
      url: `/api/v1/organizer/events/${id}/image`,
      payload: png,
      headers: { 'content-type': 'image/png' },
    });
    const imageUrl = (response.json() as { imageUrl: string }).imageUrl;
    const media = await app.inject({ method: 'GET', url: imageUrl });
    expect(media.headers['content-type']).toBe('image/webp');
    expect((await sharp(media.rawPayload).metadata()).width).toBe(1200);
  });

  it('refuse un fichier qui n’est pas une image', async () => {
    const { id } = await createEvent(alice);
    const response = await call(alice, {
      method: 'POST',
      url: `/api/v1/organizer/events/${id}/image`,
      payload: Buffer.from('pas une image'),
      headers: { 'content-type': 'image/jpeg' },
    });
    expect(errorOf(response).details).toMatchObject({ reason: 'invalid_image' });
  });
});

describe('catégories de billets', () => {
  it('crée une catégorie avec ses frais calculés', async () => {
    const { id } = await createEvent(alice);
    const response = await createCategory(alice, id, {
      name: 'VIP',
      priceAmount: 20_000,
      quantityTotal: 50,
    });
    expect(response.statusCode).toBe(201);
    expect(categorySchema.parse(response.json()).fee).toMatchObject({
      feeAmount: 900,
      payoutAmount: 19_100,
    });
  });

  it('refuse un prix trop bas (R3, PRICE_TOO_LOW)', async () => {
    const { id } = await createEvent(alice);
    expect(
      errorOf(
        await createCategory(alice, id, { name: 'Jour J', priceAmount: 100, quantityTotal: 10 }),
      ).code,
    ).toBe('PRICE_TOO_LOW');
  });

  it('accepte une fin de vente après le début de l’événement, refuse une fin avant le début de la vente', async () => {
    const start = inOneMonth();
    const { id } = await createEvent(alice, { startsAt: start.toISOString() });
    const later = new Date(start.getTime() + 4 * 3600 * 1000).toISOString();
    const earlier = new Date(start.getTime() - 3600 * 1000).toISOString();
    const accepted = await createCategory(alice, id, {
      name: 'Jour J',
      priceAmount: 7_000,
      quantityTotal: 10,
      saleStartsAt: earlier,
      saleEndsAt: later,
    });
    expect(accepted.statusCode).toBe(201);
    const refused = await createCategory(alice, id, {
      name: 'Erreur',
      priceAmount: 7_000,
      quantityTotal: 10,
      saleStartsAt: later,
      saleEndsAt: earlier,
    });
    expect(errorOf(refused).details).toMatchObject({ reason: 'sale_period_invalid' });
    // Début seul, après le début de l'événement : la fin par défaut (début de l'événement) serait avant.
    const startOnly = await createCategory(alice, id, {
      name: 'Erreur 2',
      priceAmount: 7_000,
      quantityTotal: 10,
      saleStartsAt: later,
    });
    expect(errorOf(startOnly).details).toMatchObject({ reason: 'sale_end_required' });
  });

  it('ne dépasse jamais la capacité, même avec des créations simultanées (R11)', async () => {
    const { id } = await createEvent(alice, { capacity: 100 });
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createCategory(alice, id, { name: `C${i}`, priceAmount: 5_000, quantityTotal: 30 }),
      ),
    );
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(3);
    const { rows } = await pool.query(
      'select sum(quantity_total)::int as total from ticket_categories where event_id = $1',
      [id],
    );
    expect(rows[0].total).toBe(90);
  });

  it('refuse de baisser la capacité de l’événement sous les billets prévus', async () => {
    const { id } = await createEvent(alice, { capacity: 100 });
    await createCategory(alice, id, { name: 'Standard', priceAmount: 5_000, quantityTotal: 80 });
    const response = await call(alice, {
      method: 'PATCH',
      url: `/api/v1/organizer/events/${id}`,
      payload: { capacity: 50 },
    });
    expect(errorOf(response).details).toMatchObject({ reason: 'below_categories', allocated: 80 });
  });

  it('refuse une quantité inférieure aux billets vendus ou réservés (R11)', async () => {
    const { id } = await createEvent(alice);
    const category = categorySchema.parse(
      (
        await createCategory(alice, id, {
          name: 'Standard',
          priceAmount: 5_000,
          quantityTotal: 100,
        })
      ).json(),
    );
    await pool.query(
      'update ticket_categories set quantity_sold = 30, quantity_reserved = 10 where id = $1',
      [category.id],
    );
    const tooLow = await call(alice, {
      method: 'PATCH',
      url: `/api/v1/organizer/categories/${category.id}`,
      payload: { quantityTotal: 39 },
    });
    expect(errorOf(tooLow).details).toMatchObject({ reason: 'below_sold' });
    const ok = await call(alice, {
      method: 'PATCH',
      url: `/api/v1/organizer/categories/${category.id}`,
      payload: { quantityTotal: 40 },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('archive au lieu de supprimer ; un autre organisateur ne peut rien faire (S5)', async () => {
    const { id } = await createEvent(alice);
    const category = categorySchema.parse(
      (
        await createCategory(alice, id, {
          name: 'Standard',
          priceAmount: 5_000,
          quantityTotal: 100,
        })
      ).json(),
    );
    const url = `/api/v1/organizer/categories/${category.id}`;
    expect(errorOf(await call(bob, { method: 'DELETE', url })).code).toBe('NOT_FOUND');
    expect(
      errorOf(await call(bob, { method: 'PATCH', url, payload: { priceAmount: 1_000 } })).code,
    ).toBe('NOT_FOUND');
    const archived = categorySchema.parse((await call(alice, { method: 'DELETE', url })).json());
    expect(archived.archivedAt).not.toBeNull();
    const { rows } = await pool.query('select count(*)::int as n from ticket_categories');
    expect(rows[0].n).toBe(1);
  });

  it('modifier un prix ne touche que l’avenir : aucune commande n’existe encore (vérifié en tranche 5)', async () => {
    const { id } = await createEvent(alice);
    const category = categorySchema.parse(
      (
        await createCategory(alice, id, {
          name: 'Standard',
          priceAmount: 5_000,
          quantityTotal: 100,
        })
      ).json(),
    );
    const updated = await call(alice, {
      method: 'PATCH',
      url: `/api/v1/organizer/categories/${category.id}`,
      payload: { priceAmount: 6_000 },
    });
    expect(categorySchema.parse(updated.json()).fee.payoutAmount).toBe(6_000 - 340);
  });

  it('refuse de déplacer l’événement si une période de vente devenait impossible (R12)', async () => {
    const start = inOneMonth();
    const { id } = await createEvent(alice, { startsAt: start.toISOString() });
    const saleStart = new Date(start.getTime() - 5 * 24 * 3600 * 1000);
    await createCategory(alice, id, {
      name: 'Prévente',
      priceAmount: 3_000,
      quantityTotal: 10,
      saleStartsAt: saleStart.toISOString(),
    });
    const earlier = new Date(saleStart.getTime() - 24 * 3600 * 1000).toISOString();
    const response = await call(alice, {
      method: 'PATCH',
      url: `/api/v1/organizer/events/${id}`,
      payload: { startsAt: earlier },
    });
    expect(errorOf(response).details).toMatchObject({
      reason: 'sale_period_conflict',
      categories: ['Prévente'],
    });
  });

  it('distingue un début seul après l’événement (choisir une fin)', async () => {
    const start = inOneMonth();
    const { id } = await createEvent(alice, { startsAt: start.toISOString() });
    const response = await createCategory(alice, id, {
      name: 'Jour J',
      priceAmount: 7_000,
      quantityTotal: 10,
      saleStartsAt: new Date(start.getTime() + 3600 * 1000).toISOString(),
    });
    expect(errorOf(response).details).toMatchObject({ reason: 'sale_end_required' });
  });
});

describe('appartenance sur toutes les routes de l’événement (S5)', () => {
  it('un autre organisateur ne peut ni ajouter de catégorie, ni d’image, ni calculer avec cet événement', async () => {
    const { id } = await createEvent(alice);
    expect(
      errorOf(await createCategory(bob, id, { name: 'X', priceAmount: 5_000, quantityTotal: 1 }))
        .code,
    ).toBe('NOT_FOUND');
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    const image = await call(bob, {
      method: 'POST',
      url: `/api/v1/organizer/events/${id}/image`,
      payload: png,
      headers: { 'content-type': 'image/png' },
    });
    expect(errorOf(image).code).toBe('NOT_FOUND');
    const preview = await call(bob, {
      method: 'POST',
      url: '/api/v1/organizer/fee-preview',
      payload: { price: 5_000, eventId: id },
    });
    expect(errorOf(preview).code).toBe('NOT_FOUND');
  });

  it('refuse un anonyme', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/organizer/events' });
    expect(errorOf(response).code).toBe('UNAUTHENTICATED');
  });
});

describe('format des images (§3.8)', () => {
  it('refuse un SVG, même annoncé comme PNG', async () => {
    const { id } = await createEvent(alice);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    const announcedPng = await call(alice, {
      method: 'POST',
      url: `/api/v1/organizer/events/${id}/image`,
      payload: svg,
      headers: { 'content-type': 'image/png' },
    });
    expect(errorOf(announcedPng).details).toMatchObject({ reason: 'invalid_image' });
    const declaredSvg = await call(alice, {
      method: 'POST',
      url: `/api/v1/organizer/events/${id}/image`,
      payload: svg,
      headers: { 'content-type': 'image/svg+xml' },
    });
    expect(declaredSvg.statusCode).toBe(415);
  });
});

describe('résolution de la règle de frais (R4)', () => {
  it('la règle de la catégorie l’emporte ; à égalité de portée, la plus récente', async () => {
    const { id } = await createEvent(alice);
    const category = categorySchema.parse(
      (
        await createCategory(alice, id, {
          name: 'Standard',
          priceAmount: 10_000,
          quantityTotal: 10,
        })
      ).json(),
    );
    const insertRule = (scope: string, scopeId: string, bps: number, validFrom: string) =>
      pool.query(
        `insert into fee_rules (scope, scope_id, calc_type, params, currency, valid_from)
         values ($1, $2, 'percent_fixed', $3, 'XAF', now() - $4::interval)`,
        [scope, scopeId, JSON.stringify({ percent_bps: bps, fixed_amount: 0 }), validFrom],
      );
    const fee = async () =>
      categorySchema.parse(
        (await call(alice, { method: 'GET', url: `/api/v1/organizer/events/${id}` })).json()
          .categories[0],
      ).fee.percentBps;
    await insertRule('event', id, 200, '2 hours');
    await insertRule('category', category.id, 100, '2 hours');
    expect(await fee()).toBe(100);
    await insertRule('category', category.id, 150, '1 hour');
    expect(await fee()).toBe(150);
  });
});

describe('profil et moyen de versement (maquette O2)', () => {
  it('enregistre le profil et un numéro de versement, renvoyé masqué', async () => {
    const profile = await call(alice, {
      method: 'PUT',
      url: '/api/v1/organizer/profile',
      payload: {
        displayName: 'Sahel Culture',
        description: 'Concerts',
        contactPhone: '66 12 34 56',
      },
    });
    expect(profile.json()).toMatchObject({ contactPhone: '+23566123456', payoutAccount: null });
    const payout = await call(alice, {
      method: 'PUT',
      url: '/api/v1/organizer/payout-account',
      payload: { method: 'airtel_money', number: '66 99 88 77' },
    });
    expect(payout.json()).toMatchObject({
      payoutAccount: { method: 'airtel_money', maskedNumber: '+235 66 •• •• 77' },
    });
    expect(JSON.stringify(payout.json())).not.toContain('66998877');
    const bobProfile = await call(bob, { method: 'GET', url: '/api/v1/organizer/profile' });
    expect(bobProfile.json()).toMatchObject({
      displayName: 'bob@exemple.com',
      payoutAccount: null,
    });
  });

  it('refuse un numéro trop court (maquette O2 : 8 chiffres)', async () => {
    const response = await call(alice, {
      method: 'PUT',
      url: '/api/v1/organizer/payout-account',
      payload: { method: 'moov_money', number: '66 12 34' },
    });
    expect(errorOf(response).code).toBe('VALIDATION_ERROR');
  });
});
