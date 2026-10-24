// Tables du modèle de données (03-modele-de-donnees.md), ajoutées tranche par tranche.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  boolean,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Emails insensibles à la casse (extension citext, migration 0000).
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const userRole = pgEnum('user_role', ['organizer', 'admin', 'support']);
export const accountStatus = pgEnum('account_status', ['active', 'suspended']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull(),
  status: accountStatus('status').notNull().default('active'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  mfaSecretEnc: text('mfa_secret_enc'),
  mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),
  mfaLastStep: bigint('mfa_last_step', { mode: 'number' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organizers = pgTable('organizers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  displayName: text('display_name').notNull(),
  description: text('description'),
  contactPhone: text('contact_phone'),
  status: accountStatus('status').notNull().default('active'),
  suspendedReason: text('suspended_reason'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  payoutMethod: text('payout_method'),
  payoutDestination: text('payout_destination'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Sessions des utilisateurs, et des acheteurs à partir de la tranche 8.
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    buyerId: uuid('buyer_id').references(() => buyers.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (table) => [
    check('auth_sessions_one_owner', sql`num_nonnulls(${table.userId}, ${table.buyerId}) = 1`),
    index('auth_sessions_user_id_idx').on(table.userId),
  ],
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ip: inet('ip'),
    createdAt: createdAt(),
  },
  (table) => [index('password_resets_user_id_idx').on(table.userId)],
);

// Compteurs de limites dans PostgreSQL (pas de Redis, conception §3.4).
export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.key, table.windowStart] })],
);

// Événements et billets (tranche 3).
export const eventStatus = pgEnum('event_status', [
  'draft',
  'published',
  'postponed',
  'cancelled',
  'suspended',
]);
export const eventType = pgEnum('event_type', [
  'concert',
  'party',
  'sport',
  'conference',
  'culture',
  'other',
]);
export const feeScope = pgEnum('fee_scope', ['platform', 'organizer', 'event', 'category']);
export const feeCalcType = pgEnum('fee_calc_type', ['percent_fixed', 'tiered']);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    imageKey: text('image_key'),
    eventType: eventType('event_type').notNull(),
    city: text('city').notNull(),
    venue: text('venue').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    capacity: integer('capacity').notNull(),
    status: eventStatus('status').notNull().default('draft'),
    statusBeforeSuspension: eventStatus('status_before_suspension'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('events_capacity_positive', sql`${table.capacity} > 0`),
    index('events_status_starts_at_idx').on(table.status, table.startsAt),
    index('events_city_idx').on(table.city),
    index('events_organizer_id_idx').on(table.organizerId),
  ],
);

export const ticketCategories = pgTable(
  'ticket_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    name: text('name').notNull(),
    priceAmount: bigint('price_amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    quantityTotal: integer('quantity_total').notNull(),
    quantitySold: integer('quantity_sold').notNull().default(0),
    quantityReserved: integer('quantity_reserved').notNull().default(0),
    position: integer('position').notNull().default(0),
    saleStartsAt: timestamp('sale_starts_at', { withTimezone: true }),
    saleEndsAt: timestamp('sale_ends_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Dernier filet de sécurité de l'anti-survente (modèle de données).
    check(
      'ticket_categories_stock',
      sql`${table.quantitySold} >= 0 and ${table.quantityReserved} >= 0 and ${table.quantitySold} + ${table.quantityReserved} <= ${table.quantityTotal}`,
    ),
    check('ticket_categories_price_positive', sql`${table.priceAmount} > 0`),
    check('ticket_categories_quantity_positive', sql`${table.quantityTotal} > 0`),
    check(
      'ticket_categories_sale_period',
      sql`${table.saleStartsAt} is null or ${table.saleEndsAt} is null or ${table.saleEndsAt} > ${table.saleStartsAt}`,
    ),
    index('ticket_categories_event_id_idx').on(table.eventId),
  ],
);

// Règles de frais : des données, jamais du code (instructions générales, règle 4).
export const feeRules = pgTable(
  'fee_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: feeScope('scope').notNull(),
    scopeId: uuid('scope_id'),
    calcType: feeCalcType('calc_type').notNull(),
    params: jsonb('params').notNull(),
    currency: text('currency').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    // Vide pour la règle de départ, créée par la migration.
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (table) => [
    check('fee_rules_scope_id', sql`(${table.scope} = 'platform') = (${table.scopeId} is null)`),
    index('fee_rules_scope_idx').on(table.scope, table.scopeId),
  ],
);

// Journal d'audit des actions sensibles (S6).
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    createdAt: createdAt(),
  },
  (table) => [index('audit_log_entity_idx').on(table.entityType, table.entityId)],
);

