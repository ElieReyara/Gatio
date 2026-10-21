import { defineConfig } from 'vitest/config';

// Tests sur une vraie base PostgreSQL (docker compose ou service de la CI).
export default defineConfig({
  test: {
    // Premier chargement lent sur le poste de développement (registre d'erreurs ERR-001).
    testTimeout: 20_000,
    include: ['test/integration/**/*.test.ts'],
    maxWorkers: 1,
    globalSetup: ['test/integration/global-setup.ts'],
  },
});
