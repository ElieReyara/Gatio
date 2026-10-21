import { PgBoss } from 'pg-boss';

// Tâches de fond dans PostgreSQL, exécutées dans le processus de l'API au lancement
// (cahier de conception §3.4). Les tâches sont déclarées par les modules qui en ont besoin.
export function createJobQueue(databaseUrl: string) {
  return new PgBoss({ connectionString: databaseUrl, max: 2 });
}
