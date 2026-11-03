import {
  errorResponseSchema,
  scannerInviteCreatedSchema,
  scannerInviteListSchema,
  scannerListSchema,
  scanSessionSchema,
} from '@gatio/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { limits } from '../../src/lib/limits.js';
import { testDependencies, testOrigin } from '../../src/test-support.js';
import { testDatabaseUrl } from './database.js';

const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 10 });
let app: FastifyInstance;
let deps: ReturnType<typeof testDependencies>;
let organizer: string;
let ip = 0;

function call(options: InjectOptions & { cookie?: string }) {
  const { cookie, headers, ...rest } = options;
  ip += 1;
  return app.inject({
    ...rest,
    headers: {
      origin: testOrigin,
      // Adresses différentes : la limite par adresse n'intervient que dans son propre test.
      'x-forwarded-for': `10.9.${Math.floor(ip / 250) % 250}.${ip % 250}`,
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
  });
}

const errorOf = (response: { json(): unknown }) => errorResponseSchema.parse(response.json()).error;
const cookieOf = (response: { headers: Record<string, unknown> }, name: string) =>
  [response.headers['set-cookie'] ?? []]
    .flat()
    .map(String)
    .find((value) => value.startsWith(`${name}=`));

async function register(email: string, displayName: string) {
  const response = await call({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'motdepasse1', displayName },
  });
  return String(response.headers['set-cookie']).split(';')[0]!;
}

