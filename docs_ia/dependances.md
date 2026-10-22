# Dépendances — Gatio

Aucune dépendance sans accord explicite du responsable (CLAUDE.md §4).
Les versions sont fixées à l'installation (tranche 0) et notées ici.

## Installées
| Paquet | Version | Rôle | Usage | Fichiers | Accord (qui, date) |
|---|---|---|---|---|---|
| pnpm (corepack) | 10.34.6 | Gestionnaire du monorepo | Installation, scripts | `package.json` (`packageManager`), `pnpm-workspace.yaml` | Responsable, 21/10/2026 (PC-0a) — pnpm 12 non lancé par corepack 0.34 |
| typescript | 6.0.3 | Langage | Partout | `tsconfig*.json` | Idem — 7.x refusé par typescript-eslint |
| @types/node | 22.20.5 | Types Node | API, scripts | racine | Idem |
| eslint | 10.12.0 | Lint | `pnpm lint` | `eslint.config.mjs` | Idem |
| typescript-eslint | 8.71.1 | Règles TypeScript | `pnpm lint` | `eslint.config.mjs` | Idem |
| @next/eslint-plugin-next | 16.4.2 | Règles Next.js | `pnpm lint` | `eslint.config.mjs` | Idem — à la place de `eslint-config-next` (même famille, importable directement) |
| prettier | 3.9.9 | Mise en forme | `pnpm lint`, `pnpm format` | `.prettierrc.json`, `.prettierignore` | Idem |
| vitest | 5.0.3 | Tests unitaires et d'intégration | `pnpm test`, `pnpm test:integration` | `apps/api/vitest*.config.ts` | Idem |
| zod | 4.6.5 | Schémas partagés, configuration | Validation | `packages/shared/src`, `apps/api/src/config.ts` | Idem |
| fastify | 5.12.7 | API | Serveur HTTP | `apps/api/src/app.ts` | Idem |
| fastify-type-provider-zod | 7.0.0 | Validation Zod dans Fastify, OpenAPI | Routes | `apps/api/src/app.ts` | Idem |
| @fastify/swagger | 9.9.1 | OpenAPI généré | `/api/v1/openapi.json` | `apps/api/src/app.ts` | Idem |
| drizzle-orm | 0.45.3 | Accès base | Requêtes, migrations en test | `apps/api/src/db`, `test/integration` | Idem |
| drizzle-kit | 0.31.11 | Migrations versionnées | `db:migrate`, `db:generate`, `db:check` | `apps/api/drizzle.config.ts`, `apps/api/drizzle/` | Idem |
| pg + @types/pg | 8.23.1 | Pilote PostgreSQL | Drizzle, pg-boss, tests | `apps/api/src/db/client.ts` | Idem |
| pg-boss | 12.37.0 | Tâches de fond | Démarré avec l'API (aucune tâche encore) ; crée son propre schéma `pgboss` hors des migrations Drizzle (modèle de données : « on ne les modélise pas ») | `apps/api/src/jobs/boss.ts` | Idem |
| argon2 | 0.45.1 | Hachage des mots de passe (argon2id, 19 Mio, 2 passes) | Inscription, connexion, réinitialisation | `apps/api/src/lib/passwords.ts` ; script d'installation autorisé (`pnpm.onlyBuiltDependencies`) | Responsable, 22/10/2026 |
| sharp | 0.35.5 | Ré-encodage des images en WebP (1 200 px, sans métadonnées) | Image d'événement | `apps/api/src/modules/media/images.ts` ; script d'installation autorisé | Responsable, 22/10/2026 |
| tsx | 4.23.15 | Exécution TypeScript en développement | `pnpm dev:api`, drizzle-kit | `apps/api/package.json` | Idem |
| next | 16.4.2 | Interface web | Rendu serveur | `apps/web` | Idem |
| react, react-dom (+ @types) | 19.3.0 | Interface web | Composants | `apps/web/src` | Idem |
| Image `postgres:17-alpine` | 17 | Base locale et CI | `docker-compose.yml`, CI | | Idem |
| Image `axllent/mailpit` | v1.31.4 | Boîte email de test | `docker-compose.yml` | | Idem |

Télémétrie de Next.js coupée par le `postinstall` de la racine (`next telemetry disable`) et en CI (`NEXT_TELEMETRY_DISABLED=1`).

## Prévues par la conception (accord à demander en PC-0a ou à la tranche indiquée)
| Paquet ou outil | Rôle | Source | Tranche |
|---|---|---|---|
| pnpm (via corepack) | Monorepo | Instructions générales | 0 |
| TypeScript | Langage | Instructions générales | 0 |
| Next.js (+ React) | Interface web | Conception §3.1 | 0 |
| Fastify | API | Conception §3.2 | 0 |
| Zod | Schémas partagés | Conception §3.2 | 0 |
| Génération OpenAPI depuis Zod | Documentation d'API | Conception §3.2, §6.1 — bibliothèque à proposer | 0 |
| Drizzle ORM (+ pilote PostgreSQL, outil de migration) | Accès base | Conception §3.3 | 0 |
| pg-boss | Tâches de fond | Conception §3.4 | 0 |
| PostgreSQL (image Docker) | Base | Conception §3.3 | 0 |
| Mailpit (image Docker) | Boîte email de test | Conception §3.11 | 0 |
| Outils de test unitaire/intégration, de parcours, de lint | Vérification | Non nommés par les sources — à proposer | 0 |
| Bibliothèque Ed25519 en JavaScript | Signature et vérification QR | Conception §3.6, §3.7 — à proposer | 1 |
| qr-scanner | Lecture du QR | Conception §3.7 | 1 |
| Génération de QR code | Image du QR | À proposer | 1 |
| argon2 (argon2id) | Mots de passe | Conception §3.5 | 2 |
| Bibliothèque d'images (ré-encodage WebP) | Images | Conception §3.8 — à proposer | 3 |
| Bibliothèque PDF | Billet PDF | Conception §3.9 — à proposer | 7 |
| Bibliothèque TOTP (ou implémentation RFC 6238) | Double authentification | Conception §3.5 — à proposer | 14 |
| Passerelle SMS Android open source | Essai SMS réel en développement | Conception §3.11 — à choisir | 8 |