// Acheteurs et commandes (tranche 5).
export const orderStatus = pgEnum('order_status', [
  'pending',
  'paid',
  'expired',
  'cancelled',
  'needs_review',
  'refunded',
]);
export const funnelEventType = pgEnum('funnel_event_type', [
  'event_view',
  'checkout_started',
  'payment_initiated',
  'payment_confirmed',
  'ticket_downloaded',
]);

// Un numéro = un compte (R30) ; le numéro n'est vérifié qu'à la connexion par code (R31).
export const buyers = pgTable('buyers', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneE164: text('phone_e164').notNull().unique(),
  name: text('name').notNull(),
  phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
  email: citext('email'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull().unique(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => buyers.id),
    contactName: text('contact_name').notNull(),
    contactPhone: text('contact_phone').notNull(),
    // Facultatif et non validé : sert seulement à envoyer le billet (R32).
    contactEmail: text('contact_email'),
    status: orderStatus('status').notNull().default('pending'),
    currency: text('currency').notNull(),
    totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
    feeTotal: bigint('fee_total', { mode: 'number' }).notNull(),
    payoutTotal: bigint('payout_total', { mode: 'number' }).notNull(),
    accessTokenHash: text('access_token_hash').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    // Adresse ou session anonyme : la clé de rejeu n'est unique que pour un même client.
    idempotencyScope: text('idempotency_scope').notNull(),
    reservationExpiresAt: timestamp('reservation_expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'orders_amounts',
      sql`${table.totalAmount} = ${table.feeTotal} + ${table.payoutTotal} and ${table.totalAmount} > 0`,
    ),
    uniqueIndex('orders_idempotency_idx').on(table.idempotencyScope, table.idempotencyKey),
    index('orders_status_expires_idx').on(table.status, table.reservationExpiresAt),
    index('orders_buyer_id_idx').on(table.buyerId),
    index('orders_event_status_idx').on(table.eventId, table.status),
    index('orders_contact_phone_idx').on(table.contactPhone, table.status),
  ],
);

// Les trois montants figés par ligne à la création de la commande (R5).
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => ticketCategories.id),
    quantity: integer('quantity').notNull(),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    unitFee: bigint('unit_fee', { mode: 'number' }).notNull(),
    unitPayout: bigint('unit_payout', { mode: 'number' }).notNull(),
    feeRuleId: uuid('fee_rule_id')
      .notNull()
      .references(() => feeRules.id),
    createdAt: createdAt(),
  },
  (table) => [
    check('order_items_quantity_positive', sql`${table.quantity} > 0`),
    check('order_items_amounts', sql`${table.unitPayout} = ${table.unitPrice} - ${table.unitFee}`),
    index('order_items_order_id_idx').on(table.orderId),
  ],
);

