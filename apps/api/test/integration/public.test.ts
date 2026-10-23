import { errorResponseSchema, publicEventListSchema, publicEventSchema } from '@gatio/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testDependencies, testOrigin } from '../../src/test-support.js';
import { testDatabaseUrl } from './database.js';

const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 4 });
let app: FastifyInstance;
let alice: string;

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

async function account(email: string, withPayout = true): Promise<string> {
  const response = await call({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'motdepasse1', displayName: 'Sahel Culture' },
  });
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  if (withPayout) {
    await call({
      method: 'PUT',
      url: '/api/v1/organizer/payout-account',
      cookie,
      payload: { method: 'airtel_money', number: '66 99 88 77' },
    });
  }
  return cookie;
}

async function draft(overrides: Record<string, unknown> = {}) {
  const response = await call({
    method: 'POST',
    url: '/api/v1/organizer/events',
    cookie: alice,
    payload: {
      title: 'Soirée Sahel Live',
      description: 'Une soirée de musique.',
      eventType: 'concert',
      city: "N'Djamena",
      venue: 'Salle des fêtes',
      startsAt: days(30).toISOString(),
      capacity: 500,
      ...overrides,
    },
  });
  const event = response.json() as { id: string; slug: string };
  await call({
    method: 'POST',
    url: `/api/v1/organizer/events/${event.id}/categories`,
    cookie: alice,
    payload: { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
  });
  return event;
}

const action = (id: string, name: string, cookie = alice) =>
  call({ method: 'POST', url: `/api/v1/organizer/events/${id}/${name}`, cookie });
const list = async (query = '') =>
  publicEventListSchema.parse((await app.inject({ url: `/api/v1/events${query}` })).json());
const page = (slug: string) => app.inject({ url: `/api/v1/events/${slug}` });

beforeEach(async () => {
  await pool.query(
    'truncate users, organizers, auth_sessions, password_resets, rate_limit_counters, events, ticket_categories, fee_rules, audit_log cascade',
  );
  await pool.query(`insert into fee_rules (scope, scope_id, calc_type, params, currency, valid_from)
    values ('platform', null, 'percent_fixed', '{"percent_bps": 400, "fixed_amount": 100}', 'XAF', now() - interval '1 minute')`);
  app = await buildApp(testDependencies(pool));
  alice = await account('alice@exemple.com');
});

afterAll(async () => {
  await pool.end();
});

describe('publication (O5)', () => {
  it('exige un moyen de versement (R21)', async () => {
    const bob = await account('bob@exemple.com', false);
    const response = await call({
      method: 'POST',
      url: '/api/v1/organizer/events',
      cookie: bob,
      payload: {
        title: 'Sans versement',
        description: 'x',
        eventType: 'sport',
        city: 'Moundou',
        venue: 'Stade',
        startsAt: days(10).toISOString(),
        capacity: 10,
      },
    });
    const { id } = response.json() as { id: string };
    expect(errorOf(await action(id, 'publish', bob)).details).toMatchObject({
      reason: 'payout_account_missing',
    });
  });

  it('un brouillon est introuvable ; publié, il apparaît dans la liste avec son prix « à partir de »', async () => {
    const { id, slug } = await draft();
    expect((await page(slug)).statusCode).toBe(404);
    expect((await list()).items).toHaveLength(0);
    expect((await action(id, 'publish')).statusCode).toBe(200);
    const { items } = await list();
    expect(items).toMatchObject([{ slug, minPriceAmount: 5_000, city: "N'Djamena" }]);
    const event = publicEventSchema.parse((await page(slug)).json());
    expect(event).toMatchObject({ status: 'published', organizerName: 'Sahel Culture' });
    expect(event.categories).toMatchObject([{ name: 'Standard', availability: 'available' }]);
    expect((await action(id, 'unpublish')).statusCode).toBe(200);
    expect((await page(slug)).statusCode).toBe(404);
  });

  it('montre l’état de chaque catégorie (disponible, bientôt, terminée, épuisée) et ignore les archivées', async () => {
    const { id, slug } = await draft();
    const add = (payload: Record<string, unknown>) =>
      call({
        method: 'POST',
        url: `/api/v1/organizer/events/${id}/categories`,
        cookie: alice,
        payload,
      });
    await add({
      name: 'Jour J',
      priceAmount: 7_000,
      quantityTotal: 10,
      saleStartsAt: days(29).toISOString(),
      saleEndsAt: days(31).toISOString(),
    });
    await add({
      name: 'Prévente',
      priceAmount: 3_000,
      quantityTotal: 10,
      saleStartsAt: days(-5).toISOString(),
      saleEndsAt: days(-1).toISOString(),
    });
    const vip = (await add({ name: 'VIP', priceAmount: 20_000, quantityTotal: 10 })).json() as {
      id: string;
    };
    const archived = (
      await add({ name: 'Archivée', priceAmount: 9_000, quantityTotal: 10 })
    ).json() as { id: string };
    await pool.query('update ticket_categories set quantity_sold = 10 where id = $1', [vip.id]);
    await call({
      method: 'DELETE',
      url: `/api/v1/organizer/categories/${archived.id}`,
      cookie: alice,
    });
    await action(id, 'publish');
    const event = publicEventSchema.parse((await page(slug)).json());
    expect(
      Object.fromEntries(
        event.categories.map((category) => [category.name, category.availability]),
      ),
    ).toEqual({
      Standard: 'available',
      'Jour J': 'upcoming',
      Prévente: 'ended',
      VIP: 'sold_out',
    });
    expect(event.minPriceAmount).toBe(5_000);
  });

  it('un événement suspendu disparaît, même par son lien (R33)', async () => {
    const { id, slug } = await draft();
    await action(id, 'publish');
    await pool.query(
      "update events set status = 'suspended', status_before_suspension = 'published' where id = $1",
      [id],
    );
    expect((await page(slug)).statusCode).toBe(404);
    expect((await list()).items).toHaveLength(0);
  });
});

describe('report et annulation (R34)', () => {
  it('reporté : bandeau, hors de la liste, page accessible ; republié avec une nouvelle date, il revend', async () => {
    const { id, slug } = await draft();
    await action(id, 'publish');
    expect((await action(id, 'postpone')).statusCode).toBe(200);
    expect((await list()).items).toHaveLength(0);
    expect(publicEventSchema.parse((await page(slug)).json()).status).toBe('postponed');
    const newDate = days(60).toISOString();
    await call({
      method: 'PATCH',
      url: `/api/v1/organizer/events/${id}`,
      cookie: alice,
      payload: { startsAt: newDate },
    });
    expect((await action(id, 'publish')).statusCode).toBe(200);
    const { items } = await list();
    expect(items).toMatchObject([{ slug, startsAt: newDate }]);
    expect(publicEventSchema.parse((await page(slug)).json()).categories[0]?.availability).toBe(
      'available',
    );
    const { rows } = await pool.query('select action from audit_log order by created_at');
    expect(rows.map((row) => row.action)).toEqual([
      'event.postpone',
      'event.reschedule',
      'event.republish',
    ]);
  });

  it('annulé : définitif, hors de la liste, page avec son statut, plus rien de modifiable', async () => {
    const { id, slug } = await draft();
    await action(id, 'publish');
    expect((await action(id, 'cancel')).statusCode).toBe(200);
    expect((await list()).items).toHaveLength(0);
    expect(publicEventSchema.parse((await page(slug)).json()).status).toBe('cancelled');
    expect(errorOf(await action(id, 'publish')).details).toMatchObject({
      reason: 'invalid_status',
    });
    const patch = await call({
      method: 'PATCH',
      url: `/api/v1/organizer/events/${id}`,
      cookie: alice,
      payload: { title: 'X' },
    });
    expect(errorOf(patch).details).toMatchObject({ reason: 'event_cancelled' });
    const { rows } = await pool.query(
      "select action, before->>'status' as before, after->>'status' as after from audit_log",
    );
    expect(rows).toEqual([{ action: 'event.cancel', before: 'published', after: 'cancelled' }]);
  });

  it('refuse les changements impossibles (reporter un brouillon)', async () => {
    const { id } = await draft();
    expect(errorOf(await action(id, 'postpone')).details).toMatchObject({
      reason: 'invalid_status',
      status: 'draft',
    });
  });

  it('un autre organisateur ne peut pas changer le statut (S5)', async () => {
    const { id } = await draft();
    const bob = await account('bob@exemple.com');
    expect(errorOf(await action(id, 'publish', bob)).code).toBe('NOT_FOUND');
  });
});

describe('règles ajoutées après la revue de la tranche 4', () => {
  it('un événement reporté ne montre aucune catégorie disponible ni prix « à partir de » (R12)', async () => {
    const { id, slug } = await draft();
    await action(id, 'publish');
    await action(id, 'postpone');
    const event = publicEventSchema.parse((await page(slug)).json());
    expect(event.categories.map((category) => category.availability)).toEqual(['ended']);
    expect(event.minPriceAmount).toBeNull();
  });

  it('les événements d’un organisateur suspendu disparaissent (R33)', async () => {
    const { id, slug } = await draft();
    await action(id, 'publish');
    await pool.query("update organizers set status = 'suspended'");
    expect((await page(slug)).statusCode).toBe(404);
    expect((await list()).items).toHaveLength(0);
  });

  it('la date d’un événement publié ne change que par un report (R34)', async () => {
    const { id } = await draft();
    await action(id, 'publish');
    const response = await call({
      method: 'PATCH',
      url: `/api/v1/organizer/events/${id}`,
      cookie: alice,
      payload: { startsAt: days(45).toISOString() },
    });
    expect(errorOf(response).details).toMatchObject({ reason: 'postpone_required' });
    const title = await call({
      method: 'PATCH',
      url: `/api/v1/organizer/events/${id}`,
      cookie: alice,
      payload: { title: 'Nouveau titre' },
    });
    expect(title.statusCode).toBe(200);
  });

  it('le journal d’audit garde l’acteur, l’adresse et les dates avant et après', async () => {
    const { id } = await draft();
    await action(id, 'publish');
    await action(id, 'postpone');
    const newDate = days(50).toISOString();
    await call({
      method: 'PATCH',
      url: `/api/v1/organizer/events/${id}`,
      cookie: alice,
      payload: { startsAt: newDate },
    });
    const { rows } = await pool.query(
      "select a.actor_user_id = u.id as by_alice, a.ip, a.after->>'startsAt' as after from audit_log a join users u on u.email = 'alice@exemple.com' where a.action = 'event.reschedule'",
    );
    expect(rows).toEqual([{ by_alice: true, ip: '127.0.0.1', after: newDate }]);
  });
});

describe('décisions du responsable (PC-4)', () => {
  it('refuse de publier sans catégorie active', async () => {
    const response = await call({
      method: 'POST',
      url: '/api/v1/organizer/events',
      cookie: alice,
      payload: {
        title: 'Sans billets',
        description: 'x',
        eventType: 'other',
        city: 'Sarh',
        venue: 'Salle',
        startsAt: days(10).toISOString(),
        capacity: 10,
      },
    });
    const { id } = response.json() as { id: string };
    expect(errorOf(await action(id, 'publish')).details).toMatchObject({
      reason: 'no_active_category',
    });
  });

  it('remet en vente une catégorie archivée, si la capacité le permet', async () => {
    const { id, slug } = await draft({ capacity: 150 });
    const archived = (
      await call({
        method: 'POST',
        url: `/api/v1/organizer/events/${id}/categories`,
        cookie: alice,
        payload: { name: 'VIP', priceAmount: 20_000, quantityTotal: 50 },
      })
    ).json() as { id: string };
    await call({
      method: 'DELETE',
      url: `/api/v1/organizer/categories/${archived.id}`,
      cookie: alice,
    });
    // La place libérée est reprise par une autre catégorie : plus de capacité pour la VIP.
    await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${id}/categories`,
      cookie: alice,
      payload: { name: 'Tribune', priceAmount: 4_000, quantityTotal: 30 },
    });
    const refused = await call({
      method: 'POST',
      url: `/api/v1/organizer/categories/${archived.id}/restore`,
      cookie: alice,
    });
    expect(errorOf(refused).details).toMatchObject({ reason: 'capacity_exceeded', remaining: 20 });
    await call({
      method: 'PATCH',
      url: `/api/v1/organizer/events/${id}`,
      cookie: alice,
      payload: { capacity: 180 },
    });
    const restored = await call({
      method: 'POST',
      url: `/api/v1/organizer/categories/${archived.id}/restore`,
      cookie: alice,
    });
    expect(restored.json()).toMatchObject({ name: 'VIP', archivedAt: null });
    await action(id, 'publish');
    const names = publicEventSchema
      .parse((await page(slug)).json())
      .categories.map((category) => category.name);
    expect(names).toContain('VIP');
  });
});

describe('liste et recherche (B1)', () => {
  it('filtre par ville, type, dates et texte ; trie par date ; exclut les événements passés', async () => {
    const a = await draft({
      title: 'Concert à Moundou',
      city: 'Moundou',
      startsAt: days(5).toISOString(),
    });
    const b = await draft({
      title: 'Match de football',
      eventType: 'sport',
      startsAt: days(2).toISOString(),
    });
    const c = await draft({ title: 'Grand concert', startsAt: days(40).toISOString() });
    for (const event of [a, b, c]) await action(event.id, 'publish');
    await pool.query("update events set starts_at = now() - interval '1 day' where id = $1", [
      c.id,
    ]);
    expect((await list()).items.map((item) => item.slug)).toEqual([b.slug, a.slug]);
    expect((await list('?city=Moundou')).items.map((item) => item.slug)).toEqual([a.slug]);
    expect((await list('?type=sport')).items.map((item) => item.slug)).toEqual([b.slug]);
    expect((await list(`?from=${days(3).toISOString()}`)).items.map((item) => item.slug)).toEqual([
      a.slug,
    ]);
    expect((await list('?q=concert')).items.map((item) => item.slug)).toEqual([a.slug]);
  });

  it('pagine avec un curseur', async () => {
    for (let i = 1; i <= 3; i++) {
      const event = await draft({ title: `Événement ${i}`, startsAt: days(i).toISOString() });
      await action(event.id, 'publish');
    }
    const first = await list('?limit=2');
    expect(first.items).toHaveLength(2);
    const second = await list(`?limit=2&cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });
});
