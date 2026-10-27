import {
  errorResponseSchema,
  myTicketsSchema,
  orderCreatedSchema,
  orderSchema,
} from '@gatio/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FakePaymentProvider } from '../../src/modules/payments/fake-provider.js';
import type { memorySms } from '../../src/modules/sms/port.js';
import { buyerCookie, testDependencies, testOrigin } from '../../src/test-support.js';
import { testDatabaseUrl } from './database.js';

const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 10 });
let app: FastifyInstance;
let deps: ReturnType<typeof testDependencies>;
let sms: ReturnType<typeof memorySms>;
let organizer: string;
let counter = 0;

const VICTIM = '66 12 34 56';
const OTHER = '66 65 43 21';

function call(options: InjectOptions & { cookie?: string }) {
  const { cookie, headers, ...rest } = options;
  return app.inject({
    ...rest,
    headers: { origin: testOrigin, ...(cookie ? { cookie } : {}), ...headers },
  });
}

const errorOf = (response: { json(): unknown }) => errorResponseSchema.parse(response.json()).error;
const count = async (table: string, where = 'true') =>
  (await pool.query(`select count(*)::int as n from ${table} where ${where}`)).rows[0].n as number;
const requestCode = (phone: string) =>
  call({ method: 'POST', url: '/api/v1/auth/buyer/otp/request', payload: { phone } });
const verify = (phone: string, code: string) =>
  call({ method: 'POST', url: '/api/v1/auth/buyer/otp/verify', payload: { phone, code } });
const lastCode = () => /(\d{3}) (\d{3})/.exec(sms.sent.at(-1)!.text)!.slice(1).join('');
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
// Le renvoi n'est permis qu'une fois par minute : les tests effacent ce compteur.
const nextMinute = () =>
  pool.query("delete from rate_limit_counters where key like 'otp_send_min:%'");
const sessionCookie = (response: { headers: Record<string, unknown> }) =>
  [response.headers['set-cookie'] ?? []]
    .flat()
    .map(String)
    .find((value) => value.startsWith('gatio_buyer='));

async function publishedEvent(options: { startsInDays?: number } = {}) {
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
      startsAt: new Date(
        Date.now() + (options.startsInDays ?? 30) * 24 * 3600 * 1000,
      ).toISOString(),
      capacity: 1000,
    },
  });
  const event = created.json() as { id: string; slug: string };
  const category = await call({
    method: 'POST',
    url: `/api/v1/organizer/events/${event.id}/categories`,
    cookie: organizer,
    payload: { name: 'Standard', priceAmount: 5_000, quantityTotal: 100 },
  });
  await call({
    method: 'POST',
    url: `/api/v1/organizer/events/${event.id}/publish`,
    cookie: organizer,
  });
  return { ...event, categoryId: (category.json() as { id: string }).id };
}

function reserve(
  event: { slug: string; categoryId: string },
  phone: string,
  options: { cookie?: string; quantity?: number } = {},
) {
  counter += 1;
  return call({
    method: 'POST',
    url: '/api/v1/orders',
    cookie: options.cookie,
    headers: {
      'idempotency-key': `cle-acheteur-${counter}-${Date.now()}`,
      'x-forwarded-for': `10.3.0.${counter % 250}`,
    },
    payload: {
      eventSlug: event.slug,
      items: [{ categoryId: event.categoryId, quantity: options.quantity ?? 2 }],
      contact: { name: 'Mahamat Idriss', phone },
    },
  });
}

