# Exception — mise à jour du modèle de données (connexion par SMS et scan)

- **Contexte** : tranches 8 à 10 ; colonne et index ajoutés au code sans figurer dans le modèle (D8 du PC-8, F8 du PC-10 ; journal de bord n° 75, 77 et 78).
- **Fichier modifié** : `docs_business/Gatio Project/Gatio-Conception/03-modele-de-donnees.md` :
  - `auth_sessions` : index (user_id) et (buyer_id) ;
  - `orders` : ligne `phone_verified` (commande passée avec le numéro prouvé par le code SMS) ;
  - `passages` : `received_at` tient lieu de `created_at` ; index (event_id, received_at).
- **Non modifié** :
  - `scanner_sessions.created_at` est déjà couvert par la convention « toutes les tables ont `created_at` » ;
  - `gate_id` reste au modèle : la colonne sera créée avec les portes (tranche 11) ;
  - le cahier de conception (§6.5 : champ `qr` des passages, `usedAt`, billets annulés dans la liste, `POST /scan/invite`) attend votre accord, comme les compléments des n° 71 et 73.
- **Validé par** : le responsable, 04/11/2026 (« D8 et F8 nice », réponse au PC-10).
