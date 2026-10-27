# État des fonctionnalités — Gatio

Une ligne par fonctionnalité du plan unifié. États : non commencée · partielle · terminée · bloquée.
« Vérifiée par » : tests automatiques, revue isolée, contrôle du responsable.

| Tranche | Fonctionnalité | Écrans | État | Vérifiée par | Remarques |
|---|---|---|---|---|---|
| 0 | Squelette de bout en bout | — | terminée | `pnpm verify` (15 + 2 tests), test à froid, revue isolée, CI GitHub verte (run 39756846801) | |
| 1 | QR signé et scan hors ligne (prototype) | C2 | réussie sur Android ; iPhone à essayer (PC-1) | `pnpm verify` (49 tests), revue isolée, essai du responsable sur Android en mode avion | Format QR définitif (152 caractères, QR version 8, 49 × 49 modules) ; liste fictive ; « mauvaise porte » en tranche 11 |
| 2 | Compte organisateur, mot de passe oublié | O1, E3 | terminée (PC-2 validé le 22/10/2026) | `pnpm verify` (78 tests dont 19 d'intégration), essai réel (Mailpit), revue isolée de sécurité | Page après connexion provisoire ; PUT du profil en tranche 3 |
| 3 | Événement, catégories, période de vente, aperçu des frais | O2, O3, O4 (+ écrans complétés) | terminée (PC-3 validé le 22/10/2026) | `pnpm verify` (126 tests dont 45 d'intégration), essai réel des pages, aperçu en direct testé dans Edge, revue isolée | Écrans sans maquette à valider à l'écran |
| 4 | Publication, page publique, recherche, annulation/report, signalement | B1, B2, O5, report et support (proposés) | terminée (PC-4 validé le 23/10/2026) | `pnpm verify` (144 tests dont 59 d'intégration), essai réel du parcours complet, revue isolée | Partage par WhatsApp essayé (sans image) ; aperçu avec image à confirmer dès qu'un événement en a une (D13) |
| 5 | Réservation | B3, B8, haut de B4 | terminée (PC-5 validé le 24/10/2026) | `pnpm verify` (168 tests dont 79 d'intégration), pages et commande essayées par le relais du site, revue isolée | Paiement en tranche 6 (la page de la commande l'annonce) ; clics de l'écran B3 à essayer par le responsable |
| 6 | Paiement (faux prestataire) et billet | B4, B5, T4 | terminée (PC-6 validé le 26/10/2026) | `pnpm verify` (188 tests dont 99 d'intégration), parcours complet par le relais du site (réservation, paiement, faux opérateur, tâche de fond, billets signés), revue isolée | Billet à l'écran avec QR ; PDF et email en tranche 7 ; outil d'essai `/dev/faux-operateur` |
| 7 | Billet PDF et email | P1, E1, B9 (E2 non utilisé) | terminée (PC-7 validé le 27/10/2026) | `pnpm verify`, email réel dans Mailpit avec PDF joints, rendu du PDF vérifié, revue isolée, essai du responsable (PDF imprimé, email, validation, scan du PDF) | Billet envoyé seulement à l'email saisi à l'achat (D7) ; titre, lieu et catégorie en alphabet latin seulement (n° 74) ; bandeau « ÉVÉNEMENT ANNULÉ » sur le billet d'un événement annulé |
| 8 | Reconnexion par SMS, mes billets | B6, B7, M1 | terminée (essai A du PC-8 réussi le 27/10/2026 ; premier vrai SMS à faire) | `pnpm verify` (244 tests dont 127 d'intégration), essai réel sur l'API (code, session, liste, PDF, réservation refusée sans code, déconnexion), captures des écrans à 390 px, revue isolée, essai du responsable | SMS affiché dans la console de l'API ; passerelle Android prête, premier vrai SMS au PC-8 ; vérification du numéro avant la première réservation (n° 71) ; billet envoyé à l'email validé quand l'achat n'en donne pas (n° 73) |
| 8b | Affichage sur ordinateur, en-tête et pied communs, écran du code sans bouton | toutes les pages acheteur, espace organisateur, B6 | en attente de contrôle (PC-8b) | `pnpm verify` (244 tests), captures à 1 366 et 390 px, revue isolée | CSS seulement pour l'ordinateur (dès 900 px) ; parcours de paiement sans en-tête commun ; journal de bord n° 76 |
| 9 | Contrôleurs invités | C1, O7 | non commencée | | |
| 10 | Scan complet et synchronisation | C2, O8 | non commencée | | |
| 11 | Portes et affectation (facultatif) | O7, C2 | non commencée | | |
| 12 | Tableau de bord et export | O6 | non commencée | | |
| 13 | Reversements | O9 | non commencée | | |
| 14 | Administration et double authentification | A1 à A6 | non commencée | | |
| 15 | Support et rapprochement | A7, A4 | non commencée | | |
| 16 | Intégrations réelles | — | non commencée | | Attend le choix des prestataires |
| 17 | Fiabilité et sécurité | — | non commencée | | |
| 18 | Pilote et lancement | — | non commencée | | |
