import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createJobQueue } from './jobs/boss.js';

const config = loadConfig();
const { pool } = createDatabase(config.databaseUrl);
const jobs = createJobQueue(config.databaseUrl);
const app = await buildApp({ config, pool });

// Sans écouteur, la coupure d'une connexion inactive arrêterait le processus.
pool.on('error', (error) => app.log.error({ err: error }, 'idle database client error'));
jobs.on('error', (error) => app.log.error({ err: error }, 'job queue error'));
await jobs.start();
await app.listen({ port: config.port, host: config.host });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await jobs.stop();
    await pool.end();
    process.exit(0);
  });
}
