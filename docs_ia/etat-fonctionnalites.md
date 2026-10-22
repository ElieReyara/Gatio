# État des fonctionnalités — Gatio

Une ligne par fonctionnalité du plan unifié. États : non commencée · partielle · terminée · bloquée.
« Vérifiée par » : tests automatiques, revue isolée, contrôle du responsable.

| Tranche | Fonctionnalité | Écrans | État | Vérifiée par | Remarques |
|---|---|---|---|---|---|
| 0 | Squelette de bout en bout | — | terminée | `pnpm verify` (15 + 2 tests), test à froid, revue isolée, CI GitHub verte (run 39756846801) | |
| 1 | QR signé et scan hors ligne (prototype) | C2 | en attente d'essai sur téléphones (PC-1) | `pnpm verify` (49 tests), revue isolée | Format QR définitif (152 caractères, QR version 8, 49 × 49 modules) ; liste fictive ; « mauvaise porte » en tranche 11 |
| 2 | Compte organisateur, mot de passe oublié | O1, E3 | non commencée | | |
| 3 | Événement, catégories, période de vente, aperçu des frais | O2, O3, O4 | non commencée | | |
| 4 | Publication, page publique, recherche, annulation/report, signalement | B1, B2, O5 | non commencée | | |
| 5 | Réservation | B3, B8 | non commencée | | |
| 6 | Paiement (faux prestataire) et billet | B4, B5 | non commencée | | |
| 7 | Billet PDF et email | P1, E1, E2, B9 | non commencée | | |
| 8 | Reconnexion par SMS, mes billets | B6, B7, M1 | non commencée | | |
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