async function publishedEvent(cookie = organizer) {
  const created = await call({
    method: 'POST',
    url: '/api/v1/organizer/events',
    cookie,
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
  const event = created.json() as { id: string; startsAt: string };
  await call({
    method: 'POST',
    url: `/api/v1/organizer/events/${event.id}/categories`,
    cookie,
    payload: { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
  });
  await call({ method: 'POST', url: `/api/v1/organizer/events/${event.id}/publish`, cookie });
  return event;
}

async function createInvite(eventId: string, cookie = organizer) {
  const response = await call({
    method: 'POST',
    url: `/api/v1/organizer/events/${eventId}/scanner-invites`,
    cookie,
  });
  expect(response.statusCode).toBe(201);
  return scannerInviteCreatedSchema.parse(response.json());
}

const join = (inviteToken: string, firstName = 'Abakar') =>
  call({ method: 'POST', url: '/api/v1/scan/join', payload: { inviteToken, firstName } });

async function joined(inviteToken: string, firstName = 'Abakar') {
  const response = await join(inviteToken, firstName);
  expect(response.statusCode).toBe(200);
  return cookieOf(response, 'gatio_scan')!.split(';')[0]!;
}

const session = (cookie: string) => call({ url: '/api/v1/scan/session', cookie });
const scanners = async (eventId: string) =>
  scannerListSchema.parse(
    (await call({ url: `/api/v1/organizer/events/${eventId}/scanners`, cookie: organizer })).json(),
  ).items;

beforeEach(async () => {
  await pool.query(
    'truncate users, organizers, auth_sessions, rate_limit_counters, events, ticket_categories, fee_rules, audit_log, scanner_invites, scanner_sessions cascade',
  );
  await pool.query(`insert into fee_rules (scope, scope_id, calc_type, params, currency, valid_from)
    values ('platform', null, 'percent_fixed', '{"percent_bps": 400, "fixed_amount": 100}', 'XAF', now() - interval '1 minute')`);
  deps = testDependencies(pool);
  app = await buildApp(deps);
  organizer = await register('orga@exemple.com', 'Sahel Culture');
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

describe('contrôleurs invités (R29, C1, O7)', () => {
  it('lien créé, lu par C1, rejoint : session de scan jusqu’à 24 h après le début', async () => {
    const event = await publishedEvent();
    const { invite, token } = await createInvite(event.id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const end = new Date(event.startsAt).getTime() + 24 * 3600 * 1000;
    expect(new Date(invite.expiresAt).getTime()).toBe(end);
    expect(invite.active).toBe(true);

    const info = await call({
      method: 'POST',
      url: '/api/v1/scan/invite',
      payload: { inviteToken: token },
    });
    expect(info.json()).toEqual({
      event: {
        title: 'Soirée Sahel Live',
        startsAt: event.startsAt,
        venue: 'Salle des fêtes',
        city: "N'Djamena",
      },
    });

    const response = await join(token, '  Abakar ');
    expect(response.statusCode).toBe(200);
    expect(scanSessionSchema.parse(response.json()).firstName).toBe('Abakar');
    const cookie = cookieOf(response, 'gatio_scan')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)![1]);
    expect(Math.abs(maxAge - (end - Date.now()) / 1000)).toBeLessThan(60);

    const current = await session(cookie.split(';')[0]!);
    expect(current.statusCode).toBe(200);
    expect(scanSessionSchema.parse(current.json()).event.title).toBe('Soirée Sahel Live');

    const list = await scanners(event.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ firstName: 'Abakar', organizer: false });
    const invites = scannerInviteListSchema.parse(
      (
        await call({
          url: `/api/v1/organizer/events/${event.id}/scanner-invites`,
          cookie: organizer,
        })
      ).json(),
    ).items;
    expect(invites.map((item) => item.active)).toEqual([true]);
  });

  it('lien désactivé : entrée refusée et sessions ouvertes par lui coupées (critère)', async () => {
    const event = await publishedEvent();
    const first = await createInvite(event.id);
    const second = await createInvite(event.id);
    const abakar = await joined(first.token, 'Abakar');
    const fatime = await joined(first.token, 'Fatimé');
    const other = await joined(second.token, 'Moussa');

    const revoke = await call({
      method: 'DELETE',
      url: `/api/v1/organizer/scanner-invites/${first.invite.id}`,
      cookie: organizer,
    });
    expect(revoke.statusCode).toBe(204);

    expect(errorOf(await join(first.token)).code).toBe('INVITE_INVALID');
    const info = await call({
      method: 'POST',
      url: '/api/v1/scan/invite',
      payload: { inviteToken: first.token },
    });
    expect(errorOf(info).code).toBe('INVITE_INVALID');
    expect((await session(abakar)).statusCode).toBe(401);
    expect((await session(fatime)).statusCode).toBe(401);
    // L'autre lien et sa session ne sont pas touchés.
    expect((await session(other)).statusCode).toBe(200);
    expect((await scanners(event.id)).map((item) => item.firstName)).toEqual(['Moussa']);
    // Désactiver deux fois ne change rien.
    const again = await call({
      method: 'DELETE',
      url: `/api/v1/organizer/scanner-invites/${first.invite.id}`,
      cookie: organizer,
    });
    expect(again.statusCode).toBe(204);
  });

  it('lien expiré : entrée refusée et sessions coupées (critère)', async () => {
    const event = await publishedEvent();
    const { invite, token } = await createInvite(event.id);
    const cookie = await joined(token);
    await pool.query(
      "update scanner_invites set expires_at = now() - interval '1 second' where id = $1",
      [invite.id],
    );
    expect(errorOf(await join(token)).code).toBe('INVITE_INVALID');
    expect((await session(cookie)).statusCode).toBe(401);
    expect(await scanners(event.id)).toEqual([]);
  });

  it('retrait d’un contrôleur : seule sa session est coupée', async () => {
    const event = await publishedEvent();
    const { token } = await createInvite(event.id);
    const abakar = await joined(token, 'Abakar');
    const fatime = await joined(token, 'Fatimé');
    const target = (await scanners(event.id)).find((item) => item.firstName === 'Abakar')!;
    const removed = await call({
      method: 'DELETE',
      url: `/api/v1/organizer/scanner-sessions/${target.id}`,
      cookie: organizer,
    });
    expect(removed.statusCode).toBe(204);
    expect((await session(abakar)).statusCode).toBe(401);
    expect((await session(fatime)).statusCode).toBe(200);
    // Le lien reste valable : un contrôleur retiré peut revenir avec lui (l'écran O7 dit de
    // désactiver le lien pour l'en empêcher).
    expect((await join(token)).statusCode).toBe(200);
  });

  it('scanner moi-même : session de l’organisateur sans invitation, jusqu’à 24 h après le début', async () => {
    const event = await publishedEvent();
    const response = await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${event.id}/scanner-session`,
      cookie: organizer,
    });
    expect(response.statusCode).toBe(201);
    const cookie = cookieOf(response, 'gatio_scan')!.split(';')[0]!;
    expect(scanSessionSchema.parse((await session(cookie)).json()).firstName).toBe('Sahel Culture');
    expect(await scanners(event.id)).toMatchObject([
      { firstName: 'Sahel Culture', organizer: true },
    ]);
    await pool.query("update events set starts_at = now() - interval '25 hours' where id = $1", [
      event.id,
    ]);
    expect((await session(cookie)).statusCode).toBe(401);
  });

  it('isolation : un autre organisateur ne voit, ne crée ni ne retire rien (S5)', async () => {
    const event = await publishedEvent();
    const { invite, token } = await createInvite(event.id);
    await joined(token);
    const target = (await scanners(event.id))[0]!;
    const intruder = await register('autre@exemple.com', 'Autre');
    const attempts = [
      call({
        method: 'POST',
        url: `/api/v1/organizer/events/${event.id}/scanner-invites`,
        cookie: intruder,
      }),
      call({ url: `/api/v1/organizer/events/${event.id}/scanner-invites`, cookie: intruder }),
      call({ url: `/api/v1/organizer/events/${event.id}/scanners`, cookie: intruder }),
      call({
        method: 'DELETE',
        url: `/api/v1/organizer/scanner-invites/${invite.id}`,
        cookie: intruder,
      }),
      call({
        method: 'DELETE',
        url: `/api/v1/organizer/scanner-sessions/${target.id}`,
        cookie: intruder,
      }),
      call({
        method: 'POST',
        url: `/api/v1/organizer/events/${event.id}/scanner-session`,
        cookie: intruder,
      }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.statusCode).toBe(404);
    }
    // Sans connexion : refusé.
    const anonymous = await call({ url: `/api/v1/organizer/events/${event.id}/scanners` });
    expect(anonymous.statusCode).toBe(401);
    expect(await scanners(event.id)).toHaveLength(1);
  });

  it('événement annulé : plus de nouveau lien ni de nouvelle session', async () => {
    const event = await publishedEvent();
    const { token } = await createInvite(event.id);
    await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${event.id}/cancel`,
      cookie: organizer,
    });
    const create = await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${event.id}/scanner-invites`,
      cookie: organizer,
    });
    expect(errorOf(create)).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'event_closed' },
    });
    expect(errorOf(await join(token)).code).toBe('INVITE_INVALID');
  });

  it('événement reporté puis nouvelle date : les liens actifs suivent la date', async () => {
    const event = await publishedEvent();
    const { invite } = await createInvite(event.id);
    await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${event.id}/postpone`,
      cookie: organizer,
    });
    const later = new Date(Date.now() + 40 * 24 * 3600 * 1000);
    later.setMilliseconds(0);
    const patched = await call({
      method: 'PATCH',
      url: `/api/v1/organizer/events/${event.id}`,
      cookie: organizer,
      payload: { startsAt: later.toISOString() },
    });
    expect(patched.statusCode).toBe(200);
    const { rows } = await pool.query('select expires_at from scanner_invites where id = $1', [
      invite.id,
    ]);
    expect((rows[0].expires_at as Date).getTime()).toBe(later.getTime() + 24 * 3600 * 1000);
  });

  it('jetons stockés hachés ; jeton inconnu, prénom vide ou session absente refusés', async () => {
    const event = await publishedEvent();
    const { token } = await createInvite(event.id);
    const cookie = await joined(token);
    const invites = await pool.query('select token_hash from scanner_invites');
    const sessions = await pool.query('select token_hash from scanner_sessions');
    for (const row of [...invites.rows, ...sessions.rows] as Array<{ token_hash: string }>) {
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(invites.rows[0].token_hash).not.toBe(token);
    expect(errorOf(await join('x'.repeat(43))).code).toBe('INVITE_INVALID');
    expect(errorOf(await join(token, '   ')).code).toBe('VALIDATION_ERROR');
    expect((await call({ url: '/api/v1/scan/session' })).statusCode).toBe(401);
    const bearer = await call({
      url: '/api/v1/scan/session',
      headers: { authorization: `Bearer ${cookie.split('=')[1]}` },
    });
    expect(bearer.statusCode).toBe(200);
  });

  it('limite par adresse sur la lecture et l’utilisation des liens', async () => {
    const { limit } = limits.scanJoinPerIp;
    const statuses: number[] = [];
    for (let index = 0; index <= limit; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/scan/invite',
        headers: { origin: testOrigin, 'x-forwarded-for': '10.8.0.1' },
        payload: { inviteToken: `inconnu-${index}` },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, limit).every((status) => status === 400)).toBe(true);
    expect(statuses[limit]).toBe(429);
  });

  it('événement annulé : sessions coupées ; événement suspendu : le scan continue (R33)', async () => {
    const cancelled = await publishedEvent();
    const first = await createInvite(cancelled.id);
    const abakar = await joined(first.token);
    await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${cancelled.id}/cancel`,
      cookie: organizer,
    });
    const ended = await session(abakar);
    expect(ended.statusCode).toBe(401);
    expect(errorOf(ended).details).toEqual({ reason: 'session_ended' });
    const self = await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${cancelled.id}/scanner-session`,
      cookie: organizer,
    });
    expect(errorOf(self).details).toEqual({ reason: 'event_closed' });

    const suspended = await publishedEvent();
    const second = await createInvite(suspended.id);
    const fatime = await joined(second.token, 'Fatimé');
    await pool.query("update events set status = 'suspended' where id = $1", [suspended.id]);
    expect((await session(fatime)).statusCode).toBe(200);
    expect((await join(second.token, 'Moussa')).statusCode).toBe(200);
  });

  it('scanner moi-même refusé après la fin de l’événement ; session de l’organisateur retirable', async () => {
    const event = await publishedEvent();
    const opened = await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${event.id}/scanner-session`,
      cookie: organizer,
    });
    const cookie = cookieOf(opened, 'gatio_scan')!.split(';')[0]!;
    const own = (await scanners(event.id))[0]!;
    const removed = await call({
      method: 'DELETE',
      url: `/api/v1/organizer/scanner-sessions/${own.id}`,
      cookie: organizer,
    });
    expect(removed.statusCode).toBe(204);
    expect((await session(cookie)).statusCode).toBe(401);
    await pool.query("update events set starts_at = now() - interval '25 hours' where id = $1", [
      event.id,
    ]);
    const late = await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${event.id}/scanner-session`,
      cookie: organizer,
    });
    expect(errorOf(late).details).toEqual({ reason: 'event_over' });
  });

  it('lien désactivé en base pendant qu’une session s’ouvre : la session est coupée quand même', async () => {
    const event = await publishedEvent();
    const { invite, token } = await createInvite(event.id);
    const cookie = await joined(token);
    // Seul le lien est marqué (course entre /scan/join et la désactivation) : la session suit.
    await pool.query('update scanner_invites set revoked_at = now() where id = $1', [invite.id]);
    expect((await session(cookie)).statusCode).toBe(401);
  });

  it('nouvelle date : un lien désactivé ou déjà expiré ne revit pas', async () => {
    const event = await publishedEvent();
    const revoked = await createInvite(event.id);
    const expired = await createInvite(event.id);
    await call({
      method: 'DELETE',
      url: `/api/v1/organizer/scanner-invites/${revoked.invite.id}`,
      cookie: organizer,
    });
    await pool.query(
      "update scanner_invites set expires_at = now() - interval '1 hour' where id = $1",
      [expired.invite.id],
    );
    const before = await pool.query('select id, expires_at from scanner_invites order by id');
    await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${event.id}/postpone`,
      cookie: organizer,
    });
    await call({
      method: 'PATCH',
      url: `/api/v1/organizer/events/${event.id}`,
      cookie: organizer,
      payload: { startsAt: new Date(Date.now() + 40 * 24 * 3600 * 1000).toISOString() },
    });
    const after = await pool.query('select id, expires_at from scanner_invites order by id');
    expect(after.rows).toEqual(before.rows);
  });

  it('déconnexion et nouveau mot de passe ferment les sessions de scan', async () => {
    const event = await publishedEvent();
    const { token } = await createInvite(event.id);
    const controller = await joined(token);
    const logout = await call({ method: 'POST', url: '/api/v1/auth/logout', cookie: controller });
    expect(cookieOf(logout, 'gatio_scan')).toMatch(/Max-Age=0/);
    expect((await session(controller)).statusCode).toBe(401);

    // « Scanner moi-même » sur un téléphone perdu : le nouveau mot de passe la coupe.
    const opened = await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${event.id}/scanner-session`,
      cookie: organizer,
    });
    const own = cookieOf(opened, 'gatio_scan')!.split(';')[0]!;
    const other = await joined(token, 'Fatimé');
    await call({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      payload: { email: 'orga@exemple.com' },
    });
    await deps.settle();
    const resetToken = /#token=([A-Za-z0-9_-]+)/.exec(deps.emailOutbox.sent.at(-1)!.text)![1];
    const reset = await call({
      method: 'POST',
      url: '/api/v1/auth/password/reset',
      payload: { token: resetToken, newPassword: 'nouveaumotdepasse' },
    });
    expect(reset.statusCode).toBe(200);
    expect((await session(own)).statusCode).toBe(401);
    // Les contrôleurs invités ne dépendent pas du mot de passe de l'organisateur.
    expect((await session(other)).statusCode).toBe(200);
  });

  it('origine étrangère avec un cookie : refusée (S2)', async () => {
    const event = await publishedEvent();
    const { token } = await createInvite(event.id);
    const cookie = await joined(token);
    const response = await call({
      method: 'POST',
      url: '/api/v1/scan/join',
      cookie,
      headers: { origin: 'https://exemple-malveillant.test' },
      payload: { inviteToken: token, firstName: 'Abakar' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('session lue : le cookie est renouvelé jusqu’à la fin de la session', async () => {
    const event = await publishedEvent();
    const { token } = await createInvite(event.id);
    const cookie = await joined(token);
    const response = await session(cookie);
    expect(cookieOf(response, 'gatio_scan')).toMatch(/HttpOnly/);
  });
});
