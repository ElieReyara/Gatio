import swagger from '@fastify/swagger';
import type { ErrorResponse } from '@gatio/shared';
import Fastify, { type FastifyError } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type pg from 'pg';
import type { Config } from './config.js';
import { AppError } from './lib/errors.js';
import { maskPersonalData } from './lib/redact.js';
import { healthRoutes } from './modules/health/routes.js';

export type AppDependencies = {
  config: Pick<Config, 'logLevel' | 'nodeEnv'>;
  pool: pg.Pool;
};

export async function buildApp({ config, pool }: AppDependencies) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      serializers: {
        req: (request) => ({ method: request.method, url: maskPersonalData(request.url) }),
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
      return reply.code(error.statusCode).send(errorBody('VALIDATION_ERROR', error.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(errorBody('INTERNAL_ERROR', 'Erreur interne.'));
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send(errorBody('NOT_FOUND', 'Ressource introuvable.'));
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes(pool));
      api.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
    },
    { prefix: '/api/v1' },
  );

  return app;
}

function errorBody(
  code: ErrorResponse['error']['code'],
  message: string,
  details: Record<string, unknown> = {},
): ErrorResponse {
  return { error: { code, message, details } };
}
