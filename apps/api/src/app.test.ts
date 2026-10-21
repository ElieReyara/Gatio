import { errorResponseSchema } from '@gatio/shared';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
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

describe('OpenAPI', () => {
  it('est généré depuis les schémas et décrit la route de santé', async () => {
    const app = await buildApp({ config, pool: fakePool(async () => ({})) });
    const response = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
    expect(response.statusCode).toBe(200);
    expect(response.json().paths).toHaveProperty('/api/v1/health');
  });
});
