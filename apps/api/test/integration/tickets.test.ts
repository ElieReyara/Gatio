import { errorResponseSchema, orderCreatedSchema, orderSchema } from '@gatio/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import type { EmailMessage, EmailPort } from '../../src/modules/email/port.js';
import type { FakePaymentProvider } from '../../src/modules/payments/fake-provider.js';
import { sendQueuedTicketEmails } from '../../src/modules/tickets/email.js';
import { testDependencies, testOrigin } from '../../src/test-support.js';
import { testDatabaseUrl } from './database.js';

const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 10 });
const db = drizzle({ client: pool, schema });
let app: FastifyInstance;
let deps: ReturnType<typeof testDependencies>;
let fake: FakePaymentProvider;
let organizer: string;
let sent: EmailMessage[];
let failing: boolean;
let counter = 0;

const mailbox: EmailPort = {
  async send(message) {
    if (failing) throw new Error('boîte indisponible');
    sent.push(message);
  },
};
const send = () =>
  sendQueuedTicketEmails(db, {
    email: mailbox,
    signer: deps.ticketSigner,
    webUrl: 'http://localhost:3000',
  });

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

async function paidOrder(
  options: { quantity?: number; email?: string | null; phone?: string } = {},
) {
  counter += 1;
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
      startsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
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
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/orders',
    headers: {
      origin: testOrigin,
      'idempotency-key': `cle-billet-${counter}-${Date.now()}`,
      'x-forwarded-for': `10.2.0.${counter % 250}`,
    },
    payload: {
      eventSlug: event.slug,
      items: [
        { categoryId: (category.json() as { id: string }).id, quantity: options.quantity ?? 2 },
      ],
      contact: {
        name: 'Mahamat Idriss',
        phone: options.phone ?? `66${String(300000 + counter).slice(-6)}`,
        ...(options.email === null ? {} : { email: options.email ?? 'acheteur@exemple.com' }),
      },
    },
  });
  const order = orderCreatedSchema.parse(response.json());
  await app.inject({
    method: 'POST',
    url: `/api/v1/orders/${order.orderId}/payments`,
    headers: {
      origin: testOrigin,
      'idempotency-key': `cle-paiement-billet-${counter}`,
      'x-order-token': order.orderToken,
    },
    payload: { method: 'airtel_money' },
  });
  const ref = fake.list().find((payment) => payment.status === 'pending')!.providerRef;
  await app.inject({
    method: 'POST',
    url: `/api/v1/dev/fake-payments/${ref}`,
    headers: { origin: testOrigin },
    payload: { outcome: 'accept' },
  });
  await deps.settle();
  return order;
}

const linkToken = (text: string, path: string) =>
  new RegExp(`${path}#t=([A-Za-z0-9_-]+)`).exec(text)?.[1];