// Mesures du parcours (cahier de conception §8) : identifiant de session anonyme.
export const funnelEvents = pgTable(
  'funnel_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    anonSessionId: text('anon_session_id').notNull(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    orderId: uuid('order_id').references(() => orders.id),
    type: funnelEventType('type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [index('funnel_events_event_type_idx').on(table.eventId, table.type)],
);

export const paymentStatus = pgEnum('payment_status', [
  'pending',
  'confirmed',
  'failed',
  'refunded',
]);
export const ticketStatus = pgEnum('ticket_status', ['valid', 'used', 'void']);
export const payoutStatus = pgEnum('payout_status', ['pending', 'held', 'sent', 'failed']);
export const discrepancyKind = pgEnum('discrepancy_kind', [
  'missing_local',
  'missing_provider',
  'amount_mismatch',
  'status_mismatch',
  'duplicate_payment',
  'late_payment',
]);

// R13 : un seul paiement en attente par commande ; nouvelle ligne à chaque essai.
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref').notNull(),
    method: text('method').notNull(),
    status: paymentStatus('status').notNull().default('pending'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    providerFeeAmount: bigint('provider_fee_amount', { mode: 'number' }),
    failureReason: text('failure_reason'),
    // Clé de rejeu exigée par le contrat (§6.1) sur le démarrage d'un paiement.
    idempotencyKey: text('idempotency_key').notNull(),
    // Prochaine action rendue par le prestataire (§3.11), redonnée si la demande est rejouée.
    nextAction: jsonb('next_action'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('payments_provider_ref_idx').on(table.provider, table.providerRef),
    uniqueIndex('payments_order_idempotency_idx').on(table.orderId, table.idempotencyKey),
    uniqueIndex('payments_one_pending_idx')
      .on(table.orderId)
      .where(sql`${table.status} = 'pending'`),
    index('payments_status_created_idx').on(table.status, table.createdAt),
    check('payments_amount_positive', sql`${table.amount} > 0`),
  ],
);

// R15 : chaque notification est gardée telle que reçue ; un doublon est ignoré.
export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    payload: jsonb('payload').notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    outcome: text('outcome'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('payment_webhook_events_provider_event_idx').on(
      table.provider,
      table.providerEventId,
    ),
    // Rattrapage des notifications non traitées.
    index('payment_webhook_events_unprocessed_idx')
      .on(table.createdAt)
      .where(sql`${table.processedAt} is null`),
  ],
);

export const reconciliationRuns = pgTable('reconciliation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  periodFrom: timestamp('period_from', { withTimezone: true }).notNull(),
  periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  summary: jsonb('summary'),
  createdAt: createdAt(),
});

export const discrepancies = pgTable(
  'discrepancies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').references(() => reconciliationRuns.id),
    paymentId: uuid('payment_id').references(() => payments.id),
    providerRef: text('provider_ref'),
    kind: discrepancyKind('kind').notNull(),
    details: jsonb('details').notNull(),
    status: text('status').notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check('discrepancies_status', sql`${table.status} in ('open', 'resolved')`),
    index('discrepancies_status_idx').on(table.status),
    index('discrepancies_payment_id_idx').on(table.paymentId),
  ],
);

// R21 : un versement par commande payée, créé dans la transaction de confirmation.
export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => organizers.id),
    orderId: uuid('order_id')
      .notNull()
      .unique()
      .references(() => orders.id),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    method: text('method').notNull(),
    destination: text('destination').notNull(),
    status: payoutStatus('status').notNull(),
    providerRef: text('provider_ref'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('payouts_organizer_status_idx').on(table.organizerId, table.status),
    check('payouts_amount_positive', sql`${table.amount} > 0`),
  ],
);

// R23 : un billet n'existe qu'après la confirmation du paiement (transaction R14).
export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => ticketCategories.id),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => buyers.id),
    ordinal: integer('ordinal').notNull(),
    status: ticketStatus('status').notNull().default('valid'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('tickets_item_ordinal_idx').on(table.orderItemId, table.ordinal),
    index('tickets_event_status_idx').on(table.eventId, table.status),
    index('tickets_event_updated_idx').on(table.eventId, table.updatedAt),
    index('tickets_buyer_id_idx').on(table.buyerId),
    index('tickets_order_id_idx').on(table.orderId),
  ],
);
