import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Next.js ne lit que les .env de son dossier : on charge celui de la racine,
// comme l'API, pour garder un seul fichier de configuration locale.
const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const nextConfig: NextConfig = {
  poweredByHeader: false,
};

export default nextConfig;
