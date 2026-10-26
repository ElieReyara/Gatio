import { errorResponseSchema, organizerProfileSchema } from '@gatio/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testDependencies, testOrigin } from '../../src/test-support.js';
import { testDatabaseUrl } from './database.js';

const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 4 });
let deps: ReturnType<typeof testDependencies>;
let app: FastifyInstance;

beforeEach(async () => {
  await pool.query(
    'truncate users, organizers, auth_sessions, password_resets, rate_limit_counters, events, ticket_categories, buyers, orders, order_items, funnel_events, payments, payment_webhook_events, reconciliation_runs, discrepancies, payouts, tickets, email_verifications, outbound_messages cascade',
  );
  deps = testDependencies(pool);
  app = await buildApp(deps);
});

afterAll(async () => {
  await pool.end();
});

const account = { email: 'nom@exemple.com', password: 'motdepasse1', displayName: 'Sahel Culture' };

function call(options: InjectOptions & { cookie?: string }) {
  const { cookie, headers, ...rest } = options;
  return app.inject({
    ...rest,
    headers: { origin: testOrigin, ...(cookie ? { cookie } : {}), ...headers },
  });
}

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const header = String(response.headers['set-cookie']);
  return header.split(';')[0]!;
}

async function register(body = account) {
  return call({ method: 'POST', url: '/api/v1/auth/register', payload: body });
}

async function login(email: string, password: string, headers: Record<string, string> = {}) {
  return call({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password }, headers });
}

function profile(cookie: string) {
  return call({ method: 'GET', url: '/api/v1/organizer/profile', cookie });
}

function errorCode(response: { json(): unknown }) {
  return errorResponseSchema.parse(response.json()).error.code;
}

function resetToken(): string {
  const text = deps.emailOutbox.sent.at(-1)?.text ?? '';
  return /#token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';
}

