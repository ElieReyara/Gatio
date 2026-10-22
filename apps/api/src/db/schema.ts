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

// Sessions des utilisateurs, et des acheteurs à partir de la tranche 8 (la clé
// étrangère vers buyers sera ajoutée avec la table).
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    buyerId: uuid('buyer_id'),
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
