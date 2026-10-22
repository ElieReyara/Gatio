import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createJobQueue } from './jobs/boss.js';
import { startMaintenance } from './jobs/maintenance.js';
import { jobEmailOutbox, startEmailWorker } from './modules/email/outbox.js';
import { mailpitEmail } from './modules/email/port.js';
import { createTicketSigner, generateSigningKey } from './modules/tickets/signing.js';

const config = loadConfig();
const { pool } = createDatabase(config.databaseUrl);
const jobs = createJobQueue(config.databaseUrl);
const ticketSigner = createTicketSigner(
  config.ticketSigning.keyId,
  config.ticketSigning.privateKey ?? generateSigningKey(),
);
const app = await buildApp({ config, pool, ticketSigner, emailOutbox: jobEmailOutbox(jobs) });
if (!config.ticketSigning.privateKey) {
  app.log.warn('TICKET_SIGNING_PRIVATE_KEY absente : clé éphémère, QR invalides après redémarrage');
}

// Sans écouteur, la coupure d'une connexion inactive arrêterait le processus.
pool.on('error', (error) => app.log.error({ err: error }, 'idle database client error'));
jobs.on('error', (error) => app.log.error({ err: error }, 'job queue error'));
await jobs.start();
await startEmailWorker(
  jobs,
  mailpitEmail(config.email.mailpitUrl, { email: config.email.from, name: 'Gatio' }),
  app.log,
);
await startMaintenance(jobs, pool);
await app.listen({ port: config.port, host: config.host });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await jobs.stop();
    await pool.end();
    process.exit(0);
  });
}
