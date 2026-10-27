# Exception — mise à jour du modèle de données (billet et email)

- **Contexte** : tranche 7 ; colonnes et règle ajoutées au code sans figurer dans le modèle (journal de bord n° 73, décisions D1, D2 et D6 du PC-7).
- **Fichier modifié** : `docs_business/Gatio Project/Gatio-Conception/03-modele-de-donnees.md` :
  - `orders` : ligne `email_access_token_hash` (second jeton de la commande, pour le lien de l'email du billet) ;
  - `email_verifications` : lien valable 7 jours, à usage unique, les autres liens du compte annulés à la validation ;
  - `outbound_messages` : lignes `attempts` et `next_attempt_at` (essais espacés, abandon) et index.
- **Non modifié** : le complément à R32 (cahier de conception) attend la prochaine révision de la conception, comme les n° 61, 66 et 68.
- **Validé par** : le responsable, 27/10/2026 (« le reste est ok », réponse au PC-7).
