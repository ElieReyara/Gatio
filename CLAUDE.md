# Instructions communes — Gatio

Ce fichier est lu en premier par tout agent. En cas de conflit avec un
comportement par défaut, ce fichier prime.

Gatio : billetterie web pour le Tchad (FCFA). Des organisateurs vendent des
billets ; des acheteurs paient sans inscription (Mobile Money d'abord) ;
l'entrée se contrôle par scan de QR code, avec ou sans réseau.
Responsable du projet : Elie REYARA (désigné « le responsable » ci-dessous).

Les mentions « à confirmer » attendent une réponse du responsable ; tant
qu'elles sont ouvertes, appliquer la valeur proposée si elle est indiquée.

## 1. Périmètre de travail
- Zone de travail (modifiable) : la racine du dépôt **sauf** `docs_business/`,
  c'est-à-dire `apps/`, `packages/`, `docs_ia/`, les fichiers de configuration
  à la racine (`package.json`, `pnpm-workspace.yaml`, `docker-compose.yml`,
  `.env.example`, configuration de lint et de tests, CI).
  Arborescence du code (conception §7, noms proposés, à créer en tranche 0) :
  `apps/web` (Next.js), `apps/api` (Fastify), `packages/shared` (schémas Zod
  partagés, textes de l'interface, types).
- Zones en lecture seule : `docs_business/` en entier (cahier des charges,
  conception, maquettes, système de design).
  Seule exception : le journal de bord
  `docs_business/Gatio Project/Gatio-Conception/05-journal-conception.md`,
  en **ajout seul** (rubrique 7).
- Lecture libre de tout le dépôt pour comprendre les contrats.
- Problème détecté hors périmètre : NE PAS le corriger. Le signaler (fichier,
  ligne, nature du problème) dans le journal et le dossier de contrôle.
- Exception : autorisation explicite et ponctuelle du responsable pour une
  tâche précise, tracée selon la rubrique 10.

## 2. Stack réelle
Sources : instructions générales, cahier de conception §2, §3 et §7.
Versions fixées en tranche 0 (détail dans `docs_ia/dependances.md`) : Node 22,
pnpm 10.34.6, TypeScript 6.0.3, Next.js 16.4.2 + React 19.3.0, Fastify 5.12.7,
Zod 4.6.5, Drizzle ORM 0.45.3, pg-boss 12.37.0, PostgreSQL 17, Vitest 5.0.3.
Règle pour une nouvelle version : publiée depuis au moins 2 semaines, sauf correctif de sécurité
(Next.js 16.4.2 et Fastify 5.12.7, 22/10/2026). Audit `pnpm audit --prod` dans la CI.

| Couche | Technologie et version |
|---|---|
| Langage | TypeScript partout. Node.js 22 installé sur le poste (v22.19.0) — version cible à confirmer |
| Interface | Next.js, rendu côté serveur (aperçu de partage), **interface seulement**, aucune logique métier ni accès à la base. Page de scan : PWA (service worker + IndexedDB), lecture QR `qr-scanner`, vérification Ed25519 par bibliothèque JS (pas l'API du navigateur) |
| Serveur | Fastify + schémas Zod (partagés avec le web) + OpenAPI généré. Monolithe modulaire : identité, événements, commandes, paiements, billets, scan, versements, administration |
| Données | PostgreSQL ; accès Drizzle ORM ; migrations versionnées |
| Tâches de fond | pg-boss (dans PostgreSQL), exécuté dans le processus de l'API. Pas de Redis |
| Authentification | Organisateur, admin, support : email + mot de passe argon2id, session opaque hachée (cookie `HttpOnly`/`Secure`/`SameSite=Lax` ou `Authorization`). Acheteur : code SMS, session 90 jours glissants, jeton de commande. Contrôleur : lien d'invitation → session de scan. Admin : TOTP (RFC 6238) obligatoire en production |
| QR code | Signature Ed25519, 50 octets + 64 de signature, base64url, aucune donnée personnelle |
| Paiements, versements, messages, email, images | Derrière des ports (adaptateurs) ; faux adaptateurs en dev/test (faux prestataire, faux versement, passerelle Android ou console, Mailpit, disque). Prestataires réels : non choisis (tranche 16) |
| Documents | PDF du billet généré à la demande, non stocké ; images ré-encodées en WebP (1200 px, 5 Mo max). Bibliothèques : à proposer en tranche 7 et 3 |
| Exécution | Monorepo pnpm (via corepack), conteneurs Docker, configuration par variables d'environnement |
| Hébergement, domaine, stockage S3 de production | À confirmer (journal de bord n° 42, avant tranche 17) |

Rôles utilisateurs (`user_role`) : `organizer`, `admin`, `support`. Acheteurs
(table `buyers`, sans mot de passe) et contrôleurs (sessions de scan, sans
compte) n'ont pas de compte utilisateur.
Rôles métier : acheteur, organisateur, contrôleur, administrateur, support
(au lancement, le support est tenu par l'administrateur).
Accès API : `public` · `commande` · `acheteur` · `organisateur` · `staff`
(admin ou support) · `admin` · `scan` · `prestataire`.

## 3. Contrat d'API
Référence : `docs_business/Gatio Project/Gatio-Conception/02-cahier-de-conception.md`
§6 (routes, accès, comportements, codes d'erreur). Le modèle de données
(`03-modele-de-donnees.md`) fixe tables, contraintes et états. L'OpenAPI
généré depuis les schémas fait foi pour les champs exacts une fois écrit.
Ce qui est réellement implémenté est tenu dans `docs_ia/reference-api.md`.

| Groupe de routes (`/api/v1`) | Écrans concernés | Accès |
|---|---|---|
| `/events`, `/events/{slug}` | B1, B2 | public |
| `/orders`, `/orders/{id}`, `/payments`, `/tickets/{id}/pdf` | B3, B4, B5, B8, P1 | public, commande |
| `/email-verifications/confirm` | B9, E1, E2 | public |
| `/webhooks/payments/{provider}` | — | prestataire |
| `/auth/buyer/otp/*`, `/me/tickets` | B6, B7, M1 | public (limité), acheteur |
| `/auth/register`, `/auth/login`, `/auth/password/*` | O1, E3 | public (limité) |
| `/organizer/profile`, `/organizer/payout-account` | O2 | organisateur |
| `/organizer/events*`, `/categories`, `/fee-preview`, `publish`, `postpone`, `cancel` | O3, O4, O5 | organisateur |
| `/organizer/events/{id}/stats`, `buyers.csv` | O6 | organisateur |
| `/organizer/.../scanner-invites`, `scanners`, `gates`, `scanner-session`, `entry-report` | O7, O8 | organisateur |
| `/organizer/payouts` | O9 | organisateur |
| `/scan/*` | C1, C2 | public (lien valide), scan |
| `/auth/login/mfa`, `/auth/mfa/*` | A1 | public (limité), avec challenge |
| `/admin/*` | A2 à A6 | staff ou admin |
| `/support/*` | A7 | staff |

Format d'erreur commun : statut HTTP + `{ "error": { "code", "message", "details" } }`.
`Idempotency-Key` obligatoire sur `POST /orders` et `POST /orders/{id}/payments`.
L'implémentation s'y conforme. Tout écart se signale, il ne se corrige pas en
silence.

## 4. Conventions de code
- Commentaires seulement quand le POURQUOI n'est pas évident.
- Nommage :
  - Code, tables, colonnes, routes, codes d'erreur : **anglais** ; documents
    et interface : **français**.
  - Tables et colonnes en `snake_case`, tables au pluriel (modèle de données).
  - Routes en minuscules avec tirets (`/scanner-invites`), préfixe `/api/v1`.
  - Champs JSON en `camelCase` (`eventSlug`, `reservationExpiresAt`).
  - Codes d'erreur en `UPPER_SNAKE_CASE` (liste du cahier de conception §6.1).
  - Fichiers TypeScript en `kebab-case`, composants React en `PascalCase` :
    proposé, à confirmer.
- Valider toute entrée aux frontières du système (API, webhooks, scan) avec
  les schémas Zod partagés.
- Requêtes à la base toujours paramétrées. Aucun secret dans le code ni dans
  les prompts.
- Aucune nouvelle dépendance sans accord explicite.
- Règles du projet (instructions générales, à ne jamais contourner) :
  - Argent : montants entiers `bigint` (FCFA sans décimales) avec `currency`
    (`XAF`), jamais de flottant ; pourcentages en points de base ; trois
    montants par ligne (prix, frais, reversé), figés à la commande.
  - Frais : règles en base (`fee_rules`), jamais en dur. Arrondi au plus
    proche, 0,5 vers le haut.
  - Un billet n'existe qu'après confirmation du paiement par le prestataire.
  - Stock : uniquement par `UPDATE` atomique conditionnel (jamais lire puis
    écrire), conditions de vente R12 comprises.
  - Idempotence : notifications de paiement, tâches de fond, envois,
    synchronisations de scan rejouables sans effet double.
  - Services externes derrière un port avec un faux adaptateur.
  - Jetons : 256 bits aléatoires, stockés hachés (SHA-256). Le QR ne contient
    aucune donnée personnelle.
  - Journaux sans téléphone ni email en clair (téléphones masqués).
  - Description d'événement en texte brut ; export CSV protégé contre
    l'injection de formules ; appartenance vérifiée dans chaque route.
  - Migrations versionnées, jamais de modification manuelle de la base.
  - Règles d'argent, de stock, de signature QR et de scan toujours testées.
- Interface (système de design « Savane », `docs_business/Gatio Project/Gatio design/systeme-de-design/`) :
  - Jetons de `tokens.json` uniquement (couleurs, typo, espacements, rayons),
    police système, aucune police téléchargée.
  - Tous les textes dans un seul fichier de textes ; vouvoiement ; « billet »
    jamais « ticket » ; dates en toutes lettres ; « 15 000 FCFA » avec espace
    insécable.
  - Mobile d'abord (≈ 360 px), pages légères, un seul bouton plein par écran,
    zones tactiles de 48 px, champs à 16 px minimum, focus visible.
  - Couleurs de scan (vert/orange/rouge) réservées à leur sens, toujours avec
    icône + mot + son.
  - L'interface suit les maquettes validées. **Écran sans maquette : demander,
    ne pas inventer.**

## 5. Règles de travail
1. Récupérer la dernière version du code avant de commencer (`git pull` dès
   qu'un dépôt distant existe ; à défaut, `git status`).
2. Lire le registre d'erreurs (`docs_ia/registre-erreurs.md`) avant chaque tranche.
3. Suivre le suivi d'avancement (`docs_ia/suivi-avancement.md`) et le tenir à
   jour en permanence.
4. Écrire un micro-plan dans le journal puis l'exécuter, sans attendre.
5. Aucune donnée inventée ; pas de données factices dans le code sauf demande
   (exception prévue par la roadmap : la liste fictive du prototype de
   tranche 1, et les données de test).
6. Ne créer que les fichiers nécessaires.
7. Mettre à jour les documents vivants selon la rubrique 8.
8. Signaler tout écart entre sources et code.
9. Toute hypothèse prise seul est notée dans le journal de bord ; « à
   confirmer » seulement si elle est importante.
10. Journaliser chaque session (rubrique 7).
11. Une tranche à la fois, dans l'ordre du plan unifié ; ne donner à l'IA que
    la tranche en cours (conception §7).

## 6. Suivi de version
- Dépôt local créé le 19/10/2026. Dépôt distant `origin` :
  https://github.com/ElieReyara/Gatio.git (**public** pour l'instant, privé plus tard).
- Branche de travail : `dev`. Branche protégée : `main`, jamais touchée par
  l'agent (le responsable la crée et y fusionne).
- Enregistrer le travail sur la branche de travail à chaque tranche clôturée,
  avec un message clair (`tranche N : <capacité livrée>`).
- Envoi vers le dépôt distant : uniquement `dev`, jamais de force. Le premier
  envoi attend l'accord du responsable (PC-0b : dépôt public, quels dossiers
  publier). Ensuite : envoi de `dev` à chaque tranche clôturée, si le
  responsable l'a confirmé en PC-0b.
- Ne jamais enregistrer de secret ni de fichier `.env` (voir `.gitignore`).

## 7. Journal de session
Un fichier par jour dans `docs_ia/journal/AAAA-MM-JJ.md`, limité à 800 lignes
(fichier de suite `AAAA-MM-JJ-2.md` au-delà). Contenu :
- Contexte : objectif, tranche(s) visée(s)
- Micro-plan
- Changements : nature (création / modification / correction / refactor),
  fichier, quoi, pourquoi
- État après session : ce qui fonctionne, ce qui reste
- Signalements : hors périmètre ou écarts sources/code
- Points « à confirmer » et questions en attente
- Problèmes rencontrés
- Agent auteur (si plusieurs agents)

Journal de bord (document de projet, ajout seul) :
`docs_business/Gatio Project/Gatio-Conception/05-journal-conception.md`.
Prochain numéro : **61**. Toute décision, tout problème ou changement de
direction qui engage le projet y est ajouté, dans une section ajoutée en fin
de fichier « Entrées de l'implémentation » : tableau (N°, date, sujet,
contexte et problème, décision ou solution, suite, statut Ouvert / Décidé /
Résolu) suivi d'un récit daté. Le tableau existant (sans colonne date) n'est
jamais modifié. Ne jamais réécrire l'historique : seuls Statut et Suite d'une
entrée existante se mettent à jour. Une décision prise seul est inscrite
« Décidé » ; « à confirmer » dans Suite seulement si elle est importante. Ne
jamais passer une entrée à « Résolu » seul si elle modifie une source :
proposer, puis attendre la validation du responsable.

## 8. Documents et correspondance
Sources (lecture seule sans accord), dossier `docs_business/` :
- `Cahier des charges — Plateforme de billetterie en ligne.pdf` (en cas de doute seulement)
- `Gatio Project/Gatio-Conception/01-instructions-generales.md`
- `Gatio Project/Gatio-Conception/02-cahier-de-conception.md` (architecture, règles R1–R37, sécurité S1–S10, contrat d'API §6)
- `Gatio Project/Gatio-Conception/03-modele-de-donnees.md`
- `Gatio Project/Gatio-Conception/04-roadmap.md` (feuille de route technique)
- `Gatio Project/Gatio-Conception/05-journal-conception.md` (journal de bord, ajout seul)
- `Gatio Project/Gatio-Conception/06-dossier-de-revue.md`
- `Gatio Project/Gatio-Conception/07-elements-a-fournir-design-et-contenus.md` (écrans, contenus, lots de design)
- `Gatio Project/Gatio design/maquettes/*.dc.html` + `canvas.json` (maquettes validées)
- `Gatio Project/Gatio design/systeme-de-design/` (jetons, composants, ton)

Vivants (à tenir à jour), dossier `docs_ia/` :
```
docs_ia/
├── plan-unifie.md            plan fonctionnalité par fonctionnalité (tranches 0–18)
├── suivi-avancement.md       une ligne par tranche : priorité, dépendances, critère, statut
├── etat-fonctionnalites.md   ce qui marche réellement, par fonctionnalité
├── reference-api.md          routes réellement implémentées et écarts au contrat
├── registre-erreurs.md       ID · date · contexte · message · cause · solution · prévention
├── retour-experience.md      leçons de méthode pour les prochains projets (design, conception, essais)
├── dependances.md            dépendances : rôle, usage, fichiers, accord
├── journal/AAAA-MM-JJ.md     journaux de session
├── controle/                 dossiers de contrôle et rapports de revue (un fichier par arrêt)
├── exceptions/               modifications hors périmètre autorisées (créé au besoin)
└── dette-technique.md        créé à la première dette constatée
```

| Changement effectué | Document à mettre à jour |
|---|---|
| Nouveau point d'échange | `docs_ia/reference-api.md` |
| Nouvelle entité ou champ | Migration + proposition de mise à jour du modèle de données (source) dans le journal de bord et le dossier de contrôle |
| Erreur rencontrée | `docs_ia/registre-erreurs.md` |
| Problème de méthode (planche manquante, règle absente, grille ambiguë…) | `docs_ia/retour-experience.md` (demande du responsable, 22/10/2026) |
| Fonctionnalité terminée | `docs_ia/etat-fonctionnalites.md` + `docs_ia/suivi-avancement.md` |
| Dépendance ajoutée | `docs_ia/dependances.md` (rôle, usage, fichiers) |
| Changement d'architecture | Proposition de mise à jour du cahier de conception (source) dans le journal de bord et le dossier de contrôle |
| Écart maquette / conception | Journal de session + dossier de contrôle |

## 9. Commandes utiles
Prérequis du poste : Node.js 22.12 ou plus, corepack (fournit pnpm 10.34.6,
fixé dans `package.json` ; pnpm 12 n'est pas lancé par corepack 0.34), Docker
Desktop **démarré**. Ports utilisés : web 3000, API 4000, PostgreSQL 5432,
Mailpit 8025 (interface) et 1025 (SMTP). Copier `.env.example` en `.env` est
facultatif en développement (valeurs locales par défaut), obligatoire en production.

**Poste à mémoire limitée** (8 Go de RAM, environ 1 Go libre, Docker limité à
environ 4 Go) :
- Docker ne fait tourner que PostgreSQL (`postgres:17-alpine`, déjà présent
  sur le poste) et Mailpit, avec des limites de mémoire. Le web et l'API
  tournent directement sous Node, pas en conteneur, pendant le développement.
  Les images Docker de l'application ne sont construites qu'aux tranches 17 et 18.
- Un seul serveur de développement à la fois quand c'est possible (`pnpm dev:api`
  ou `pnpm dev:web`) ; arrêter ce qui ne sert pas.
- Tests : nombre de processus de test limité (2 au plus) ; parcours
  navigateur avec Chromium seulement, à partir de la tranche 5.
- Arrêter les conteneurs inutiles d'autres projets avant une session longue.
- Sous-agents : un seul à la fois.

Commandes (vérifiées le 21/10/2026, tranche 0) :
| But | Commande |
|---|---|
| Activer pnpm | `corepack enable` |
| Installer (compile aussi `packages/shared`) | `pnpm install` |
| **Tout lancer en une commande** (services Docker, migrations, API, web) | `pnpm dev` → http://localhost:3000 |
| Lancer l'API seule / le web seul | `pnpm dev:api` · `pnpm dev:web` |
| Services locaux seuls (PostgreSQL, Mailpit) | `pnpm services` |
| Arrêter les services locaux | `docker compose stop` |
| Migrations | `pnpm db:migrate` · nouvelle migration : `pnpm --filter @gatio/api db:generate` · cohérence : `pnpm --filter @gatio/api db:check` |
| Build | `pnpm build` |
| Types | `pnpm typecheck` |
| Lint et formatage | `pnpm lint` (ESLint + Prettier) · corriger : `pnpm format` |
| Tests unitaires | `pnpm test` (Vitest) |
| Tests d'intégration (vraie base `gatio_test`, créée et migrée automatiquement) | `pnpm test:integration` |
| Parcours complets | à créer en tranche 5 (Playwright, accord à demander) |
| **Vérification complète** | `pnpm verify` (typecheck + lint + test + test:integration + build) |
| Clé de signature des QR (à mettre dans `.env`) | `pnpm --filter @gatio/api keys:generate` |
| Site en mode production local (essai du scan hors ligne) | `pnpm start:web` (exige un `.env` avec `API_URL`) + `pnpm dev:api` |
| Tunnel HTTPS pour un téléphone (accord du responsable, le temps de l'essai) | `cloudflared tunnel --url http://127.0.0.1:3000` |
| Page de scan / billets d'essai (prototype, tranche 1) | http://localhost:3000/scan · http://localhost:3000/dev/billets-essai |
| Documentation OpenAPI | http://localhost:4000/api/v1/openapi.json |
| Emails de test | http://localhost:8025 |

Bon à savoir (test à froid du 21/10/2026) :
- **Cloner dans un chemin court** (par exemple `C:\dev\gatio`) : au-delà de 260
  caractères, Windows casse Vitest (`ERR_PACKAGE_IMPORT_NOT_DEFINED
  "#module-evaluator"`, registre ERR-002).
- L'avertissement `Ignored build scripts: esbuild…` de `pnpm install` est sans
  effet : ne pas lancer `pnpm approve-builds`.
- Arrêter `pnpm dev` : Ctrl+C dans son terminal, puis `docker compose stop`.
- Au quotidien, préférer `pnpm dev:api` ou `pnpm dev:web` (mémoire) ; `pnpm dev`
  sert à vérifier le tout.
- `pnpm verify` demande les services lancés (`pnpm services`) pour les tests
  d'intégration ; durée environ 1 min 30 sur un clone propre.
- Port déjà pris : API par `API_PORT` dans `.env` ; base et Mailpit dans
  `docker-compose.yml`. En développement l'API n'écoute que sur `127.0.0.1`.

Outils retenus (accord PC-0a du 21/10/2026) : Vitest, ESLint + typescript-eslint
+ règles Next.js, Prettier. Versions : `docs_ia/dependances.md`.

## 10. Exceptions tracées
Si une modification hors périmètre est autorisée : l'indiquer dans le journal
et créer une entrée dans `docs_ia/exceptions/AAAA-MM-JJ-sujet.md` : contexte,
fichiers modifiés (quoi, pourquoi), « validé par [qui, date] ».

## 11. Autonomie, boucle d'exécution et arrêts
Boucle, sans jamais demander s'il faut continuer : choisir la prochaine
tranche (à faire, dépendances terminées, priorité ; à défaut l'ordre
numérique) → préparer (registre d'erreurs, maquettes de la tranche) →
micro-plan puis exécution immédiate → implémenter + tests → vérifier
(`pnpm verify`, critère de terminé, revue isolée) → corriger → clôturer
(documents, journal, enregistrement) → aiguiller (suivante, ou dossier de
contrôle puis tranches indépendantes).
Maximum 3 tentatives différentes sur un même problème, puis « bloquée ».

Arrêt UNIQUEMENT pour : point de contrôle prévu au suivi · sources
insuffisantes ou contradictoires (dont : écran sans maquette) · décision
structurante difficile à défaire · sécurité, données personnelles, paiement ·
modification hors périmètre · problème qui bloque tout · envoi vers
l'extérieur · nouvelle dépendance · fin du plan.
Tout le reste : option la plus simple et réversible, notée au journal,
et on continue (« à confirmer » seulement si c'est important). Questions non
bloquantes : dans une liste.

À chaque arrêt, produire le dossier de contrôle dans
`docs_ia/controle/AAAA-MM-JJ-tranche-N.md` : ce qui est prêt · comment le
valider (étapes concrètes) · résultats des vérifications · décisions à prendre
avec recommandation · « à confirmer » cumulés · signalements · ce qui continue
pendant l'attente · ce qui est attendu du responsable.

## 12. Configuration d'exécution (une ligne par axe, à mettre à jour)
Choisie par l'agent avec l'accord du responsable (19/10/2026, journal de bord n° 58).
- Agents : un agent principal (Claude Code) avec sous-agents ponctuels, un seul à la fois (mémoire du poste).
- Qui lance les autres agents : l'agent principal décide.
- Répartition : par tranche (une tranche à la fois, l'agent principal code).
- Fréquence des contrôles humains : aux points de contrôle du suivi d'avancement.
- Revue isolée : sous-agent neuf à chaque clôture de tranche.
- Envoi vers l'extérieur : `git push` de `dev` selon la rubrique 6 ; tout le
  reste (déploiement, vrais SMS, emails, paiements) sur ordre explicite.
- Continuité : reprises par prompt ; l'état se relit dans le suivi et le journal.
- Rédaction de la documentation : agent codeur.
- Test à froid : sous-agent neuf (clone propre du dépôt, en tranche 0 et 17) ;
  tests sur vrais téléphones : le responsable.
