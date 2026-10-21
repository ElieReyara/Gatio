# Dépendances — Gatio

Aucune dépendance sans accord explicite du responsable (CLAUDE.md §4).
Les versions sont fixées à l'installation (tranche 0) et notées ici.

## Installées
| Paquet | Version | Rôle | Usage | Fichiers | Accord (qui, date) |
|---|---|---|---|---|---|

Aucune au 19/10/2026.

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
