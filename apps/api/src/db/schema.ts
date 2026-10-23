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
