import { errorResponseSchema, healthResponseSchema } from '@gatio/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type pg from 'pg';

export const healthRoutes =
  (pool: pg.Pool): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/health',
      {
        schema: {
          summary: 'Santé du service',
          response: {
            200: healthResponseSchema,
            503: healthResponseSchema,
            500: errorResponseSchema,
          },
        },
      },
      async (_request, reply) => {
        try {
          await pool.query('select 1');
          return { status: 'ok' as const, database: 'ok' as const };
        } catch {
          return reply.code(503).send({ status: 'degraded', database: 'unavailable' });
        }
      },
    );
  };