beforeEach(async () => {
  await pool.query(
    'truncate users, organizers, auth_sessions, password_resets, rate_limit_counters, events, ticket_categories, fee_rules, audit_log, buyers, orders, order_items, funnel_events, payments, payment_webhook_events, reconciliation_runs, discrepancies, payouts, tickets, email_verifications, outbound_messages cascade',
  );
  await pool.query(`insert into fee_rules (scope, scope_id, calc_type, params, currency, valid_from)
    values ('platform', null, 'percent_fixed', '{"percent_bps": 400, "fixed_amount": 100}', 'XAF', now() - interval '1 minute')`);
  sent = [];
  failing = false;
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

describe('PDF du billet (§3.9, P1)', () => {
  it('téléchargé avec le jeton de commande ; refusé sans jeton ou avant le paiement', async () => {
    const order = await paidOrder();
    const read = orderSchema.parse(
      (
        await app.inject({
          url: `/api/v1/orders/${order.orderId}`,
          headers: { 'x-order-token': order.orderToken },
        })
      ).json(),
    );
    const url = `/api/v1/orders/${order.orderId}/tickets/${read.tickets[0]!.id}/pdf`;
    const pdf = await app.inject({ url, headers: { 'x-order-token': order.orderToken } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(
      /^attachment; filename="billet-GT-.+-1\.pdf"$/,
    );
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await app.inject({ url })).statusCode).toBe(404);
    expect((await app.inject({ url, headers: { 'x-order-token': 'faux' } })).statusCode).toBe(404);
  });
});

describe('accès au PDF', () => {
  it('jeton d’une autre commande, billet d’une autre commande, billet annulé : refusés ; mesure comptée une fois', async () => {
    const a = await paidOrder();
    const b = await paidOrder();
    const ticketsOf = async (order: { orderId: string; orderToken: string }) =>
      orderSchema.parse(
        (
          await app.inject({
            url: `/api/v1/orders/${order.orderId}`,
            headers: { 'x-order-token': order.orderToken },
          })
        ).json(),
      ).tickets;
    const [ticketA] = await ticketsOf(a);
    const [ticketB] = await ticketsOf(b);
    const pdf = (orderId: string, ticketId: string, token: string) =>
      app.inject({
        url: `/api/v1/orders/${orderId}/tickets/${ticketId}/pdf`,
        headers: { 'x-order-token': token },
      });
    expect((await pdf(b.orderId, ticketB!.id, a.orderToken)).statusCode).toBe(404);
    expect((await pdf(a.orderId, ticketB!.id, a.orderToken)).statusCode).toBe(404);
    expect((await pdf(a.orderId, ticketA!.id, a.orderToken)).statusCode).toBe(200);
    expect((await pdf(a.orderId, ticketA!.id, a.orderToken)).statusCode).toBe(200);
    await pool.query('update tickets set status = $1 where id = $2', ['void', ticketA!.id]);
    expect((await pdf(a.orderId, ticketA!.id, a.orderToken)).statusCode).toBe(404);
  });

  it('billet d’essai en PDF (critère « le PDF se scanne avec la page de la tranche 1 »)', async () => {
    const response = await app.inject({ url: '/api/v1/dev/scan-prototype/sample.pdf' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('email du billet (R14, R32, E1)', () => {
  it('mis en file à la confirmation ; PDF joints, lien vers la commande avec un jeton après « # »', async () => {
    const order = await paidOrder({ quantity: 2 });
    expect(await count('outbound_messages', "status = 'queued' and purpose = 'ticket'")).toBe(1);
    await send();
    expect(sent).toHaveLength(1);
    const [message] = sent;
    expect(message!.to).toBe('acheteur@exemple.com');
    expect(message!.subject).toBe('Vos billets pour Soirée Sahel Live');
    expect(message!.attachments).toHaveLength(2);
    expect(message!.attachments![0]!.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await count('outbound_messages', "status = 'sent'")).toBe(1);

    // Le lien de l'email ouvre la commande et ses billets depuis n'importe quel appareil.
    const token = linkToken(message!.text, `/commande/${order.orderId}`);
    expect(token).toBeDefined();
    const read = await app.inject({
      url: `/api/v1/orders/${order.orderId}`,
      headers: { 'x-order-token': token! },
    });
    expect(orderSchema.parse(read.json())).toMatchObject({ status: 'paid', ticketEmail: 'sent' });
    // Le jeton du navigateur reste valable.
    const again = await app.inject({
      url: `/api/v1/orders/${order.orderId}`,
      headers: { 'x-order-token': order.orderToken },
    });
    expect(again.statusCode).toBe(200);
  });

  it('échec d’envoi : nouvel essai plus tard, pas à chaque passage ; envois simultanés : un seul email', async () => {
    await paidOrder();
    failing = true;
    await send();
    expect(sent).toHaveLength(0);
    expect(
      await count(
        'outbound_messages',
        "status = 'queued' and attempts = 1 and next_attempt_at > now()",
      ),
    ).toBe(1);
    failing = false;
    await send();
    expect(sent).toHaveLength(0);
    await pool.query("update outbound_messages set next_attempt_at = now() - interval '1 second'");
    await Promise.all([send(), send(), send()]);
    expect(sent).toHaveLength(1);
    expect(await count('outbound_messages', "status = 'sent'")).toBe(1);
  });

  it('trop d’essais : abandonné ; billets tous annulés : rien n’est envoyé', async () => {
    await paidOrder();
    await pool.query(
      "update outbound_messages set attempts = 8, next_attempt_at = now() - interval '1 second'",
    );
    await send();
    expect(sent).toHaveLength(0);
    expect(await count('outbound_messages', "status = 'failed'")).toBe(1);

    await paidOrder();
    await pool.query(
      "update tickets set status = 'void' where order_id = (select order_id from outbound_messages where status = 'queued')",
    );
    await send();
    expect(sent).toHaveLength(0);
    expect(await count('outbound_messages', "status = 'queued'")).toBe(0);
  });

  it('sans email à l’achat ni email validé : rien n’est envoyé', async () => {
    await paidOrder({ email: null });
    expect(await count('outbound_messages')).toBe(0);
  });
});

describe('validation de l’email (R32, B9)', () => {
  it('l’email n’est rattaché au compte qu’après validation ; lien à usage unique', async () => {
    await paidOrder({ phone: '66 12 34 56' });
    await send();
    expect((await pool.query('select email from buyers')).rows).toEqual([{ email: null }]);
    const token = linkToken(sent[0]!.text, '/email/confirmer');
    expect(token).toBeDefined();
    const confirm = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/email-verifications/confirm',
        headers: { origin: testOrigin },
        payload: { token },
      });
    expect((await confirm()).statusCode).toBe(200);
    const { rows } = await pool.query(
      'select email, email_verified_at is not null as verified from buyers',
    );
    expect(rows).toEqual([{ email: 'acheteur@exemple.com', verified: true }]);
    expect(errorOf(await confirm()).code).toBe('TOKEN_INVALID');

    // Achat suivant avec la même adresse : billet envoyé, sans nouveau lien de validation.
    await paidOrder({ phone: '66 12 34 56' });
    await send();
    expect(sent).toHaveLength(2);
    expect(linkToken(sent[1]!.text, '/email/confirmer')).toBeUndefined();
  });

  it('un tiers qui valide son adresse sur le numéro d’un autre ne reçoit pas ses billets (revue, B1)', async () => {
    // Le tiers achète avec le numéro de la victime et sa propre adresse, puis la valide.
    await paidOrder({ phone: '66 12 34 56', email: 'tiers@exemple.com' });
    await send();
    const token = linkToken(sent[0]!.text, '/email/confirmer');
    await app.inject({
      method: 'POST',
      url: '/api/v1/email-verifications/confirm',
      headers: { origin: testOrigin },
      payload: { token },
    });
    // La victime achète sans donner d'email : rien ne part vers l'adresse du tiers.
    await paidOrder({ phone: '66 12 34 56', email: null });
    await send();
    expect(sent).toHaveLength(1);
    // Avec son email : le billet part chez elle seulement.
    await paidOrder({ phone: '66 12 34 56', email: 'victime@exemple.com' });
    await send();
    expect(sent.map((message) => message.to)).toEqual(['tiers@exemple.com', 'victime@exemple.com']);
  });

  it('confirmer une adresse annule les autres liens en attente du compte', async () => {
    await paidOrder({ phone: '66 12 34 56', email: 'premiere@exemple.com' });
    await paidOrder({ phone: '66 12 34 56', email: 'seconde@exemple.com' });
    await send();
    const [first, second] = sent.map((message) => linkToken(message.text, '/email/confirmer'));
    const confirm = (token: string | undefined) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/email-verifications/confirm',
        headers: { origin: testOrigin },
        payload: { token },
      });
    expect((await confirm(second)).statusCode).toBe(200);
    expect(errorOf(await confirm(first)).code).toBe('TOKEN_INVALID');
    expect((await pool.query('select email from buyers')).rows).toEqual([
      { email: 'seconde@exemple.com' },
    ]);
  });

  it('lien expiré : refusé', async () => {
    await paidOrder();
    await send();
    await pool.query("update email_verifications set expires_at = now() - interval '1 second'");
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/email-verifications/confirm',
      headers: { origin: testOrigin },
      payload: { token: linkToken(sent[0]!.text, '/email/confirmer') },
    });
    expect(errorOf(response).code).toBe('TOKEN_INVALID');
    expect((await pool.query('select email from buyers')).rows).toEqual([{ email: null }]);
  });
});
