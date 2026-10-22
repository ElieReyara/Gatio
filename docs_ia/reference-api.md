# Référence d'API implémentée — Gatio

Contrat de référence : `docs_business/Gatio Project/Gatio-Conception/02-cahier-de-conception.md` §6.
Ce document ne liste que ce qui est **réellement implémenté et testé**. Base : `/api/v1`.

## Routes implémentées
| Méthode et route | Accès | Tranche | Schéma (fichier) | Tests | Écart au contrat |
|---|---|---|---|---|---|
| GET `/health` | public | 0 | `packages/shared/src/health.ts` (`{ status: ok\|degraded, database: ok\|unavailable }`) ; 503 si la base est injoignable | `apps/api/src/app.test.ts`, `test/integration/health.test.ts` | Contrat : « santé du service » sans format : format choisi ici |
| GET `/dev/scan-prototype/manifest` | public (développement seulement) | 1 | `scanManifestSchema` (`packages/shared/src/scan.ts`) : liste fictive | `scan-prototype/routes.test.ts` | Temporaire : remplacée par GET `/scan/manifest` (accès scan) en tranche 10 ; absente en production |
| GET `/dev/scan-prototype/samples` | public (développement seulement) | 1 | 7 billets d'essai signés | idem | Temporaire (outil d'essai) |
| POST `/dev/scan-prototype/tickets` | public (développement seulement) | 1 | Billet « vendu après le téléchargement » | idem | Temporaire (outil d'essai) |
| GET `/openapi.json` | public | 0 | Document OpenAPI généré depuis les schémas Zod (routes cachées exclues) | `apps/api/src/app.test.ts` | Ajout : le contrat (§6.1) demande la documentation générée sans fixer son adresse |

## Codes d'erreur implémentés
| Code | Statut HTTP | Routes |
|---|---|---|
| `VALIDATION_ERROR` | 400, et autres 4xx levés par Fastify (413, 415…) | toutes |
| `UNAUTHENTICATED` / `FORBIDDEN` / `RATE_LIMITED` | 401 / 403 / 429 (par correspondance de statut) | toutes |
| `NOT_FOUND` | 404 | toute adresse inconnue |
| `INTERNAL_ERROR` | 500 | toutes (message générique, détail seulement dans les journaux masqués) |

Format : `{ "error": { "code", "message", "details" } }` (§6.1), schéma `errorResponseSchema` dans `packages/shared/src/errors.ts`.

## Écarts au contrat
Tout écart est signalé au journal et au dossier de contrôle avant d'être conservé.

| Date | Route | Écart | Raison | Validé par |
|---|---|---|---|---|
| 21/10/2026 | toutes | Code `INTERNAL_ERROR` ajouté (absent de la liste §6.1, qui ne donne que les « codes principaux ») | Une erreur 500 doit avoir un code du format commun | Responsable, 22/10/2026 (journal de bord n° 61) |