async function paidOrder(
  event: { slug: string; categoryId: string },
  phone: string,
  options: { cookie?: string; quantity?: number } = {},
) {
  const order = orderCreatedSchema.parse((await reserve(event, phone, options)).json());
  await call({
    method: 'POST',
    url: `/api/v1/orders/${order.orderId}/payments`,
    headers: {
      'idempotency-key': `cle-paiement-acheteur-${counter}`,
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

const myTickets = async (cookie: string) =>
  myTicketsSchema.parse((await call({ url: '/api/v1/me/tickets', cookie })).json()).items;

async function start(options: { phoneVerification?: boolean } = {}) {
  deps = testDependencies(pool, {
    config: {
      logLevel: 'silent',
      nodeEnv: 'test',
      webUrl: 'http://localhost:3000',
      allowedOrigins: [testOrigin],
      buyers: {
        phoneVerification: options.phoneVerification ?? false,
        otpSecret: 'secret-des-codes-pour-les-tests-0000',
      },
    },
  });
  sms = deps.sms as ReturnType<typeof memorySms>;
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
}

async function reset() {
  await pool.query(
    'truncate users, organizers, auth_sessions, password_resets, rate_limit_counters, events, ticket_categories, fee_rules, audit_log, buyers, orders, order_items, funnel_events, payments, payment_webhook_events, reconciliation_runs, discrepancies, payouts, tickets, email_verifications, outbound_messages, otp_codes cascade',
  );
  await pool.query(`insert into fee_rules (scope, scope_id, calc_type, params, currency, valid_from)
    values ('platform', null, 'percent_fixed', '{"percent_bps": 400, "fixed_amount": 100}', 'XAF', now() - interval '1 minute')`);
}

beforeEach(async () => {
  await reset();
  await start();
});

afterAll(async () => {
  await pool.end();
});

describe('code de connexion (R31, B6, M1)', () => {
  it('réponse identique pour un numéro connu ou inconnu ; SMS de la maquette M1, suivi', async () => {
    const event = await publishedEvent();
    await paidOrder(event, VICTIM);
    const known = await requestCode(VICTIM);
    const unknown = await requestCode(OTHER);
    expect([known.statusCode, unknown.statusCode]).toEqual([202, 202]);
    expect(known.json()).toEqual(unknown.json());
    expect(sms.sent.map((message) => message.to)).toEqual(['+23566123456', '+23566654321']);
    expect(sms.sent[0]!.text).toMatch(
      /^Gatio : votre code est \d{3} \d{3}\. Il est valable 5 minutes\. Ne le donnez à personne\.$/,
    );
    expect(
      await count('outbound_messages', "channel = 'sms' and purpose = 'otp' and status = 'sent'"),
    ).toBe(2);
    // Le code n'est jamais stocké en clair.
    const { rows } = await pool.query('select code_hash from otp_codes');
    expect(rows.every((row: { code_hash: string }) => /^[0-9a-f]{64}$/.test(row.code_hash))).toBe(
      true,
    );
    expect(rows.some((row: { code_hash: string }) => row.code_hash.includes(lastCode()))).toBe(
      false,
    );
  });

  it('numéro hors +235 : refusé ; panne d’envoi : même réponse, trace « failed »', async () => {
    const foreign = await requestCode('+33 6 12 34 56 78');
    expect(errorOf(foreign).code).toBe('VALIDATION_ERROR');
    sms.failing = true;
    expect((await requestCode(VICTIM)).statusCode).toBe(202);
    expect(await count('outbound_messages', "status = 'failed'")).toBe(1);
  });

  it('bon code : session de 90 jours, numéro vérifié, compte créé ; code à usage unique', async () => {
    await requestCode(VICTIM);
    const code = lastCode();
    const response = await verify(VICTIM, `${code.slice(0, 3)} ${code.slice(3)}`);
    expect(response.statusCode).toBe(200);
    const cookie = sessionCookie(response)!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=7776000/);
    const { rows } = await pool.query(
      `select phone_e164, phone_verified_at is not null as verified,
        (select round(extract(epoch from expires_at - now()) / 86400) from auth_sessions where buyer_id is not null) as days
       from buyers`,
    );
    expect(rows).toEqual([{ phone_e164: '+23566123456', verified: true, days: '90' }]);
    expect(errorOf(await verify(VICTIM, code)).code).toBe('TOKEN_INVALID');
  });

  it('code faux : essais restants, puis trop d’essais (15 minutes) ; le bon code ne passe plus', async () => {
    await requestCode(VICTIM);
    const code = lastCode();
    for (const left of [4, 3, 2, 1]) {
      const response = await verify(VICTIM, wrong(code));
      expect(errorOf(response)).toMatchObject({
        code: 'TOKEN_INVALID',
        details: { attemptsLeft: left },
      });
    }
    const fifth = await verify(VICTIM, wrong(code));
    expect(fifth.statusCode).toBe(429);
    expect(errorOf(fifth).details.reason).toBe('otp_locked');
    expect(errorOf(await verify(VICTIM, code)).details.reason).toBe('otp_locked');
    await nextMinute();
    expect(errorOf(await requestCode(VICTIM)).details.reason).toBe('otp_locked');
    // Au moins 15 minutes après le dernier essai (code créé il y a 20 minutes au plus) :
    // encore bloqué à 16 minutes, libre à 21.
    await pool.query("update otp_codes set created_at = created_at - interval '16 minutes'");
    expect((await requestCode(VICTIM)).statusCode).toBe(429);
    await pool.query("update otp_codes set created_at = created_at - interval '5 minutes'");
    await nextMinute();
    expect((await requestCode(VICTIM)).statusCode).toBe(202);
  });

  it('essais simultanés : jamais plus de 5 comptés', async () => {
    await requestCode(VICTIM);
    const code = lastCode();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => verify(VICTIM, wrong(code))),
    );
    expect(responses.filter((response) => response.statusCode === 400)).toHaveLength(4);
    expect((await pool.query('select attempts from otp_codes')).rows).toEqual([{ attempts: 5 }]);
  });

  it('code expiré ou remplacé par un nouveau : refusé', async () => {
    await requestCode(VICTIM);
    const first = lastCode();
    await nextMinute();
    await requestCode(VICTIM);
    const second = lastCode();
    if (first !== second) {
      expect(errorOf(await verify(VICTIM, first))).toMatchObject({
        code: 'TOKEN_INVALID',
        details: { attemptsLeft: 4 },
      });
    }
    await pool.query("update otp_codes set expires_at = now() - interval '1 second'");
    expect(errorOf(await verify(VICTIM, second))).toMatchObject({
      code: 'TOKEN_INVALID',
      details: { attemptsLeft: null },
    });
  });

  it('limites d’envoi : 1 par minute, 3 par 15 minutes pour un numéro', async () => {
    expect((await requestCode(VICTIM)).statusCode).toBe(202);
    expect((await requestCode(VICTIM)).statusCode).toBe(429);
    await nextMinute();
    expect((await requestCode(VICTIM)).statusCode).toBe(202);
    await nextMinute();
    expect((await requestCode(VICTIM)).statusCode).toBe(202);
    await nextMinute();
    expect((await requestCode(VICTIM)).statusCode).toBe(429);
    expect(sms.sent).toHaveLength(3);
    // Un autre numéro n'est pas touché.
    expect((await requestCode(OTHER)).statusCode).toBe(202);
  });
});

describe('« Mes billets » (B7)', () => {
  it('celui qui commande avec le numéro d’un autre ne voit pas les billets de cet autre (roadmap)', async () => {
    const event = await publishedEvent();
    // Vérification coupée : le tiers commande avec le numéro de la victime.
    const order = await paidOrder(event, VICTIM);
    const stranger = await buyerCookie(app, sms, OTHER);
    expect(await myTickets(stranger)).toEqual([]);
    const victimTickets = orderSchema.parse(
      (
        await call({
          url: `/api/v1/orders/${order.orderId}`,
          headers: { 'x-order-token': order.orderToken },
        })
      ).json(),
    ).tickets;
    // Ni la commande ni le PDF par la session du tiers.
    expect(
      (await call({ url: `/api/v1/orders/${order.orderId}`, cookie: stranger })).statusCode,
    ).toBe(404);
    expect(
      (await call({ url: `/api/v1/me/tickets/${victimTickets[0]!.id}/pdf`, cookie: stranger }))
        .statusCode,
    ).toBe(404);

    // La victime, avec son code, retrouve ses billets.
    const victim = await buyerCookie(app, sms, VICTIM);
    const items = await myTickets(victim);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      event: { slug: event.slug, title: 'Soirée Sahel Live', status: 'published' },
      past: false,
      orders: [
        {
          orderId: order.orderId,
          lines: [{ categoryName: 'Standard', quantity: 2 }],
          tickets: [
            { id: victimTickets[0]!.id, index: 1, status: 'valid' },
            { id: victimTickets[1]!.id, index: 2, status: 'valid' },
          ],
        },
      ],
    });
    const pdf = await call({
      url: `/api/v1/me/tickets/${victimTickets[1]!.id}/pdf`,
      cookie: victim,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('-2.pdf');
    // La session ouvre aussi la commande (accès « commande », §6.1).
    expect(
      (await call({ url: `/api/v1/orders/${order.orderId}`, cookie: victim })).statusCode,
    ).toBe(200);
  });

  it('sans session : 401 ; événement annulé, billet annulé, événement passé ; déconnexion', async () => {
    expect((await call({ url: '/api/v1/me/tickets' })).statusCode).toBe(401);
    const soon = await publishedEvent({ startsInDays: 10 });
    const later = await publishedEvent({ startsInDays: 40 });
    const cancelled = await publishedEvent({ startsInDays: 20 });
    await paidOrder(later, VICTIM, { quantity: 1 });
    const soonOrder = await paidOrder(soon, VICTIM, { quantity: 2 });
    await paidOrder(cancelled, VICTIM, { quantity: 1 });
    await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${cancelled.id}/cancel`,
      cookie: organizer,
    });
    await pool.query(
      "update tickets set status = 'void' where id = (select id from tickets where order_id = $1 order by ordinal desc limit 1)",
      [soonOrder.orderId],
    );
    // Un événement passé (commencé il y a plus d'un jour) va dans « Passés ».
    await pool.query("update events set starts_at = now() - interval '3 days' where id = $1", [
      later.id,
    ]);

    const victim = await buyerCookie(app, sms, VICTIM);
    const items = await myTickets(victim);
    expect(items.map((item) => [item.event.slug, item.event.status, item.past])).toEqual([
      [soon.slug, 'published', false],
      [cancelled.slug, 'cancelled', false],
      [later.slug, 'published', true],
    ]);
    expect(items[0]!.orders[0]!.tickets.map((ticket) => ticket.status)).toEqual(['valid', 'void']);

    const logout = await call({ method: 'POST', url: '/api/v1/auth/logout', cookie: victim });
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers['set-cookie'])).toContain('gatio_buyer=;');
    expect((await call({ url: '/api/v1/me/tickets', cookie: victim })).statusCode).toBe(401);
  });
});

describe('vérification du numéro avant de réserver (journal de bord n° 71)', () => {
  it('sans code : refusé ; avec la session d’un autre numéro : refusé ; avec la sienne : réservé', async () => {
    await reset();
    await start({ phoneVerification: true });
    const event = await publishedEvent();
    const anonymous = await reserve(event, VICTIM);
    expect(anonymous.statusCode).toBe(401);
    expect(errorOf(anonymous).details.reason).toBe('phone_verification_required');
    const other = await buyerCookie(app, sms, OTHER);
    expect((await reserve(event, VICTIM, { cookie: other })).statusCode).toBe(401);
    expect(await count('orders')).toBe(0);

    // Code du bon numéro saisi sur ce même navigateur : l'ancienne session est fermée.
    await requestCode(VICTIM);
    const verified = await call({
      method: 'POST',
      url: '/api/v1/auth/buyer/otp/verify',
      cookie: other,
      payload: { phone: VICTIM, code: lastCode() },
    });
    const victim = sessionCookie(verified)!.split(';')[0]!;
    expect(await count('auth_sessions', 'revoked_at is null and buyer_id is not null')).toBe(1);
    const reserved = await reserve(event, VICTIM, { cookie: victim });
    expect(reserved.statusCode).toBe(201);
    expect((await pool.query('select phone_verified from orders')).rows).toEqual([
      { phone_verified: true },
    ]);
  });
});

describe('compléments de la revue isolée (tranche 8)', () => {
  it('événement reporté dont l’ancienne date est passée : toujours « à venir »', async () => {
    const event = await publishedEvent({ startsInDays: 10 });
    await paidOrder(event, VICTIM, { quantity: 1 });
    await call({
      method: 'POST',
      url: `/api/v1/organizer/events/${event.id}/postpone`,
      cookie: organizer,
    });
    await pool.query("update events set starts_at = now() - interval '3 days' where id = $1", [
      event.id,
    ]);
    const items = await myTickets(await buyerCookie(app, sms, VICTIM));
    expect(items.map((item) => [item.event.status, item.past])).toEqual([['postponed', false]]);
  });

  it('un code juste au 5e essai ne bloque pas le numéro ensuite', async () => {
    await requestCode(VICTIM);
    const code = lastCode();
    for (let i = 0; i < 4; i++) await verify(VICTIM, wrong(code));
    expect((await verify(VICTIM, code)).statusCode).toBe(200);
    await nextMinute();
    expect((await requestCode(VICTIM)).statusCode).toBe(202);
  });

  it('10 codes par jour au plus pour un numéro', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await requestCode(VICTIM)).statusCode).toBe(202);
      await pool.query(
        "delete from rate_limit_counters where key like 'otp_send_min:%' or key like 'otp_send:%'",
      );
    }
    expect((await requestCode(VICTIM)).statusCode).toBe(429);
  });

  it('session d’un autre numéro : ni paiement ni PDF de la commande', async () => {
    const event = await publishedEvent();
    const order = await paidOrder(event, VICTIM);
    const [ticket] = orderSchema.parse(
      (
        await call({
          url: `/api/v1/orders/${order.orderId}`,
          headers: { 'x-order-token': order.orderToken },
        })
      ).json(),
    ).tickets;
    const stranger = await buyerCookie(app, sms, OTHER);
    const payment = await call({
      method: 'POST',
      url: `/api/v1/orders/${order.orderId}/payments`,
      cookie: stranger,
      headers: { 'idempotency-key': 'cle-paiement-etranger-0001' },
      payload: { method: 'airtel_money' },
    });
    expect(payment.statusCode).toBe(404);
    const pdf = await call({
      url: `/api/v1/orders/${order.orderId}/tickets/${ticket!.id}/pdf`,
      cookie: stranger,
    });
    expect(pdf.statusCode).toBe(404);
  });

  it('jeton d’organisateur et jeton d’acheteur ne s’échangent pas', async () => {
    const buyerToken = (await buyerCookie(app, sms, VICTIM)).split('=')[1]!;
    const organizerToken = organizer.split('=')[1]!;
    const asBuyer = await call({
      url: '/api/v1/me/tickets',
      headers: { authorization: `Bearer ${organizerToken}` },
    });
    expect(asBuyer.statusCode).toBe(401);
    const asOrganizer = await call({
      url: '/api/v1/organizer/events',
      headers: { authorization: `Bearer ${buyerToken}` },
    });
    expect(asOrganizer.statusCode).toBe(401);
    expect(
      (
        await call({
          url: '/api/v1/me/tickets',
          headers: { authorization: `Bearer ${buyerToken}` },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('vérification coupée : commande non vérifiée, même avec la session d’un autre numéro', async () => {
    const event = await publishedEvent();
    const other = await buyerCookie(app, sms, OTHER);
    expect((await reserve(event, VICTIM, { cookie: other })).statusCode).toBe(201);
    expect((await pool.query('select phone_verified from orders')).rows).toEqual([
      { phone_verified: false },
    ]);
    const detail = (await call({ url: `/api/v1/events/${event.slug}` })).json() as {
      phoneVerification: boolean;
    };
    expect(detail.phoneVerification).toBe(false);
  });

  it('en production, le cookie de session acheteur est « Secure »', async () => {
    deps = testDependencies(pool, {
      config: {
        logLevel: 'silent',
        nodeEnv: 'production',
        webUrl: 'http://localhost:3000',
        allowedOrigins: [testOrigin],
        buyers: { phoneVerification: true, otpSecret: 'secret-des-codes-pour-les-tests-0000' },
      },
    });
    sms = deps.sms as ReturnType<typeof memorySms>;
    app = await buildApp(deps);
    await requestCode(VICTIM);
    const response = await verify(VICTIM, lastCode());
    expect(sessionCookie(response)).toMatch(/; Secure/);
  });
});
