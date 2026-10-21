import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));

const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

// Valeurs locales par défaut, refusées en production : une variable manquante
// doit y arrêter le démarrage plutôt que pointer vers une base de développement.
const localDefaults = {
  API_PORT: '4000',
  DATABASE_URL: 'postgres://gatio:gatio@localhost:5432/gatio',
  LOG_LEVEL: 'info',
};

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
});

export type Config = {
  nodeEnv: z.infer<typeof nodeEnvSchema>;
  port: number;
  databaseUrl: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env && existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

  const nodeEnv = nodeEnvSchema.parse(env.NODE_ENV);
  const source = nodeEnv === 'production' ? env : { ...localDefaults, ...definedOnly(env) };
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuration invalide ou manquante : ${fields}`);
  }
  return {
    nodeEnv,
    port: parsed.data.API_PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    logLevel: parsed.data.LOG_LEVEL,
  };
}

function definedOnly(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
    ),
  );
}
