# Dossier de contrôle PC-8b — Affichage sur ordinateur, circulation entre les pages, écran du code

27/10/2026 · Lot demandé par le responsable à son essai du PC-8, à faire avant la tranche 9. Aucune maquette pour l'ordinateur ni pour la navigation commune : choix validés par le responsable le 27/10/2026, journal de bord n° 76.

## 1. Ce qui est prêt
- **En-tête commun** de toutes les pages acheteur :
  - le logo ramène à la liste des événements ;
  - « Mes billets » reste toujours en haut à droite, avec une icône de billet ;
  - sur ordinateur, « Événements » et « Espace organisateur » s'ajoutent ;
  - la page en cours est soulignée.
- **Pied commun** : « Retrouver mes billets », « Contacter le support » (pré-rempli avec l'événement sur sa page) et « Espace organisateur ».
- **Liens de suite** :
  - billets prêts → « Voir tous mes billets » ;
  - Mes billets → « Voir les événements » ;
  - page d'un événement côté organisateur → « Voir la page publique » ;
  - écrans de connexion organisateur → logo vers le site.
- **Parcours de paiement** : la réservation (B3) et le paiement en attente (B4) gardent l'en-tête de retour seul. On ne quitte pas une réservation de 15 minutes par mégarde : sans lien, il n'y a pas de chemin de retour vers un paiement en cours.
- **Sur ordinateur** (au-delà de 900 px de large ; le téléphone ne change pas, sauf l'en-tête et le pied) :
  - liste des événements en grille (2 colonnes dès 640 px, 3 dès 1 024 px) ;
  - page d'un événement en deux colonnes : image, infos et partage à gauche ; « Les billets » à droite, toujours visibles pendant la lecture ;
  - formulaires et parcours (réservation, paiement, billets, code, Mes billets, support, connexion organisateur) dans une carte blanche centrée ;
  - espace organisateur : la barre du bas devient un menu à gauche, avec le logo ;
  - les fenêtres de confirmation (annuler, reporter) s'ouvrent au centre de l'écran.
- **Écran du code (B6)** :
  - le code est vérifié dès le sixième chiffre, sans bouton à appuyer : une phrase le dit ;
  - pendant la vérification, « Vérification du code… » remplace les boutons ;
  - puis « Code validé. » s'affiche ; dans l'achat, il est suivi de « Réservation en cours… » jusqu'à l'écran de paiement ;
  - avant, le formulaire réapparaissait un instant ;
  - le bouton « Valider » ne revient qu'après une panne, pour réessayer le même code.

## 2. Comment le valider
1. **Relancer le site**, car il a été reconstruit : Ctrl+C dans le terminal de `pnpm start:web`, puis `pnpm start:web`. L'API n'a pas changé, mais vous pouvez aussi la relancer (Ctrl+C puis `pnpm dev:api`).
2. **Sur l'ordinateur** (navigateur en plein écran, http://localhost:3000) :
   - la liste : grille de cartes, en-tête avec trois liens, pied en trois colonnes ;
   - la page d'un événement : deux colonnes, les billets à droite restent visibles en descendant ;
   - « Choisir mes billets », puis le paiement : carte centrée ;
   - « Mes billets » : carte centrée, « Voir les événements » ;
   - « Espace organisateur » : menu à gauche ; « Voir la page publique » sur un événement publié.
3. **Réduire la fenêtre** progressivement : la mise en page passe de 3 à 2 colonnes, puis à l'affichage téléphone, sans débordement.
4. **Sur le téléphone** (tunnel) : l'en-tête montre « Gatio » et « Mes billets », le reste suit les maquettes.
5. **Écran du code** : se déconnecter dans « Mes billets », redemander un code et le taper. Attendu :
   - aucun bouton « Valider » ;
   - un code faux : message d'erreur, puis on corrige les chiffres ;
   - un code juste : « Code validé. », puis la liste.

   Même chose dans l'achat, depuis une fenêtre de navigation privée : après « Code validé. Réservation en cours… », on arrive directement au paiement.

## 3. Résultats des vérifications
| Contrôle | Résultat |
|---|---|
| `pnpm verify` | Vert : 244 tests (36 partagés, 18 web, 63 API, 127 d'intégration) et build. Aucune dépendance ajoutée |
| Captures (Edge sans fenêtre, site d'essai sur le port 3001) | 1 366 px : liste, événement en vente, événement annulé, réservation, code, Mes billets, support, connexion et espace organisateur, paiement. 390 px : liste, événement, code (vide, faux, vérification), Mes billets, code dans l'achat jusqu'au paiement. Conformes à ce qui est décrit au §1 |
| Revue isolée | **Aucun bloquant.** Important corrigé : l'envoi et la vérification du code partageaient le même état (deux messages contradictoires au premier achat, « Changer de numéro » caché pendant une vérification sans réponse). Mineurs corrigés : code refusé non renvoyé par la touche « OK », focus, annonce unique de « Code validé », pas de SMS en boucle, « Ne fermez pas cette page. », marges, logo à 48 px, bloc des billets et fenêtre qui défilent, en-tête stable au chargement d'une commande. Détail : journal de session du 27/10/2026 |

## 4. Décisions à prendre
| # | Décision | Recommandation |
|---|---|---|
| E1 | **Largeurs** : téléphone jusqu'à 640 px, grille de 2 colonnes de 640 à 1 024 px, mise en page ordinateur dès 900 px, contenu limité à 1 120 px, cartes de formulaire de 560 px | Accepter |
| E2 | **Parcours de paiement sans en-tête commun** (B3, B4 en attente), pour ne pas quitter une réservation en cours | Accepter |
| E3 | **Écran du code sans bouton « Valider »**. Écart à la maquette B6, états 3 et 4, qui montrent un bouton. Il ne reste que pour réessayer après une panne. Phrase ajoutée : « Le code est vérifié dès le sixième chiffre. » | Valider à l'écran |
| E4 | **En-tête et pied sur toutes les pages acheteur**, y compris sur téléphone : les maquettes B6 et B7 avaient un en-tête de titre (« Code reçu », « Mes billets ») ; le titre passe dans la page | Valider à l'écran |
| E5 | **Espace organisateur** : sur téléphone, la barre du bas ne change pas ; sur ordinateur, le logo du menu ramène au site public | Accepter |

## 5. « À confirmer » cumulés
- **D1 du PC-8** (repli vers la double saisie quand le SMS ne peut pas partir) : décision reportée par le responsable le 27/10/2026.
- **Mise à jour du modèle de données (03)** : `orders.phone_verified` et index des sessions par acheteur (D8 du PC-8). C'est une modification d'une source : j'attends votre « oui » explicite pour la faire par une exception tracée.
- **Premier vrai SMS** (essai B du PC-8) : pas encore fait.
- Essai iPhone (PC-1), essai de l'expiration (PC-5), adresse d'expédition réelle des emails, mise à jour du cahier pour les n° 71 et 73.

## 6. Signalements
- **Données d'essai** ajoutées par l'agent dans la base de développement :
  - un compte organisateur fictif `agent-essai-ordinateur@exemple.com`, sans événement ;
  - les numéros fictifs 66 00 00 12 (code demandé, session ouverte) et 66 00 00 13 (code, session et une réservation d'un billet Standard sur « Soirée Sahel Live », non payée, expirée au bout de 15 minutes).
- **Système de design** : il ne décrit que le téléphone. Les choix pour l'ordinateur sont faits sans planche. Le designer pourra les reprendre plus tard, sans urgence.
- **Votre serveur du site** (`pnpm start:web`, lancé à 12 h 44) sert l'ancienne version depuis la reconstruction : il faut le relancer (§2.1).

## 7. Ce qui continue pendant l'attente
- Rien. Comme convenu, la tranche 9 (contrôleurs invités) démarre après votre essai de ce lot : sa vérification reconstruit le site.

## 8. Ce qui est attendu du responsable
- L'essai du §2 et les décisions E1 à E5.
- Votre « oui » ou « non » pour la mise à jour du modèle de données (D8 du PC-8).
- Quand vous voudrez : l'essai du vrai SMS (essai B du PC-8) et la décision D1.
