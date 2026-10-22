// Tables du modèle de données (03-modele-de-donnees.md), ajoutées tranche par tranche.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  inet,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
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
