import {
  errorResponseSchema,
  loginRequestSchema,
  organizerProfileSchema,
  passwordForgotRequestSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  type OrganizerProfile,
} from '@gatio/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { organizers, passwordResets, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { limits } from '../../lib/limits.js';
import { hashPassword, spendPasswordCheckTime, verifyPassword } from '../../lib/passwords.js';
import { consumeLimit } from '../../lib/rate-limit.js';
import { hashToken, newToken } from '../../lib/tokens.js';
import type { EmailOutbox } from '../email/outbox.js';
import { passwordResetEmail } from '../email/templates.js';
import {
  clearSessionCookie,
  readSessionToken,
  requireOrganizer,
  setSessionCookie,
} from './auth.js';
import {
  createUserSession,
  findUserSession,
  revokeAllUserSessions,
  revokeSession,
} from './sessions.js';

export type IdentityDependencies = {
  db: Db;
  emailOutbox: EmailOutbox;
  webUrl: string;
  secureCookies: boolean;
  // Travail fait après la réponse ; les tests le remplacent pour pouvoir l'attendre.
  runInBackground?: (task: () => Promise<void>) => void;
};

const RESET_MINUTES = 30;
const accepted = z.object({});
const errors = { 400: errorResponseSchema, 401: errorResponseSchema, 429: errorResponseSchema };

