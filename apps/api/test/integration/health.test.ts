import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { testDatabaseUrl } from './database.js';

const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 2 });

afterAll(async () => {
  await pool.end();
});

describe('base réelle', () => {
  it('la route de santé répond ok', async () => {
    const app = await buildApp({ config: { logLevel: 'silent', nodeEnv: 'test' }, pool });
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('les migrations ont installé l’extension citext du modèle de données', async () => {
    const result = await pool.query("select 1 from pg_extension where extname = 'citext'");
    expect(result.rowCount).toBe(1);
  });
});
