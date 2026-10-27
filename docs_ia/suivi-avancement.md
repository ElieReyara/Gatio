# Suivi d'avancement — Gatio

Tiré de `plan-unifie.md` (version 1, validée par le responsable le 19/10/2026).
Mis à jour par l'agent à chaque changement de statut.
Statuts : à faire · en cours · en attente de contrôle · terminé · bloquée.

Priorité : celle la plus haute des écrans de la tranche dans `07-elements-a-fournir`
(Haute / Moyenne / Basse) ; tranches sans écran (0, 16, 17, 18) : Haute, car
prérequis du lancement ; tranche 11 : Basse (facultative).

## Tranches
| N° | Tranche | Priorité | Dépend de | Critère de terminé (résumé, détail dans le plan) | PC | Statut |
|---|---|---|---|---|---|---|
| 0 | Squelette de bout en bout | Haute | — | Lancement en une commande sur un poste neuf ; CI et `pnpm verify` verts | PC-0a ✔, PC-0b ✔ | terminé (22/10/2026) |
| 1 | Prototype QR signé et scan hors ligne | Haute | 0 | Scan en mode avion sur iPhone et Android réels, QR ajouté après téléchargement accepté, densité lisible | PC-1 | en attente de contrôle (Android réussi le 22/10/2026 ; iPhone à faire) |
| 2 | Compte organisateur et mot de passe oublié | Haute | 0 | Inscription, connexion, réinitialisation ; isolation testée ; réponse identique email inconnu | PC-2 ✔ | terminé (22/10/2026) |
| 3 | Événement, catégories, période de vente, aperçu des frais | Haute | 2 | 4 lignes du tableau des frais testées ; prix trop bas refusé ; règles de période testées | PC-3 ✔ | terminé (22/10/2026) |
| 4 | Publication, page publique, recherche, annulation/report, signalement | Haute | 3 | Aperçu de partage ; poids mesuré ; bandeaux ; republication ; lien support pré-rempli | PC-4 ✔ | terminé (23/10/2026) |
| 5 | Réserver des billets | Haute | 4 | 100 achats simultanés → 1 gagnant ; expiration ; idempotence ; période ; double saisie ; annulation concurrente | PC-5 ✔ | terminé (24/10/2026 ; essai de l'expiration reporté) |
| 6 | Payer et recevoir le billet (faux prestataire) | Haute | 5, 1 | Cas R13–R18 testés ; aucun billet avant confirmation | PC-6 ✔ | terminé (26/10/2026) |
| 7 | Billet téléchargeable et email | Haute | 6 | PDF scannable ; email dans Mailpit ; email rattaché après validation | PC-7 ✔ | terminé (27/10/2026) |
| 8 | Reconnexion par SMS et « mes billets » | Moyenne | 7 | Billets retrouvés par code ; pas d'accès aux billets d'autrui ; réponse identique | PC-8 (essai A ✔) | terminé (27/10/2026 ; premier vrai SMS et D1 reportés) |
| 8b | Affichage sur ordinateur et circulation (demande du responsable au PC-8) | Haute | 8 | Mise en page ordinateur sans changer le téléphone ; en-tête et pied communs ; code vérifié sans bouton | PC-8b | en attente de contrôle (construit le 27/10/2026) |
| 9 | Contrôleurs invités | Haute | 3 | Lien révoqué ou expiré refusé, sessions coupées | (PC-10) | à faire |
| 10 | Scan complet et synchronisation | Haute | 6, 9, 1 | Grille manuelle iPhone + Android réussie | PC-10 | à faire |
| 11 | Portes et affectation (facultatif) | Basse | 10 | Sans affectation, rien ne change | PC-11 | à faire |
| 12 | Tableau de bord et export | Moyenne | 6 | Chiffres exacts ; CSV protégé ; isolation testée | PC-12 | à faire |
| 13 | Reversements | Moyenne | 6 | 1 versement exact par commande ; relance sans double envoi | PC-13 | à faire |
| 14 | Administration et double authentification | Moyenne | 6, 13 | Suspension < 1 min ; actions tracées ; aucun accès admin sans code | PC-14 | à faire |
| 15 | Support et rapprochement | Basse | 14 | Écart fabriqué détecté et résolu ; droits support limités | PC-15 | à faire |
| 16 | Intégrations réelles | Haute | 6, 13, 8 + choix des prestataires | Paiement réel de petit montant bouclé en préproduction | PC-16 | à faire |
| 17 | Fiabilité et sécurité | Haute | 1 à 15 | Aucune survente ni billet perdu ; < 2 s au 95e centile ; restauration réussie | PC-17 | à faire |
| 18 | Pilote et lancement | Haute | 16, 17 | Pilote sans billet perdu ni survente ; écarts expliqués | PC-18a, PC-18b | à faire |

## Points de contrôle humains proposés
Règle : validation que seul le responsable peut juger · sécurité, paiement,
données personnelles · opération irréversible · envoi vers l'extérieur.

| PC | Moment | Ce qui est à valider | Raison |
|---|---|---|---|
| PC-00 ✔ 19/10/2026 | Avant tout code | Plan unifié, CLAUDE.md, configuration d'exécution, réponses aux questions du rapport | Seul le responsable peut juger |
| PC-0a ✔ 21/10/2026 | Tranche 0, avant installation | Liste des dépendances (versions, outils de test et de lint) | Règle « aucune dépendance sans accord » ; décision structurante |
| PC-0b ✔ 22/10/2026 | Tranche 0, fin | Création d'un dépôt distant et de la CI hébergée | Envoi vers l'extérieur |
| PC-1 | Tranche 1, fin | Scan sur vrais iPhone et Android, lisibilité du QR (sinon plan B) | Seul le responsable peut juger (essai physique) ; format QR difficile à changer ensuite |
| PC-2 ✔ 22/10/2026 | Tranche 2, fin | Mots de passe, sessions, jetons de réinitialisation, isolation | Sécurité |
| PC-3 ✔ 22/10/2026 | Tranche 3, fin | Calcul des frais, moyen de versement, écrans manquants | Paiement (argent) ; donnée sensible |
| PC-4 ✔ 23/10/2026 | Tranche 4, fin | Aperçu WhatsApp/Facebook, pages publiques, bandeaux | Seul le responsable peut juger |
| PC-5 | Tranche 5, fin | Collecte du téléphone, du nom, de l'email ; anti-survente | Données personnelles |
| PC-6 | Tranche 6, fin | Cycle de paiement, transaction de confirmation | Paiement |
| PC-7 | Tranche 7, fin | PDF imprimé en noir et blanc, emails | Seul le responsable peut juger ; données personnelles |
| PC-8 | Tranche 8, avant le premier vrai SMS puis fin | Envoi par passerelle Android ; accès aux billets | Envoi vers l'extérieur ; sécurité |
| PC-8b | Lot 8b, fin | Affichage sur ordinateur, navigation, écran du code | Seul le responsable peut juger (écrans sans maquette) |
| PC-10 | Tranche 10, fin (inclut la tranche 9) | Grille manuelle sur vrais téléphones ; jetons d'invitation et de scan | Seul le responsable peut juger ; sécurité |
| PC-11 | Avant la tranche 11 | Construire ou non la tranche facultative | Seul le responsable peut juger |
| PC-12 | Tranche 12, fin | Export CSV des acheteurs | Données personnelles |
| PC-13 | Tranche 13, fin | Versements, reprises, statut retenu | Paiement |
| PC-14 | Tranche 14, fin | Double authentification, suspension, frais | Sécurité |
| PC-15 | Tranche 15, fin | Rapprochement, droits du support | Paiement ; données personnelles |
| PC-16 | Avant chaque adaptateur réel | Comptes, secrets, paiement réel de petit montant | Envoi vers l'extérieur ; argent réel |
| PC-17 | Tranche 17 | Seuils d'alerte définitifs, restauration | Seul le responsable peut juger ; opération sur les données |
| PC-18a | Mise en production | Déploiement, domaine, double authentification active | Irréversible ; envoi vers l'extérieur |
| PC-18b | Ouverture publique | Fin du pilote, T1 et T2 publiés | Irréversible ; décision du responsable |

Points de contrôle permanents (hors tranches) : toute nouvelle dépendance ·
tout envoi vers un dépôt distant ou un service externe · toute modification
d'une source · toute action sur un environnement de production.
