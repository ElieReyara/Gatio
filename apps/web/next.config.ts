import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Next.js ne lit que les .env de son dossier : on charge celui de la racine,
// comme l'API, pour garder un seul fichier de configuration locale.
const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

// Relais vers l'API : le navigateur (et le téléphone derrière un tunnel) ne connaît que
// le site. Fixé au build ; l'absence d'API_URL en production est refusée à l'exécution
// par src/lib/api.ts.
const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;