describe('inscription et connexion', () => {
  it('inscrit un organisateur, ouvre sa session et renvoie son profil', async () => {
    const response = await register();
    expect(response.statusCode).toBe(201);
    expect(organizerProfileSchema.parse(response.json())).toMatchObject({
      email: 'nom@exemple.com',
      displayName: 'Sahel Culture',
    });
    const header = String(response.headers['set-cookie']);
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Lax/);
    expect((await profile(sessionCookie(response))).statusCode).toBe(200);
  });

  it('ne stocke ni le mot de passe ni le jeton de session en clair', async () => {
    const cookie = sessionCookie(await register());
    const { rows: userRows } = await pool.query('select password_hash from users');
    expect(userRows[0].password_hash).toMatch(/^\$argon2id\$/);
    const { rows: sessionRows } = await pool.query('select token_hash from auth_sessions');
    expect(sessionRows[0].token_hash).not.toBe(cookie.split('=')[1]);
  });

  it('refuse un second compte avec le même email, sans tenir compte des majuscules', async () => {
    await register();
    const response = await register({ ...account, email: 'NOM@exemple.com' });
    expect(response.statusCode).toBe(400);
    expect(errorResponseSchema.parse(response.json()).error.details).toMatchObject({
      reason: 'already_registered',
    });
  });

  it('répond pareil à un mauvais mot de passe et à un email inconnu', async () => {
    await register();
    const wrong = await login(account.email, 'mauvais');
    const unknown = await login('inconnu@exemple.com', 'mauvais');
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('connecte, puis la déconnexion ferme la session', async () => {
    await register();
    const cookie = sessionCookie(await login(account.email, account.password));
    expect((await profile(cookie)).statusCode).toBe(200);
    expect((await call({ method: 'POST', url: '/api/v1/auth/logout', cookie })).statusCode).toBe(
      204,
    );
    expect(errorCode(await profile(cookie))).toBe('UNAUTHENTICATED');
  });

  it('accepte le jeton de session dans l’en-tête Authorization (futur mobile)', async () => {
    const token = sessionCookie(await register()).split('=')[1];
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/organizer/profile',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('bloque la connexion après 10 essais pour un même email', async () => {
    await register();
    for (let i = 0; i < 10; i++)
      expect((await login(account.email, 'mauvais')).statusCode).toBe(401);
    expect(errorCode(await login(account.email, account.password))).toBe('RATE_LIMITED');
  });

  it('compte les essais par adresse du client, transmise par le relais du site', async () => {
    for (let i = 0; i < 30; i++) {
      await login(`inconnu${i}@exemple.com`, 'x', { 'x-forwarded-for': '203.0.113.7' });
    }
    const blocked = await login('autre@exemple.com', 'x', { 'x-forwarded-for': '203.0.113.7' });
    const other = await login('autre@exemple.com', 'x', { 'x-forwarded-for': '203.0.113.8' });
    expect(errorCode(blocked)).toBe('RATE_LIMITED');
    expect(other.statusCode).toBe(401);
  });
});

describe('isolation entre organisateurs', () => {
  it('chaque session ne voit que son propre profil', async () => {
    const cookieA = sessionCookie(await register());
    const cookieB = sessionCookie(
      await register({
        email: 'autre@exemple.com',
        password: 'motdepasse2',
        displayName: 'Ndjam Events',
      }),
    );
    expect((await profile(cookieA)).json()).toMatchObject({ email: 'nom@exemple.com' });
    expect((await profile(cookieB)).json()).toMatchObject({ email: 'autre@exemple.com' });
  });

  it('refuse le profil sans session', async () => {
    expect(errorCode(await profile('gatio_session=faux'))).toBe('UNAUTHENTICATED');
  });
});

describe('mot de passe oublié (R36)', () => {
  // La recherche du compte et l'envoi se font après la réponse : on les attend.
  const forgot = async (email: string) => {
    const response = await call({
      method: 'POST',
      url: '/api/v1/auth/password/forgot',
      payload: { email },
    });
    await deps.settle();
    return response;
  };
  const reset = (token: string, newPassword: string) =>
    call({ method: 'POST', url: '/api/v1/auth/password/reset', payload: { token, newPassword } });

  it('répond toujours 202 identique ; n’envoie un email qu’à un compte existant', async () => {
    await register();
    const unknown = await forgot('inconnu@exemple.com');
    expect(deps.emailOutbox.sent).toHaveLength(0);
    const known = await forgot(account.email);
    expect([unknown.statusCode, known.statusCode]).toEqual([202, 202]);
    expect(unknown.body).toBe(known.body);
    expect(deps.emailOutbox.sent).toHaveLength(1);
    expect(deps.emailOutbox.sent[0]).toMatchObject({
      to: account.email,
      subject: 'Réinitialisez votre mot de passe Gatio',
    });
    expect(deps.emailOutbox.sent[0]!.text).toMatch(
      /^[\s\S]*http:\/\/localhost:3000\/organisateur\/nouveau-mot-de-passe#token=/,
    );
  });

  it('change le mot de passe, ferme toutes les sessions, et le lien ne sert qu’une fois', async () => {
    const oldCookie = sessionCookie(await register());
    await forgot(account.email);
    const token = resetToken();
    expect((await reset(token, 'nouveaumotdepasse')).statusCode).toBe(200);
    expect(errorCode(await profile(oldCookie))).toBe('UNAUTHENTICATED');
    expect((await login(account.email, account.password)).statusCode).toBe(401);
    expect((await login(account.email, 'nouveaumotdepasse')).statusCode).toBe(200);
    expect(errorCode(await reset(token, 'encoreunautre'))).toBe('TOKEN_INVALID');
  });

  it('refuse un lien expiré (30 minutes) ou inventé', async () => {
    await register();
    await forgot(account.email);
    await pool.query("update password_resets set expires_at = now() - interval '1 second'");
    expect(errorCode(await reset(resetToken(), 'nouveaumotdepasse'))).toBe('TOKEN_INVALID');
    expect(errorCode(await reset('invente', 'nouveaumotdepasse'))).toBe('TOKEN_INVALID');
  });

  it('n’envoie que 3 emails par heure pour un même email, sans changer la réponse', async () => {
    await register();
    const responses = [];
    for (let i = 0; i < 4; i++) responses.push(await forgot(account.email));
    expect(responses.map((response) => response.statusCode)).toEqual([202, 202, 202, 202]);
    expect(new Set(responses.map((response) => response.body)).size).toBe(1);
    expect(deps.emailOutbox.sent).toHaveLength(3);
  });

  it('ferme les autres liens du compte quand l’un d’eux a servi', async () => {
    await register();
    await forgot(account.email);
    const first = resetToken();
    await forgot(account.email);
    const second = resetToken();
    expect((await reset(second, 'nouveaumotdepasse')).statusCode).toBe(200);
    expect(errorCode(await reset(first, 'encoreunautre'))).toBe('TOKEN_INVALID');
  });
});

describe('origine des requêtes (S2)', () => {
  it('refuse une modification venant d’un autre site', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: account.email, password: account.password },
      headers: { origin: 'https://site-malveillant.example' },
    });
    expect(errorCode(response)).toBe('FORBIDDEN');
  });

  it('refuse une modification avec cookie mais sans origine', async () => {
    const cookie = sessionCookie(await register());
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(errorCode(response)).toBe('FORBIDDEN');
  });
});
