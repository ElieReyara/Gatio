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
| POST `/auth/register` | public (limité : 10/h par IP) | 2 | `registerRequestSchema` (email, mot de passe ≥ 8, **displayName**) → 201 profil + cookie de session | `identity.test.ts` | `displayName` ajouté (décision Q2, journal de bord n° 63) ; email déjà pris → 400 `VALIDATION_ERROR` `details.reason = already_registered` |
| POST `/auth/login` | public (limité : 10 par email, 30 par IP / 15 min) | 2 | `loginRequestSchema` → 200 profil + cookie ; 401 `UNAUTHENTICATED` identique pour email inconnu | idem | Organisateurs seulement jusqu'à la tranche 14 (`MFA_REQUIRED` des comptes internes non construit) |
| POST `/auth/logout` | organisateur | 2 | → 204, session révoquée, cookie effacé | idem | — |
| POST `/auth/password/forgot` | public (limité : 3 par email, 20 par IP / h) | 2 | `{email}` → 202 `{}` toujours ; recherche et envoi après la réponse | idem | — |
| POST `/auth/password/reset` | public (limité : 20 par IP / h) | 2 | `{token, newPassword}` → 200 ; ferme toutes les sessions et les autres liens ; 400 `TOKEN_INVALID` | idem | — |
| PUT `/organizer/profile` | organisateur | 3 | `profileUpdateSchema` (nom affiché, description, téléphone +235) → profil | `organizer.test.ts` | — |
| PUT `/organizer/payout-account` | organisateur | 3 | `payoutAccountSchema` (`airtel_money`/`moov_money`, numéro +235) → profil, numéro **masqué** | idem | Deux moyens à l'écran comme la maquette O2 (un seul adaptateur réel en tranche 16) |
| POST `/organizer/fee-preview` | organisateur | 3 | `{price, eventId?}` → `feePreviewSchema` (R2, R7) | idem | Sans `categoryId` (dette D10) |
| POST/GET `/organizer/events` | organisateur | 3 | Création (brouillon, slug de 8 caractères) ; liste `{items, nextCursor}` (`?cursor=&limit=`) | idem | — |
| GET/PATCH `/organizer/events/{id}` | organisateur | 3, 4 | Détail avec catégories et frais ; modification (capacité ≥ billets prévus, périodes de vente revérifiées si la date change ; date d'un événement publié : `postpone_required` ; événement annulé : `event_cancelled`) | idem | Autre organisateur → 404 `NOT_FOUND` |
| POST `/organizer/events/{id}/image` | organisateur | 3 | Corps brut `image/jpeg`, `image/png` ou `image/webp`, 5 Mo → WebP 1 200 px | idem | **Corps brut au lieu de multipart** (aucune dépendance de plus) ; autre type → 415 |
| POST `/organizer/events/{id}/categories` | organisateur | 3 | `categoryCreateSchema` → catégorie avec frais ; R3 `PRICE_TOO_LOW`, R11 capacité, R12 période | idem | — |
| PATCH/DELETE `/organizer/categories/{id}` | organisateur | 3 | Modification (quantité ≥ vendus + réservés, condition dans l'UPDATE) ; DELETE = archivage | idem | — |
| GET `/events` | public | 4 | `publicEventQuerySchema` (city, type, from, to, q, cursor, limit) → publiés à venir, organisateur actif, `minPriceAmount` des catégories en vente | `public.test.ts` | — |
| GET `/events/{slug}` | public | 4 | `publicEventSchema` : statut, nom de l'organisateur, catégories avec `availability` | idem | Hors `published` (reporté, annulé), toutes les catégories valent `ended` (le contrat n'a pas de valeur « arrêtée ») ; brouillon, suspendu ou organisateur suspendu → 404 |
| POST `/organizer/events/{id}/publish`, `/unpublish`, `/postpone`, `/cancel` | organisateur | 4 | → détail de l'événement ; `invalid_status`, `payout_account_missing`, `no_active_category`, `not_in_future` | idem | Report et annulation (et republication, changement de date pendant un report) tracés dans `audit_log` |
| POST `/organizer/categories/{id}/restore` | organisateur | 4 | Remet en vente une catégorie archivée ; capacité revérifiée (`capacity_exceeded`) | `public.test.ts` | **Ajout au contrat** (décision du responsable, PC-4) |
| GET `/media/{clé}` | public | 3 | Image WebP, cache d'un an, `nosniff` | idem | Ajout : sert les images du stockage disque (S3 en production) |
| GET `/organizer/profile` | organisateur | 2 | `organizerProfileSchema` (email, displayName, description, contactPhone) | idem | PUT reporté en tranche 3 avec l'écran O2 (journal de bord n° 63) |
| GET `/openapi.json` | public | 0 | Document OpenAPI généré depuis les schémas Zod (routes cachées exclues) | `apps/api/src/app.test.ts` | Ajout : le contrat (§6.1) demande la documentation générée sans fixer son adresse |

## Codes d'erreur implémentés
| Code | Statut HTTP | Routes |
|---|---|---|
| `VALIDATION_ERROR` | 400, et autres 4xx levés par Fastify (413, 415…) | toutes |
| `UNAUTHENTICATED` / `FORBIDDEN` / `RATE_LIMITED` | 401 / 403 / 429 (par correspondance de statut) | toutes |
| `NOT_FOUND` | 404 | toute adresse inconnue |
| `TOKEN_INVALID` | 400 | `/auth/password/reset` |
| `PRICE_TOO_LOW` | 400 | création et modification de catégorie |
| `FORBIDDEN` | 403 | toute modification d'une origine non autorisée (S2) |
| `INTERNAL_ERROR` | 500 | toutes (message générique, détail seulement dans les journaux masqués) |

Format : `{ "error": { "code", "message", "details" } }` (§6.1), schéma `errorResponseSchema` dans `packages/shared/src/errors.ts`.

## Écarts au contrat
Tout écart est signalé au journal et au dossier de contrôle avant d'être conservé.

| Date | Route | Écart | Raison | Validé par |
|---|---|---|---|---|
| 21/10/2026 | toutes | Code `INTERNAL_ERROR` ajouté (absent de la liste §6.1, qui ne donne que les « codes principaux ») | Une erreur 500 doit avoir un code du format commun | Responsable, 22/10/2026 (journal de bord n° 61) |
