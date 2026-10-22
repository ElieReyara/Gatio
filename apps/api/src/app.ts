import swagger from '@fastify/swagger';
import type { ErrorResponse } from '@gatio/shared';
import Fastify, { type FastifyError } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { Config } from './config.js';
import * as schema from './db/schema.js';
import { AppError } from './lib/errors.js';
import { isAllowedOrigin } from './lib/origin.js';
import { maskPersonalData, serializeError } from './lib/redact.js';
import type { EmailOutbox } from './modules/email/outbox.js';
import { healthRoutes } from './modules/health/routes.js';
import { identityRoutes } from './modules/identity/routes.js';
import { mediaRoutes } from './modules/media/routes.js';
import type { StoragePort } from './modules/media/storage.js';
import { organizerRoutes } from './modules/organizer/routes.js';
import { scanPrototypeRoutes } from './modules/scan-prototype/routes.js';
import type { TicketSigner } from './modules/tickets/signing.js';

export type AppDependencies = {
  config: Pick<Config, 'logLevel' | 'nodeEnv' | 'webUrl' | 'allowedOrigins'>;
  pool: pg.Pool;
  ticketSigner: TicketSigner;
  emailOutbox: EmailOutbox;
  storage: StoragePort;
  runInBackground?: (task: () => Promise<void>) => void;
};

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp({
  config,
  pool,
  ticketSigner,
  emailOutbox,
  storage,
  runInBackground,
}: AppDependencies) {
  const db = drizzle({ client: pool, schema });
  const app = Fastify({
    // Le site relaie /api/v1 depuis la même machine : l'adresse du client vient alors
    // de X-Forwarded-For, crue seulement si la requête arrive de 127.0.0.1 (limites par IP).
    trustProxy: '127.0.0.1',
    logger: {
      level: config.logLevel,
      serializers: {
        req: (request) => ({ method: request.method, url: maskPersonalData(request.url) }),
        err: serializeError,
      },
    },
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: { info: { title: 'Gatio API', version: '1' } },
    transform: jsonSchemaTransform,
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message, error.details));
    }
    if (error.validation) {
      return reply
        .code(400)
        .send(errorBody('VALIDATION_ERROR', 'Données invalides.', { issues: error.validation }));
    }
    if (error.statusCode && error.statusCode < 500) {
      const code = codeForStatus(error.statusCode);
      return reply.code(error.statusCode).send(errorBody(code, defaultMessages[code]));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(errorBody('INTERNAL_ERROR', 'Erreur interne.'));
  });

  // S2 : une requête qui modifie des données avec la session du navigateur doit venir
  // d'une origine autorisée. Sans cookie (futur mobile, en-tête Authorization), rien à vérifier.
  app.addHook('onRequest', async (request) => {
    if (!MUTATING_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    const allowed = origin
      ? isAllowedOrigin(origin, config.allowedOrigins)
      : !request.headers.cookie;
    if (!allowed) throw new AppError(403, 'FORBIDDEN', 'Origine non autorisée.');
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send(errorBody('NOT_FOUND', defaultMessages.NOT_FOUND));
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes(pool));
      await api.register(
        identityRoutes({
          db,
          emailOutbox,
          webUrl: config.webUrl,
          secureCookies: config.nodeEnv === 'production',
          ...(runInBackground ? { runInBackground } : {}),
        }),
      );
      await api.register(
        organizerRoutes({ db, storage, secureCookies: config.nodeEnv === 'production' }),
      );
      await api.register(mediaRoutes(storage));
      if (config.nodeEnv !== 'production') {
        await api.register(scanPrototypeRoutes(ticketSigner), { prefix: '/dev/scan-prototype' });
      }
      api.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
    },
    { prefix: '/api/v1' },
  );

  return app;
}

// Erreurs levées par Fastify ou ses extensions (corps trop gros, type de contenu…) :
// le statut décide du code du contrat (§6.1).
function codeForStatus(status: number): ClientErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  return 'VALIDATION_ERROR';
}

type ClientErrorCode =
  'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'RATE_LIMITED' | 'VALIDATION_ERROR';

const defaultMessages: Record<ClientErrorCode, string> = {
  UNAUTHENTICATED: 'Authentification requise.',
  FORBIDDEN: 'Accès refusé.',
  NOT_FOUND: 'Ressource introuvable.',
  RATE_LIMITED: 'Trop de requêtes. Réessayez plus tard.',
  VALIDATION_ERROR: 'Requête invalide.',
};

function errorBody(
  code: ErrorResponse['error']['code'],
  message: string,
  details: Record<string, unknown> = {},
): ErrorResponse {
  return { error: { code, message, details } };
}
