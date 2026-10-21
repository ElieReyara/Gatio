# Plan unifié — Gatio

Version 1 · 19/10/2026 · **Validé par le responsable le 19/10/2026.**

Fusion de la feuille de route technique (`04-roadmap.md`, tranches 0 à 18) et
de la feuille de route design (`07-elements-a-fournir-design-et-contenus.md`
§2 à §7, lots 1 à 6, et maquettes de `Gatio design/maquettes/`). Mêmes
identifiants que la roadmap. Chaque tranche est verticale : écran + API + base
+ tests. Aucune fonctionnalité ajoutée.

## Légende
- **Maquette** : ✅ fournie (fichier) · ◐ partielle (états manquants) · ✖ absente → demander avant de coder.
- **Critère de terminé** : celui de la roadmap, plus le critère design commun ci-dessous.
- **PC** : point de contrôle humain (détail et raison dans `suivi-avancement.md`).

### Critère design commun (toute tranche avec écran)
Conforme à la maquette et à ses états (normal, vide, chargement, erreur,
succès) ; jetons de `tokens.json` uniquement ; textes dans le fichier de
textes unique ; lisible à 360 px ; un seul bouton plein par écran ; zones
tactiles 48 px ; focus visible ; contraste conforme aux notes des jetons.

### Correspondance avec les lots de design (07 §7)
| Lot | Contenu | Tranches | État au 19/10/2026 |
|---|---|---|---|
| 1 | Identité visuelle, O1, E3, O2, O3, O4 | 2, 3 | Maquettes fournies ; logo provisoire ; icônes à choisir en tranche 0 |
| 2 | B1, B2, B3, B8, O5, T3, T5, canal du support, villes | 4, 5 | Maquettes fournies (B3 sans double saisie du numéro) ; canal du support et liste des villes **manquants** |
| 3 | B4, B5, T4, P1, E1, E2 | 6, 7 | Fournis ; adresse d'expédition des emails manquante |
| 4 | B6, B7, M1, C1, C2, O7, O8 (+ B9) | 8 à 11 | Fournis |
| 5 | O6, O9, A1 à A7 | 12 à 15 | Fournis (A2 sans la liste des événements) |
| 6 | T1, T2 | 18 | **Manquants** |

---

