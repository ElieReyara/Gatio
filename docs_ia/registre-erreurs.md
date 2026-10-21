# Registre d'erreurs — Gatio

À lire avant chaque tranche. Une ligne par erreur rencontrée ; identifiant `ERR-NNN`.

| ID | Date | Contexte | Message | Cause | Solution | Prévention |
|---|---|---|---|---|---|---|
| ERR-001 | 21/10/2026 | Tranche 0, `pnpm test` (API) | `Test timed out in 5000ms` sur le premier test de `src/app.test.ts` | Premier chargement de Fastify, Swagger et Zod : 1 à 2 s hors test, 8,5 s sous Vitest sur le poste à 8 Go (mémoire saturée) | `testTimeout` porté à 20 s dans les deux configurations Vitest de l'API | Garder le délai à 20 s ; si un test dépasse quand même, chercher une vraie lenteur avant d'augmenter encore |
| ERR-002 | 21/10/2026 | Tranche 0, test à froid (clone dans un dossier temporaire profond) | `ERR_PACKAGE_IMPORT_NOT_DEFINED: Package import specifier "#module-evaluator" is not defined` (Vitest) | Chemin de `vitest/dist/module-evaluator.js` à 275 caractères, au-delà de la limite Windows de 260 | Cloner dans un chemin court : reproduit à 147 caractères, tests verts | Consigne ajoutée dans CLAUDE.md §9 ; garder le dépôt dans un chemin court |
