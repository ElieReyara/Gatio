import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { testDatabaseUrl } from './database.js';

// Crée la base de test si besoin, puis applique toutes les migrations versionnées.
export default async function setup() {
  const url = new URL(testDatabaseUrl);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  const exists = await admin.query('select 1 from pg_database where datname = $1', [name]);
  if (exists.rowCount === 0) await admin.query(`create database "${name.replace(/"/g, '')}"`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 1 });
  await migrate(drizzle({ client: pool }), {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
  await pool.end();
}
