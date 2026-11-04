import { randomUUID } from 'node:crypto';
import {
  entryReportSchema,
  errorResponseSchema,
  orderCreatedSchema,
  scanChangesSchema,
  scanManifestSchema,
  scannerInviteCreatedSchema,
  scanPassagesResponseSchema,
  type ScanPassage,
} from '@gatio/shared';
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
      'x-forwarded-for': `10.7.${Math.floor(counter / 250) % 250}.${counter % 250}`,
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
    .find((value) => value.startsWith(`${name}=`))!
    .split(';')[0]!;

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

async function publishedEvent(title = 'Soirée Sahel Live') {
  const created = await call({
    method: 'POST',
    url: '/api/v1/organizer/events',
    cookie: organizer,
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

// Commande payée (faux prestataire) : renvoie les identifiants de ses billets.
async function paidTickets(event: { slug: string; categoryId: string }, quantity = 2) {
  const reserved = await call({
    method: 'POST',
    url: '/api/v1/orders',
    headers: { 'idempotency-key': `cle-scan-${counter}-${Date.now()}` },
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
      'idempotency-key': `cle-paiement-scan-${counter}`,
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
  const { rows } = await pool.query('select id from tickets where order_id = $1 order by ordinal', [
    order.orderId,
  ]);
  return rows.map((row: { id: string }) => row.id);
}

async function scannerCookie(eventId: string, firstName = 'Abakar') {
  const created = await call({
    method: 'POST',
    url: `/api/v1/organizer/events/${eventId}/scanner-invites`,
    cookie: organizer,
  });
  const { token, invite } = scannerInviteCreatedSchema.parse(created.json());
  const joined = await call({
    method: 'POST',
    url: '/api/v1/scan/join',
    payload: { inviteToken: token, firstName },
  });
  return { cookie: cookieOf(joined, 'gatio_scan'), inviteId: invite.id };
}

// QR authentique du billet (comme le téléphone l'a lu) : sans lui, un passage « valide »
// n'utilise pas le billet.
async function qrFor(ticketId: string) {
  const { rows } = await pool.query('select event_id, category_id from tickets where id = $1', [
    ticketId,
  ]);
  if (!rows[0]) return null;
  return deps.ticketSigner.signTicket({
    ticketId,
    eventId: rows[0].event_id as string,
    categoryId: rows[0].category_id as string,
  });
}

const passage = async (
  ticketId: string | null,
  localResult: ScanPassage['localResult'] = 'valid',
): Promise<ScanPassage> => ({
  id: randomUUID(),
  ticketId,
  scannedAt: new Date().toISOString(),
  localResult,
  verifyMs: 4,
  qr: ticketId && localResult !== 'invalid' ? await qrFor(ticketId) : null,
});

const send = (cookie: string, passages: ScanPassage[]) =>
  call({ method: 'POST', url: '/api/v1/scan/passages', cookie, payload: { passages } });
const outcomes = async (cookie: string, passages: ScanPassage[]) =>
  scanPassagesResponseSchema
    .parse((await send(cookie, passages)).json())
    .results.map((result) => result.outcome);
const status = async (ticketId: string) =>
  (await pool.query('select status from tickets where id = $1', [ticketId])).rows[0]
    .status as string;

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

describe('scan complet et synchronisation (R24 à R27, C2, O8)', () => {
  it('liste : billets de l’événement seulement, clé publique, catégories ; téléchargement enregistré', async () => {
    const event = await publishedEvent();
    const other = await publishedEvent('Autre soirée');
    const ids = await paidTickets(event);
    await paidTickets(other, 1);
    const { cookie } = await scannerCookie(event.id);

    const response = await call({ url: '/api/v1/scan/manifest', cookie });
    expect(response.statusCode).toBe(200);
    const manifest = scanManifestSchema.parse(response.json());
    expect(manifest.eventId).toBe(event.id);
    expect(manifest.keys).toEqual([
      { keyId: deps.ticketSigner.keyId, publicKey: deps.ticketSigner.publicKey },
    ]);
    expect(manifest.categories).toEqual([{ id: event.categoryId, name: 'Standard' }]);
    expect(manifest.tickets.map((ticket) => ticket.id).sort()).toEqual([...ids].sort());
    expect(manifest.tickets.every((ticket) => ticket.status === 'valid' && !ticket.usedAt)).toBe(
      true,
    );
    const { rows } = await pool.query('select ticket_count from manifest_downloads');
    expect(rows).toEqual([{ ticket_count: 2 }]);
    expect((await call({ url: '/api/v1/scan/manifest' })).statusCode).toBe(401);
  });

  it('passage valide : billet utilisé ; lot rejoué sans effet double', async () => {
    const event = await publishedEvent();
    const [ticket] = await paidTickets(event, 1);
    const { cookie } = await scannerCookie(event.id);
    const first = await passage(ticket!);
    expect(await outcomes(cookie, [first])).toEqual(['accepted']);
    expect(await status(ticket!)).toBe('used');
    // Réseau perdu avant la réponse : le téléphone renvoie le même lot.
    const replay = scanPassagesResponseSchema.parse((await send(cookie, [first])).json()).results;
    expect(replay[0]).toMatchObject({ id: first.id, outcome: 'accepted' });
    expect(replay[0]!.usedAt).not.toBeNull();
    const { rows } = await pool.query('select outcome from passages');
    expect(rows).toEqual([{ outcome: 'accepted' }]);
  });

  it('deux téléphones hors ligne sur le même billet : un accepté, un doublon signalé (R26)', async () => {
    const event = await publishedEvent();
    const [ticket] = await paidTickets(event, 1);
    const abakar = await scannerCookie(event.id, 'Abakar');
    const fatime = await scannerCookie(event.id, 'Fatimé');
    const results = await Promise.all([
      outcomes(abakar.cookie, [await passage(ticket!)]),
      outcomes(fatime.cookie, [await passage(ticket!)]),
    ]);
    expect(results.flat().sort()).toEqual(['accepted', 'duplicate']);
    const report = entryReportSchema.parse(
      (
        await call({ url: `/api/v1/organizer/events/${event.id}/entry-report`, cookie: organizer })
      ).json(),
    );
    expect(report).toMatchObject({ entered: 1, sold: 1, duplicates: 1 });
    const duplicate = report.latest.find((row) => row.outcome === 'duplicate')!;
    expect(duplicate.usedAt).not.toBeNull();
    expect(duplicate.categoryName).toBe('Standard');
    expect(duplicate.orderReference).toMatch(/^GT-/);
  });

  it('billet annulé, d’un autre événement, inconnu ; QR invalide sans effet sur le billet', async () => {
    const event = await publishedEvent();
    const other = await publishedEvent('Autre soirée');
    const [voided, signedBad] = await paidTickets(event, 2);
    const [foreign] = await paidTickets(other, 1);
    await pool.query("update tickets set status = 'void', voided_at = now() where id = $1", [
      voided,
    ]);
    const { cookie } = await scannerCookie(event.id);
    expect(
      await outcomes(cookie, [
        await passage(voided!, 'void'),
        await passage(foreign!),
        await passage(randomUUID()),
        await passage(signedBad!, 'invalid'),
        await passage(null, 'invalid'),
      ]),
    ).toEqual(['void_ticket', 'wrong_event', 'unknown_ticket', 'unknown_ticket', 'unknown_ticket']);
    expect(await status(signedBad!)).toBe('valid');
    expect(await status(foreign!)).toBe('valid');
  });

  it('changements depuis le curseur : billet vendu après la liste, billet utilisé (R27)', async () => {
    const event = await publishedEvent();
    const [first] = await paidTickets(event, 1);
    const { cookie } = await scannerCookie(event.id);
    const manifest = scanManifestSchema.parse(
      (await call({ url: '/api/v1/scan/manifest', cookie })).json(),
    );
    const [later] = await paidTickets(event, 1);
    await send(cookie, [await passage(first!)]);
    const response = await call({
      url: `/api/v1/scan/changes?since=${encodeURIComponent(manifest.cursor)}`,
      cookie,
    });
    const changes = scanChangesSchema.parse(response.json());
    const byId = new Map(changes.tickets.map((ticket) => [ticket.id, ticket]));
    expect(byId.get(later!)?.status).toBe('valid');
    expect(byId.get(first!)?.status).toBe('used');
    expect(byId.get(first!)?.usedAt).not.toBeNull();
    expect(new Date(changes.cursor).getTime()).toBeGreaterThanOrEqual(
      new Date(manifest.cursor).getTime(),
    );
    const invalid = await call({ url: '/api/v1/scan/changes?since=hier', cookie });
    expect(errorOf(invalid).code).toBe('VALIDATION_ERROR');
  });

  it('session coupée : liste, passages et changements refusés', async () => {
    const event = await publishedEvent();
    const [ticket] = await paidTickets(event, 1);
    const { cookie, inviteId } = await scannerCookie(event.id);
    await call({
      method: 'DELETE',
      url: `/api/v1/organizer/scanner-invites/${inviteId}`,
      cookie: organizer,
    });
    expect((await call({ url: '/api/v1/scan/manifest', cookie })).statusCode).toBe(401);
    expect((await send(cookie, [await passage(ticket!)])).statusCode).toBe(401);
    const since = encodeURIComponent(new Date().toISOString());
    expect((await call({ url: `/api/v1/scan/changes?since=${since}`, cookie })).statusCode).toBe(
      401,
    );
    expect(await status(ticket!)).toBe('valid');
  });

  it('rapport d’entrée : téléphones à jour, derniers passages ; vide ; isolation (S5)', async () => {
    const event = await publishedEvent();
    const empty = entryReportSchema.parse(
      (
        await call({ url: `/api/v1/organizer/events/${event.id}/entry-report`, cookie: organizer })
      ).json(),
    );
    expect(empty).toEqual({ entered: 0, sold: 0, duplicates: 0, phonesUpToDate: 0, latest: [] });
    const [ticket] = await paidTickets(event, 1);
    const { cookie } = await scannerCookie(event.id, 'Abakar');
    await call({ url: '/api/v1/scan/manifest', cookie });
    await send(cookie, [await passage(ticket!)]);
    const report = entryReportSchema.parse(
      (
        await call({ url: `/api/v1/organizer/events/${event.id}/entry-report`, cookie: organizer })
      ).json(),
    );
    expect(report).toMatchObject({ entered: 1, sold: 1, duplicates: 0, phonesUpToDate: 1 });
    expect(report.latest[0]).toMatchObject({
      outcome: 'accepted',
      scannerName: 'Abakar',
      usedAt: null,
    });
    const intruder = await register('autre@exemple.com');
    const forbidden = await call({
      url: `/api/v1/organizer/events/${event.id}/entry-report`,
      cookie: intruder,
    });
    expect(forbidden.statusCode).toBe(404);
  });

  it('passage « valide » sans le QR authentique du billet : le billet n’est pas utilisé', async () => {
    const event = await publishedEvent();
    const [target, other] = await paidTickets(event, 2);
    const { cookie } = await scannerCookie(event.id);
    const withoutQr = { ...(await passage(target!)), qr: null };
    const otherQr = { ...(await passage(target!)), qr: await qrFor(other!) };
    const forged = { ...(await passage(target!)), qr: 'faux' };
    expect(await outcomes(cookie, [withoutQr, otherQr, forged])).toEqual([
      'unknown_ticket',
      'unknown_ticket',
      'unknown_ticket',
    ]);
    expect(await status(target!)).toBe('valid');
    expect(await status(other!)).toBe('valid');
  });

  it('fin de session : les passages hors réseau partent encore 24 h, rien d’autre (F11)', async () => {
    const event = await publishedEvent();
    const [early, late] = await paidTickets(event, 2);
    const { cookie } = await scannerCookie(event.id);
    const offline = await passage(early!);
    // La soirée est finie depuis une heure : la session est terminée…
    await pool.query(
      "update scanner_invites set expires_at = now() - interval '1 hour' where event_id = $1",
      [event.id],
    );
    expect((await call({ url: '/api/v1/scan/session', cookie })).statusCode).toBe(401);
    expect((await call({ url: '/api/v1/scan/manifest', cookie })).statusCode).toBe(401);
    // … mais les passages faits hors réseau remontent encore.
    expect(await outcomes(cookie, [offline])).toEqual(['accepted']);
    // Au-delà du délai de grâce : refusés.
    await pool.query(
      "update scanner_invites set expires_at = now() - interval '25 hours' where event_id = $1",
      [event.id],
    );
    expect((await send(cookie, [await passage(late!)])).statusCode).toBe(401);
    expect(await status(late!)).toBe('valid');
  });

  it('lot trop grand ou passage mal formé : refusé sans rien enregistrer', async () => {
    const event = await publishedEvent();
    const { cookie } = await scannerCookie(event.id);
    const tooMany = await Promise.all(Array.from({ length: 101 }, () => passage(randomUUID())));
    expect(errorOf(await send(cookie, tooMany)).code).toBe('VALIDATION_ERROR');
    const malformed = await call({
      method: 'POST',
      url: '/api/v1/scan/passages',
      cookie,
      payload: { passages: [{ ...(await passage(randomUUID())), localResult: 'super' }] },
    });
    expect(errorOf(malformed).code).toBe('VALIDATION_ERROR');
    expect((await pool.query('select count(*)::int as n from passages')).rows[0].n).toBe(0);
  });
});