export const identityRoutes =
  ({
    db,
    emailOutbox,
    webUrl,
    secureCookies,
    runInBackground,
  }: IdentityDependencies): FastifyPluginAsyncZod =>
  async (app) => {
    const tooMany = () => new AppError(429, 'RATE_LIMITED', 'Trop d’essais. Réessayez plus tard.');
    const background =
      runInBackground ??
      ((task: () => Promise<void>) => {
        void task().catch((error: unknown) =>
          app.log.error({ err: error }, 'background task failed'),
        );
      });

    app.post(
      '/auth/register',
      {
        schema: {
          body: registerRequestSchema,
          response: { 201: organizerProfileSchema, ...errors },
        },
      },
      async (request, reply) => {
        if (!(await consumeLimit(db, `register_ip:${request.ip}`, limits.registerPerIp)))
          throw tooMany();
        const { email, password, displayName } = request.body;
        const passwordHash = await hashPassword(password);
        const userId = await db
          .transaction(async (tx) => {
            const [user] = await tx
              .insert(users)
              .values({ email, passwordHash, role: 'organizer' })
              .returning({ id: users.id });
            await tx.insert(organizers).values({ userId: user!.id, displayName });
            return user!.id;
          })
          .catch((error: unknown) => {
            if (isUniqueViolation(error)) {
              throw new AppError(400, 'VALIDATION_ERROR', 'Un compte existe déjà avec cet email.', {
                field: 'email',
                reason: 'already_registered',
              });
            }
            throw error;
          });
        setSessionCookie(
          reply,
          await createUserSession(db, userId, request.headers['user-agent']),
          secureCookies,
        );
        return reply.code(201).send(await loadProfile(db, userId));
      },
    );

    app.post(
      '/auth/login',
      {
        schema: { body: loginRequestSchema, response: { 200: organizerProfileSchema, ...errors } },
      },
      async (request, reply) => {
        const { email, password } = request.body;
        const allowed =
          (await consumeLimit(db, `login_ip:${request.ip}`, limits.loginPerIp)) &&
          (await consumeLimit(db, `login_email:${email}`, limits.loginPerEmail));
        if (!allowed) throw tooMany();

        // Comptes internes (administrateur, support) : connexion en deux étapes en tranche 14.
        const [user] = await db
          .select({ id: users.id, passwordHash: users.passwordHash })
          .from(users)
          .where(and(eq(users.email, email), eq(users.role, 'organizer')));
        const valid = user ? await verifyPassword(user.passwordHash, password) : false;
        if (!user) await spendPasswordCheckTime(password);
        if (!user || !valid) {
          throw new AppError(401, 'UNAUTHENTICATED', 'Email ou mot de passe incorrect.');
        }
        await db
          .update(users)
          .set({ lastLoginAt: sql`now()` })
          .where(eq(users.id, user.id));
        setSessionCookie(
          reply,
          await createUserSession(db, user.id, request.headers['user-agent']),
          secureCookies,
        );
        return loadProfile(db, user.id);
      },
    );

    app.post(
      '/auth/logout',
      { schema: { response: { 204: z.null() } } },
      async (request, reply) => {
        const token = readSessionToken(request);
        const session = token ? await findUserSession(db, token) : null;
        if (session) await revokeSession(db, session.sessionId);
        clearSessionCookie(reply, secureCookies);
        return reply.code(204).send(null);
      },
    );

    // R36 : réponse toujours identique, que l'email existe, soit limité ou non. La recherche
    // du compte et l'envoi se font après la réponse : sa durée ne révèle rien.
    app.post(
      '/auth/password/forgot',
      { schema: { body: passwordForgotRequestSchema, response: { 202: accepted, ...errors } } },
      async (request, reply) => {
        const { email } = request.body;
        const allowed =
          (await consumeLimit(db, `pwd_reset_ip:${request.ip}`, limits.passwordForgotPerIp)) &&
          (await consumeLimit(db, `pwd_reset:${email}`, limits.passwordForgotPerEmail));
        const ip = request.ip;
        if (allowed) background(() => sendPasswordReset(email, ip));
        return reply.code(202).send({});
      },
    );

    async function sendPasswordReset(email: string, ip: string) {
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), eq(users.role, 'organizer')));
      if (!user) return;
      const { token, hash } = newToken();
      await db.insert(passwordResets).values({
        userId: user.id,
        tokenHash: hash,
        expiresAt: sql`now() + make_interval(mins => ${RESET_MINUTES})`,
        ip,
      });
      // Jeton après le « # » : il n'apparaît dans aucun journal de serveur.
      const link = `${webUrl}/organisateur/nouveau-mot-de-passe#token=${token}`;
      await emailOutbox.enqueue(passwordResetEmail(email, link));
    }

    app.post(
      '/auth/password/reset',
      { schema: { body: passwordResetRequestSchema, response: { 200: accepted, ...errors } } },
      async (request) => {
        if (
          !(await consumeLimit(db, `pwd_reset_use_ip:${request.ip}`, limits.passwordResetPerIp))
        ) {
          throw tooMany();
        }
        const { token, newPassword } = request.body;
        const invalid = () => new AppError(400, 'TOKEN_INVALID', 'Ce lien n’est plus valable.');
        // Vérification peu coûteuse avant argon2 : un jeton inventé ne coûte presque rien.
        const [candidate] = await db
          .select({ id: passwordResets.id })
          .from(passwordResets)
          .where(
            and(
              eq(passwordResets.tokenHash, hashToken(token)),
              isNull(passwordResets.consumedAt),
              gt(passwordResets.expiresAt, sql`now()`),
            ),
          );
        if (!candidate) throw invalid();
        const passwordHash = await hashPassword(newPassword);
        const done = await db.transaction(async (tx) => {
          // Consommation atomique : un lien ne sert qu'une fois, même sur deux envois simultanés.
          const [reset] = await tx
            .update(passwordResets)
            .set({ consumedAt: sql`now()` })
            .where(
              and(
                eq(passwordResets.tokenHash, hashToken(token)),
                isNull(passwordResets.consumedAt),
                gt(passwordResets.expiresAt, sql`now()`),
              ),
            )
            .returning({ userId: passwordResets.userId });
          if (!reset) return false;
          await tx
            .update(users)
            .set({ passwordHash, updatedAt: sql`now()` })
            .where(eq(users.id, reset.userId));
          await revokeAllUserSessions(tx, reset.userId);
          // Les autres liens encore valables de ce compte ne doivent plus servir.
          await tx
            .update(passwordResets)
            .set({ consumedAt: sql`now()` })
            .where(and(eq(passwordResets.userId, reset.userId), isNull(passwordResets.consumedAt)));
          return true;
        });
        if (!done) throw invalid();
        return {};
      },
    );

    app.get(
      '/organizer/profile',
      {
        preHandler: requireOrganizer(db, secureCookies),
        schema: { response: { 200: organizerProfileSchema, 401: errorResponseSchema } },
      },
      async (request) => loadProfile(db, request.organizer!.userId),
    );
  };

async function loadProfile(db: Db, userId: string): Promise<OrganizerProfile> {
  const [profile] = await db
    .select({
      email: users.email,
      displayName: organizers.displayName,
      description: organizers.description,
      contactPhone: organizers.contactPhone,
    })
    .from(organizers)
    .innerJoin(users, eq(users.id, organizers.userId))
    .where(eq(users.id, userId));
  if (!profile) throw new AppError(404, 'NOT_FOUND', 'Profil introuvable.');
  return profile;
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause;
  return (error as { code?: string }).code === '23505' || cause?.code === '23505';
}
