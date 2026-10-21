# Dossier de contrôle PC-00 — Démarrage de l'implémentation

19/10/2026 · Aucun code écrit. Aucune source modifiée.

## 1. Ce qui est prêt
- `CLAUDE.md` (racine) : instructions communes, rubriques 1 à 12.
- `docs_ia/` : plan unifié, suivi d'avancement, état des fonctionnalités,
  référence d'API (vide), registre d'erreurs (vide), dépendances, journal du
  jour, ce dossier.

## 2. Comment le valider
1. Lire `docs_ia/plan-unifie.md` : une section par tranche (0 à 18), état des maquettes par écran.
2. Lire `docs_ia/suivi-avancement.md` : priorités et points de contrôle.
3. Répondre aux questions de la section 6 (les bloquantes d'abord).
4. Confirmer ou corriger la configuration d'exécution (CLAUDE.md §12).

## 3. Commandes de vérification (exécutées le 19/10/2026)
| Commande | Résultat | Cause |
|---|---|---|
| `pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm verify` | échec : `pnpm: command not found` | pnpm non activé (corepack 0.34 présent) et aucun `package.json` |
| `npm run build` | échec : `Missing script: "build"` | aucun projet |
| `docker compose up -d` | échec : `no configuration file provided` | pas de `docker-compose.yml` ; moteur Docker Desktop arrêté |
| `git status` | échec : `not a git repository` | dépôt non créé |

Outillage constaté : Node 22.19.0, npm 11.12.1, corepack 0.34.0, Docker 28.5.1
+ Compose 2.40.3 (moteur arrêté), git 2.51.0. Absents : pnpm, psql (inutile : base en conteneur), gh.
Ces commandes deviennent exécutables à la tranche 0, qui les crée ; elles y
seront relancées et doivent passer pour clore la tranche.

## 4. Écarts entre les sources
| # | Écart | Sources | Proposition |
|---|---|---|---|
| E1 | B3 ne dessine pas le champ « Confirmez votre numéro » | Maquette B3 vs R30, journal n° 55, 07-B3 | Appliquer la double saisie (décision du journal) ; demander le dessin du champ |
| E2 | Renvoi du billet « par SMS » dans A7 | Maquette A7 vs contrat §6.6 (« par email ») et §3.11 (SMS = codes) | Renvoi par email ; question Q5 si l'acheteur n'a pas d'email |
| E3 | Deux moyens de versement (Airtel, Moov) dans O2 | Maquette O2 vs cahier des charges (« un seul moyen au lancement ») et conception §3.11 | Question Q3 |
| E4 | Reversements regroupés par événement avec une date prévue | Maquettes O9, A5 vs R21 (un versement par commande, envoyé dès la vente) | Suivre R21 ; demander la maquette ajustée |
| E5 | L'inscription ne demande pas le nom affiché, obligatoire dans `organizers` | Maquette O1 vs modèle de données | Question Q2 |
| E6 | « Premier passage à 19 h 42 » demande l'heure d'utilisation, absente du manifeste | Maquette C2 vs contrat §6.5 (`{id, categoryId, status}`) | Ajouter `usedAt` au manifeste et aux changements (changement de contrat, à valider) |
| E7 | Valeurs présentes dans les maquettes mais absentes de la conception : mot de passe ≥ 8 caractères (O1), blocage 15 min après 5 codes faux (A1), pourcentage 0–20 % (A3), numéro Mobile Money à 8 chiffres (O2), délai de renvoi du code (B6) | Maquettes | Adopter les valeurs des maquettes, réglables ; délai de renvoi du code : 60 s proposé, à confirmer |
| E8 | Lien d'invitation court dans O7 (`/c/x9f3k2`) vs jeton de 256 bits (≈ 43 caractères) | Maquette O7 vs instructions générales règle 10 | Jeton de 256 bits ; la maquette est indicative |
| E9 | Numéro débité dans B4 = numéro de la commande, alors que `POST /payments` ne reçoit que `{method}` | Maquette B4 vs contrat §6.2 | Hypothèse : le numéro de contact sert au paiement ; question Q6 |
| E10 | B9 (confirmation d'email) existe en maquette mais pas dans le document 07 | Maquettes vs 07 | Rattaché à la tranche 7 |
| E11 | Pas de document « feuille de route design » distinct | Demande vs dépôt | Utilisé : 07 (écrans par tranche, lots §7) + `canvas.json` + maquettes |
| E12 | Le journal des décisions (entrées 1 à 19) n'est pas dans le dépôt ; le journal de bord n'a pas de colonne date | 05 vs gabarit | Nouvelles entrées dans une section ajoutée en fin de fichier, au format du gabarit (CLAUDE.md §7) |
| E13 | Le dossier de revue annonce les entrées 20 à 54 ; le journal va jusqu'à 57 | 06 vs 05 | Sans effet ; prochain numéro : 58 |
| E14 | « En cas de doute, poser la question » vs « option la plus simple et réversible » | Instructions générales vs gabarit | Arrêt pour les doutes sur les sources ou un écran sans maquette ; option simple pour le reste (CLAUDE.md §11) |
| E15 | Le journal de bord est dans `docs_business/` (lecture seule), le gabarit le place parmi les documents vivants | Gabarit vs dépôt | Laissé en place, sans copie ; seule exception à la lecture seule, en ajout seul (question Q1) |
| E16 | La carte de catégorie (README) prévoit les boutons − / + sur la page événement ; B2 renvoie vers B3 avec « Choisir mes billets » | Composant vs maquettes B2/B3 | Suivre les maquettes B2 et B3 |

## 5. Écrans sans maquette (à fournir avant la tranche indiquée)
| Écran | Tranche |
|---|---|
| Liste « Mes événements » de l'organisateur ; liste des catégories ; modification et archivage d'une catégorie ; modification d'un événement (onglet Infos) | 3 |
| Confirmation de report ; nouvelle date et republication | 4 |
| Champ « Confirmez votre numéro » dans B3 ; B8 : réservation expirée, hors période, trop de commandes en attente, service indisponible (seuls les textes sont listés) | 5 |
| Point d'entrée « scanner moi-même » de l'organisateur | 9 |
| Téléchargement de la liste en cours / première utilisation de C2 | 10 |
| A2 : liste et suspension des événements | 14 |

## 6. Questions
Bloquantes (avant la tranche 0) :
- **Q1** Autorisez-vous l'agent à ajouter des entrées (ajout seul) au journal de bord `05-journal-conception.md`, comme le demande le gabarit ?
- **Q0** Configuration d'exécution et environnement (hébergement, accès, contraintes) : les champs de votre demande étaient vides. Confirmez-vous les valeurs proposées dans CLAUDE.md §12 ?
- **Q7** Nom de la branche de travail (`dev` proposé) ; dépôt distant prévu (GitHub ou autre) ?

Avant la tranche concernée :
- **Q2** (tranche 2) Nom affiché à l'inscription : l'ajouter au formulaire O1, ou le rendre facultatif dans le modèle jusqu'au profil (obligatoire avant publication) ? Recommandation : l'ajouter à O1 (ne change pas le modèle).
- **Q3** (tranche 3) Un ou deux moyens de versement au lancement ? Recommandation : garder les deux choix à l'écran (simple liste), un seul adaptateur réel en tranche 16.
- **Q4** (tranches 3–4) Liste des villes et canal du support.
- **Q5** (tranche 15) Renvoi du billet quand l'acheteur n'a pas donné d'email : SMS (coût) ou lien donné par le support ?
- **Q6** (tranche 6) Le numéro Mobile Money débité peut-il différer du numéro de contact ? Si oui, il faut un champ dans B4 et dans `POST /payments`.
- **Q8** (tranche 7) Adresse d'expédition des emails.
- **Q9** (tranche 10) Valider l'ajout de `usedAt` au manifeste (E6).

## 7. Hypothèses « à confirmer »
- Arborescence `apps/web`, `apps/api`, `packages/shared`.
- Nommage des fichiers : `kebab-case`, composants en `PascalCase`.
- Node.js 22 comme version cible ; dernières versions stables de Next.js, Fastify, Drizzle, pg-boss.
- Valeurs de E7 (dont délai de renvoi du code : 60 s).
- Priorités du suivi, déduites du document 07.

## 8. Points de contrôle proposés
Voir `docs_ia/suivi-avancement.md` (PC-00 à PC-18b, avec raison).

## 9. Ce qui continue pendant l'attente
Rien : la tranche 0 demande d'abord la validation du plan (PC-00) puis
l'accord sur les dépendances (PC-0a).

## 10. Ce qui est attendu du responsable
Valider le plan unifié ; répondre à Q0, Q1, Q7 ; démarrer Docker Desktop
avant la tranche 0 ; fournir progressivement les éléments de la section 5.
