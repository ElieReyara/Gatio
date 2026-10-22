import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));

const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

// Valeurs locales par défaut, refusées en production : une variable manquante
// doit y arrêter le démarrage plutôt que pointer vers une base de développement.
const localDefaults = {
  API_HOST: '127.0.0.1',
  API_PORT: '4000',
  DATABASE_URL: 'postgres://gatio:gatio@localhost:5432/gatio',
  LOG_LEVEL: 'info',
  TICKET_SIGNING_KEY_ID: '1',
  WEB_URL: 'http://localhost:3000',
  // Le tunnel d'essai sur téléphone passe par une adresse *.trycloudflare.com.
  ALLOWED_ORIGINS: 'http://localhost:3000,http://127.0.0.1:3000,https://*.trycloudflare.com',
  MAILPIT_URL: 'http://127.0.0.1:8025',
  EMAIL_FROM: 'noreply@gatio.local',
};

const envSchema = z.object({
  // Adresse publique du site, pour les liens des emails.
  WEB_URL: z.string().url(),
  // Origines autorisées à modifier des données (S2), séparées par des virgules ;
  // « https://*.domaine » accepte les sous-domaines.
  ALLOWED_ORIGINS: z.string().min(1),
  // Envoi des emails : seule la boîte de test Mailpit existe avant la tranche 16.
  MAILPIT_URL: z.string().url(),
  EMAIL_FROM: z.email(),
  API_HOST: z.string().min(1),
  API_PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  TICKET_SIGNING_KEY_ID: z.coerce.number().int().min(0).max(255),
  // Facultative en développement (clé éphémère), obligatoire en production.
  TICKET_SIGNING_PRIVATE_KEY: z.string().min(1).optional(),
});

export type Config = {
  nodeEnv: z.infer<typeof nodeEnvSchema>;
  host: string;
  port: number;
  databaseUrl: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  ticketSigning: { keyId: number; privateKey: string | undefined };
  webUrl: string;
  allowedOrigins: string[];
  email: { mailpitUrl: string; from: string };
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
  if (nodeEnv === 'production' && !parsed.data.TICKET_SIGNING_PRIVATE_KEY) {
    throw new Error('Configuration invalide ou manquante : TICKET_SIGNING_PRIVATE_KEY');
  }
  return {
    nodeEnv,
    host: parsed.data.API_HOST,
    port: parsed.data.API_PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    logLevel: parsed.data.LOG_LEVEL,
    ticketSigning: {
      keyId: parsed.data.TICKET_SIGNING_KEY_ID,
      privateKey: parsed.data.TICKET_SIGNING_PRIVATE_KEY,
    },
    webUrl: parsed.data.WEB_URL.replace(/\/$/, ''),
    allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
    email: { mailpitUrl: parsed.data.MAILPIT_URL, from: parsed.data.EMAIL_FROM },
  };
}

function definedOnly(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
    ),
  );
}
