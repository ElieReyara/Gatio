import { defineConfig } from 'vitest/config';

// Poste à mémoire limitée : 2 processus de test au plus (CLAUDE.md §9).
export default defineConfig({
  test: {
    // Premier chargement lent sur le poste de développement (registre d'erreurs ERR-001).
    testTimeout: 20_000,
    include: ['src/**/*.test.ts'],
    maxWorkers: 2,
  },
});