## 0 — Squelette de bout en bout · Les deux + Ops
- **Back** : monorepo pnpm (`apps/web`, `apps/api`, `packages/shared`), API Fastify avec `GET /api/v1/health`, format d'erreur commun, journalisation sans données personnelles, configuration par variables d'environnement (`.env.example`), connexion PostgreSQL + premier outil de migration (Drizzle), pg-boss branché.
- **Front** : page Next.js qui lit la route de santé.
- **Design** : jetons de `tokens.json` traduits en variables CSS ; fichier de textes unique créé ; choix des 6 icônes (coche, !, croix, billet, téléphone, horloge — README du système de design : « à dessiner ou choisir lors de la tranche 0 ») ; logo provisoire.
- **Ops** : `docker-compose.yml` (PostgreSQL, Mailpit), dépôt git, CI (types, lint, tests, contrôle des migrations), commandes de la rubrique 9 de CLAUDE.md.
- **Maquettes** : aucune requise.
- **Dépend de** : —
- **Terminé quand** : un nouveau poste lance tout en une commande ; la CI passe ; `pnpm verify` vert ; test à froid réussi.
- **PC** : PC-0a (liste des dépendances avant installation), PC-0b (dépôt distant et CI, envoi vers l'extérieur).

## 1 — Prototype : QR signé et scan hors ligne · Les deux
- **Back** : format QR (version, clé, billet, événement, catégorie + signature Ed25519, base64url), génération d'un billet signé avec clé de test, clé publique livrée.
- **Front** : page de scan PWA (service worker, IndexedDB), liste fictive locale, vérification hors ligne, résultat plein écran vert / orange / rouge avec son et vibration, mesure `verifyMs`.
- **Design** : C2 (états 3 à 8 de `C1-C2-controle.dc.html`) ; composant ScanResult.
- **Maquettes** : C2 ✅ (« première utilisation : installer sur l'écran d'accueil » présent seulement comme conseil sur C1).
- **Dépend de** : 0
- **Terminé quand** : sur un iPhone et un Android réels, page chargée une fois, scan en mode avion, dont un QR ajouté après le téléchargement ; densité du QR jugée lisible (sinon plan B). Tests unitaires de signature et de lecture.
- **PC** : PC-1 (essai sur vrais téléphones et lisibilité du QR : seul le responsable peut juger).

## 2 — Compte organisateur et mot de passe oublié · Les deux
- **Back** : `users`, `organizers`, `auth_sessions`, `password_resets`, `rate_limit_counters` ; inscription, connexion, déconnexion, profil ; argon2id ; sessions révocables ; limites ; mot de passe oublié (R36) ; port Email + Mailpit.
- **Front** : O1 (inscription, connexion, erreur, mot de passe oublié, demande envoyée, nouveau mot de passe, succès, lien expiré).
- **Design** : O1 (7 états), E3 (email de réinitialisation).
- **Maquettes** : O1 ✅, E3 ✅. Écart : l'inscription O1 ne demande pas le nom affiché, obligatoire dans `organizers` (voir rapport).
- **Dépend de** : 0
- **Terminé quand** : inscription, connexion, réinitialisation par le lien ; isolation des données testée ; réponse identique pour un email inconnu.
- **PC** : PC-2 (sécurité : mots de passe, sessions, jetons de réinitialisation).

## 3 — Événement, catégories avec période de vente, aperçu des frais · Les deux
- **Back** : `events`, `ticket_categories`, `fee_rules` (règle plateforme seedée 4 % + 100 FCFA), `audit_log` ; moteur de frais R2–R4 avec résolution de portée ; `fee-preview` ; invariants R11 ; période de vente ; image (port Stockage, WebP) ; profil de versement.
- **Front** : O2 (profil, moyen de versement), O3 (formulaire d'événement), O4 (catégorie, aperçu des frais en direct, prix trop bas, période de vente).
- **Design** : O2 (4 états), O3 (4 états), O4 (2 états), onglets « Infos · Billets · Contrôleurs · Ventes », navigation « Événements · Reversements · Profil ».
- **Maquettes** : O2 ✅, O3 ✅, O4 ◐ — **absents** : liste « Mes événements », liste des catégories d'un événement, modification / archivage d'une catégorie, modification d'un événement (onglet Infos).
- **Données** : liste des villes (manquante ; par défaut N'Djamena et grandes villes, journal n° 53), types d'événement (liste fixe, journal n° 46).
- **Dépend de** : 2
- **Terminé quand** : 1 000 → 860 ; 5 000 → 4 700 ; 20 000 → 19 100 ; 50 000 → 47 900 reproduits par les tests ; prix trop bas refusé ; fin de vente après le début de l'événement acceptée ; fin avant le début de la période refusée.
- **PC** : PC-3 (règles d'argent ; moyen de versement = donnée de paiement sensible ; écrans manquants à fournir).

## 4 — Publication, page publique, lien de vente, recherche, annulation et report, signalement · Les deux
- **Back** : publier / dépublier / republier (profil de versement requis, date à venir), `postpone`, `cancel` (R34), `GET /events` (filtres), `GET /events/{slug}` avec état de chaque catégorie, journal d'audit.
- **Front** : B1, B2 (rendu serveur, aperçu de partage titre + image), O5 (lien à copier, partage WhatsApp, annuler / reporter avec confirmation), lien « contacter le support » pré-rempli.
- **Design** : B1 (3 états), B2 (4 états : en vente, chargement, annulé, reporté), CategoryCard (disponible, bientôt, terminée, épuisée), Banner (annulé, reporté, rappel de prudence), T3, T5.
- **Maquettes** : B1 ✅, B2 ✅, O5 ◐ — **absents** : confirmation de report, saisie de la nouvelle date et republication après report.
- **Données** : canal du support (**manquant**), liste des villes (**manquante**).
- **Dépend de** : 3
- **Terminé quand** : le lien collé dans une messagerie affiche titre et image ; poids des pages mesuré ; événement annulé ou reporté : bandeau, hors liste, aucun achat ; reporté puis republié : revend ; le lien support contient le nom de l'événement.
- **PC** : PC-4 (aperçu de partage et rendu des pages publiques : seul le responsable peut juger ; données manquantes).

## 5 — Réserver des billets · Les deux
- **Back** : `buyers`, `orders`, `order_items`, `funnel_events` ; `POST /orders` avec `Idempotency-Key`, trois montants figés, réservation atomique (R8, R12), expiration (tâche pg-boss, R9), anti-accaparement (R10), numéro normalisé +235 (R30).
- **Front** : B3 (quantités, coordonnées, récapitulatif, chargement), B8 (erreurs : stock insuffisant, champs invalides, réservation expirée, hors période, trop de commandes en attente, service indisponible), minuterie.
- **Design** : B3 (4 états), B8 (2 états dessinés, 4 messages seulement listés).
- **Maquettes** : B3 ◐ — **le champ « Confirmez votre numéro » (double saisie, journal n° 55) n'est pas dessiné** ; B8 ◐.
- **Dépend de** : 4
- **Terminé quand** : 100 acheteurs simultanés du dernier billet → un seul gagne ; réservation expirée libère le stock ; rejeu avec la même clé → une seule commande ; hors période → `CATEGORY_NOT_ON_SALE` ; numéros discordants bloquent la saisie ; catégorie « jour J » s'ouvre à son heure ; annulation pendant des réservations simultanées → aucune vente.
- **PC** : PC-5 (données personnelles des acheteurs : téléphone, nom, email ; stock).

## 6 — Payer et recevoir le billet (faux prestataire) · Les deux
- **Back** : `payments`, `payment_webhook_events`, `tickets`, `payouts` (création), `discrepancies` ; port Paiement + faux prestataire ; webhook signé idempotent ; transaction de confirmation (R14) ; interrogation des paiements en attente (R16) ; paiement tardif (R17) ; double paiement (R18) ; billet signé (format de la tranche 1).
- **Front** : B4 (choix du moyen, attente de confirmation sur le téléphone, redirection), B5 (billet prêt, échec, paiement après expiration), billet à l'écran avec QR, T4.
- **Design** : B4 (2 états), B5 (3 états).
- **Maquettes** : B4 ✅, B5 ✅.
- **Dépend de** : 5, 1
- **Terminé quand** : cas R13 à R18 testés (notification en double, perdue, paiement tardif avec et sans stock, montant différent) ; aucun billet avant confirmation.
- **PC** : PC-6 (paiement).

## 7 — Billet téléchargeable et email · Les deux
- **Back** : PDF à la demande, `GET .../pdf` par jeton de commande, envoi par port Email (pièce jointe + lien `#jeton` + validation), `email_verifications`, `outbound_messages`, `POST /email-verifications/confirm`, `funnel_events` `ticket_downloaded`.
- **Front** : gros bouton de téléchargement, B9 (email confirmé, lien expiré).
- **Design** : P1, E1, E2, B9.
- **Maquettes** : P1 ✅, E1 ✅, E2 ✅, B9 ✅ (écran nouveau, absent de 07).
- **Données** : adresse d'expédition des emails (**manquante**).
- **Dépend de** : 6
- **Terminé quand** : le PDF se scanne avec la page de la tranche 1 ; l'email arrive dans Mailpit ; l'email n'est rattaché au compte qu'après validation.
- **PC** : PC-7 (rendu du PDF imprimé en noir et blanc et des emails : seul le responsable peut juger ; email = donnée personnelle).

## 8 — Reconnexion par SMS et « mes billets » · Les deux
- **Back** : `otp_codes`, limites (R31), port Message (console en test, passerelle Android pour essai réel), session acheteur 90 jours, `GET /me/tickets`, retéléchargement.
- **Front** : B6 (numéro, hors +235, code, code erroné, trop d'essais), B7 (liste par événement, annulé / reporté / billet annulé, vide).
- **Design** : B6 (5 états), B7 (3 états), M1.
- **Maquettes** : B6 ✅, B7 ✅, M1 ✅.
- **Dépend de** : 7
- **Terminé quand** : un acheteur retrouve ses billets avec le code ; celui qui a commandé avec le numéro d'un autre ne voit pas les billets de cet autre ; réponse identique pour un numéro inconnu.
- **PC** : PC-8 (sécurité de l'accès aux billets ; premier vrai SMS via la passerelle Android = envoi vers l'extérieur).

## 9 — Contrôleurs invités · Les deux
- **Back** : `scanner_invites`, `scanner_sessions` ; création (lien + QR), révocation, expiration (début + 24 h), `POST /scan/join`, `GET /scan/session`, session de l'organisateur, liste des contrôleurs.
- **Front** : C1 (rejoindre, lien invalide), O7 partie invitation (lien, QR, partage, liste, retrait).
- **Design** : C1 (2 états), O7 (état 3).
- **Maquettes** : C1 ✅, O7 ✅. Point d'entrée « scanner moi-même » de l'organisateur : ✖ non dessiné.
- **Dépend de** : 3
- **Terminé quand** : un lien révoqué ou expiré refuse l'entrée et coupe les sessions ouvertes.
- **PC** : regroupé avec PC-10 (jetons de sécurité ; aucune exposition publique avant la tranche 10).

## 10 — Scan complet et synchronisation · Les deux
- **Back** : `manifest_downloads`, `passages` ; `GET /scan/manifest`, `POST /scan/passages` (lots idempotents, `valid → used` atomique), `GET /scan/changes?since=` (chevauchement 30 s), `GET /organizer/events/{id}/entry-report`.
- **Front** : C2 final (liste prête, réseau, passages en attente, résultats avec son et vibration), O8.
- **Design** : C2 (6 états), O8 (2 états).
- **Maquettes** : C2 ✅, O8 ✅. Écart : « Premier passage à 19 h 42 » demande l'heure d'utilisation, absente du manifeste du contrat.
- **Dépend de** : 6, 9, 1
- **Terminé quand** : grille manuelle réussie sur iPhone et Android (avec/sans réseau, retour du réseau, billet vendu après téléchargement, deux téléphones hors ligne sur le même billet → un accepté + un doublon signalé, billet annulé refusé en rouge).
- **PC** : PC-10 (grille manuelle sur vrais téléphones : seul le responsable ; revue sécurité des jetons des tranches 9 et 10).

## 11 — Portes et affectation des contrôleurs (facultatif) · Les deux
- **Back** : `gates`, `gate_categories`, affectation (`PATCH /organizer/scanner-sessions/{id}`), manifeste limité, résultat « mauvaise porte ».
- **Front** : O7 options avancées, C2 mauvaise porte.
- **Maquettes** : O7 ✅ (état 4), C2 ✅ (état 6).
- **Dépend de** : 10
- **Terminé quand** : sans affectation, rien ne change.
- **PC** : PC-11 (décider de construire ou non cette tranche facultative : seul le responsable).

## 12 — Tableau de bord et export · Les deux
- **Back** : `GET /organizer/events/{id}/stats`, `buyers.csv` (S4, S5).
- **Front** : O6 (rafraîchi toutes les 15 s, vide, chargement).
- **Maquettes** : O6 ✅.
- **Dépend de** : 6
- **Terminé quand** : chiffres exacts ; CSV protégé contre l'injection de formules ; aucun accès aux acheteurs d'un autre organisateur (test). (La roadmap ne donne pas de critère formel : repris de son contenu.)
- **PC** : PC-12 (export de données personnelles des acheteurs).

## 13 — Reversements · Les deux
- **Back** : port Versement + faux versement, tâche d'envoi avec reprises, statuts, `held` si organisateur suspendu, `GET /organizer/payouts`.
- **Front** : O9 (liste, échec, vide).
- **Maquettes** : O9 ◐ — écart : affichage regroupé par événement avec date prévue, alors que la conception prévoit un versement par commande envoyé dès la vente (R21).
- **Dépend de** : 6
- **Terminé quand** : une commande payée → exactement un versement du bon montant ; un échec est relancé sans double envoi.
- **PC** : PC-13 (paiement : flux d'argent vers les organisateurs).

## 14 — Administration et double authentification · Les deux
- **Back** : `auth_challenges`, TOTP (R37, §6.7), routes `/admin/*` (organisateurs, événements, suspension R33, frais avec historique, simulateur, paiements, marquage remboursée, versements, journal d'audit, mesures).
- **Front** : A1 (mot de passe, code, enrôlement, code incorrect), A2, A3, A4, A5, A6.
- **Maquettes** : A1 ✅, A2 ◐ (liste et suspension des **événements** non dessinées), A3 ✅, A4 ✅, A5 ✅, A6 ✅.
- **Dépend de** : 6, 13
- **Terminé quand** : suspension → événement masqué et vente bloquée en moins d'une minute ; chaque action sensible tracée ; un administrateur sans code valide n'accède à aucune route d'administration.
- **PC** : PC-14 (sécurité : double authentification, suspension, réglage des frais).

## 15 — Support et rapprochement · Les deux
- **Back** : `GET /support/orders`, `resend-ticket`, `POST /admin/payments/{id}/check`, `reconciliation_runs`, rapprochement quotidien (R19), résolution d'écarts.
- **Front** : A7 (recherche, renvoi, aucun résultat), écarts dans A4.
- **Maquettes** : A7 ◐ — écart : succès « Billets renvoyés **par SMS** » alors que le contrat prévoit un renvoi **par email**.
- **Dépend de** : 14
- **Terminé quand** : un écart fabriqué en test apparaît et se résout ; droits du rôle support limités.
- **PC** : PC-15 (paiement : rapprochement ; accès du support aux données personnelles).

## 16 — Intégrations réelles · Back
- Adaptateurs réels : paiement (bac à sable puis réel), versement, messages de production, email. Format réel du relevé. Numéro du payeur si renvoyé par le prestataire.
- **Données** : nom de domaine, nom d'expéditeur des messages (manquants).
- **Dépend de** : 6, 13, 8 + **choix des prestataires** (non faits)
- **Terminé quand** : un paiement réel de petit montant boucle toute la chaîne en préproduction ; les tests du faux prestataire passent.
- **PC** : PC-16 (envoi vers l'extérieur, argent réel, comptes et secrets des prestataires).

## 17 — Fiabilité et sécurité · Back + Ops
- Test de charge (50 acheteurs × 3, une dizaine de téléphones sur 500 billets), test de sécurité, sauvegarde et restauration testée, quotas, supervision des seuils (conception §10).
- **Données** : hébergement choisi (journal n° 42).
- **Dépend de** : 1 à 15
- **Terminé quand** : aucune survente, aucun billet perdu, pages d'événement < 2 s au 95e centile sur connexion lente simulée, restauration réussie.
- **PC** : PC-17 (valeurs définitives des seuils à fixer avec le responsable ; restauration = opération sur des données).

## 18 — Pilote et lancement · Les deux + Ops
- Un ou deux événements réels, corrections, ouverture publique ; mesures (lien → billet, abandon, scan).
- **Préalables** : T1 et T2 publiés (**manquants**), double authentification active en production, domaine et hébergement choisis.
- **Dépend de** : 16, 17
- **Terminé quand** : pilote sans billet perdu ni survente ; écarts de rapprochement expliqués.
- **PC** : PC-18a (mise en production : irréversible, envoi vers l'extérieur), PC-18b (ouverture publique).

---

## Ordre d'exécution
Ordre numérique (instructions générales : « une tranche à la fois, dans
l'ordre de la roadmap » ; roadmap : « pour une seule personne, suivre l'ordre
numérique »). Si une tranche attend un point de contrôle, l'agent avance sur la
suivante dont les dépendances sont terminées (9 et 12 sont indépendantes de 7
et 8).
