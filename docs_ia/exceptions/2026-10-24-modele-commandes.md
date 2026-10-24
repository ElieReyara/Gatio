# Exception — mise à jour du modèle de données (commandes)

- **Contexte** : tranche 5 ; colonnes et index ajoutés au code sans figurer dans le modèle (journal de bord n° 70, décision D6 du PC-5).
- **Fichier modifié** : `docs_business/Gatio Project/Gatio-Conception/03-modele-de-donnees.md`, table `orders` :
  - ligne ajoutée `idempotency_scope` (portée de la clé de rejeu, unique avec la clé) ;
  - index `(contact_phone, status)` ajouté à la ligne « Index » (plafond R10).
  - `funnel_events.created_at` : déjà couvert par la règle générale du modèle (« toutes les tables ont `created_at` »), aucun changement.
- **Validé par** : le responsable, 24/10/2026 (« je valide tout le reste », réponse au PC-5).
