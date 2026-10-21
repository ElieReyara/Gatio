import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export function createDatabase(databaseUrl: string) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 3000,
  });
  const db = drizzle({ client: pool, schema });
  return { pool, db };
}

export type Database = ReturnType<typeof createDatabase>;
