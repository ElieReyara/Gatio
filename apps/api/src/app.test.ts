import { errorResponseSchema } from '@gatio/shared';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { InjectOptions } from 'fastify';
import { buildApp } from './app.js';

const config = { logLevel: 'silent', nodeEnv: 'test' } as const;

function fakePool(query: () => Promise<unknown>) {
  return { query } as unknown as pg.Pool;
}

describe('GET /api/v1/health', () => {
  it('répond ok quand la base répond', async () => {
    const app = await buildApp({ config, pool: fakePool(async () => ({ rows: [] })) });
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('répond 503 quand la base est injoignable', async () => {
    const app = await buildApp({
      config,
      pool: fakePool(async () => {
        throw new Error('connection refused');
      }),
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'degraded', database: 'unavailable' });
  });
});

describe('format d’erreur commun', () => {
  it('renvoie NOT_FOUND au format du contrat pour une route inconnue', async () => {
    const app = await buildApp({ config, pool: fakePool(async () => ({})) });
    const response = await app.inject({ method: 'GET', url: '/api/v1/inconnue' });
    expect(response.statusCode).toBe(404);
    const body = errorResponseSchema.parse(response.json());
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('format d’erreur commun selon le statut', () => {
  async function appWithTestRoutes() {
    const app = await buildApp({ config, pool: fakePool(async () => ({})) });
    app.post('/test/body', { schema: { body: z.object({ name: z.string() }) } }, async () => ({}));
    app.get('/test/limited', async () => {
      throw Object.assign(new Error('Rate limit exceeded'), { statusCode: 429 });
    });
    app.get('/test/crash', async () => {
      throw Object.assign(new Error('échec pour nom@exemple.com'), {
        detail: 'Key (email)=(nom@exemple.com) already exists.',
      });
    });
    return app;
  }

  it.each([
    [
      'corps invalide',
      { method: 'POST', url: '/test/body', payload: { name: 3 } },
      400,
      'VALIDATION_ERROR',
    ],
    [
      'type de contenu non pris en charge',
      {
        method: 'POST',
        url: '/test/body',
        payload: 'x',
        headers: { 'content-type': 'application/xml' },
      },
      415,
      'VALIDATION_ERROR',
    ],
    ['trop de requêtes', { method: 'GET', url: '/test/limited' }, 429, 'RATE_LIMITED'],
    ['erreur inattendue', { method: 'GET', url: '/test/crash' }, 500, 'INTERNAL_ERROR'],
  ] as const)('%s', async (_label, request, status, code) => {
    const app = await appWithTestRoutes();
    const response = await app.inject(request as InjectOptions);
    expect(response.statusCode).toBe(status);
    const body = errorResponseSchema.parse(response.json());
    expect(body.error.code).toBe(code);
    expect(response.body).not.toContain('nom@exemple.com');
    await app.close();
  });
});

describe('OpenAPI', () => {
  it('est généré depuis les schémas et décrit la route de santé', async () => {
    const app = await buildApp({ config, pool: fakePool(async () => ({})) });
    const response = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
    expect(response.statusCode).toBe(200);
    expect(response.json().paths).toHaveProperty('/api/v1/health');
  });
});
