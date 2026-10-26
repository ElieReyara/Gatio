# Exception — mise à jour du modèle de données (paiements)

- **Contexte** : tranche 6 ; colonnes, index et règle ajoutés au code sans figurer dans le modèle (journal de bord n° 72, décisions D3 et D5 du PC-6).
- **Fichier modifié** : `docs_business/Gatio Project/Gatio-Conception/03-modele-de-donnees.md` :
  - `payments` : lignes `idempotency_key` (clé de rejeu, unique avec la commande) et `next_action` (prochaine action redonnée au rejeu) ; index (status, created_at) ;
  - `payment_webhook_events` : index partiel des notifications non traitées ;
  - `discrepancies` : index (status) et (payment_id) ;
  - `payouts.status` : `held` aussi si l'événement est suspendu ou sans moyen de versement enregistré.
- **Validé par** : le responsable, 26/10/2026 (« Ok, je suis d'acc », réponse au PC-6).
