-- Journal de bord n° 73 : un lien de validation d'email n'est plus créé que pour une commande
-- passée avec le numéro prouvé. Les liens encore en attente datent d'avant cette règle
-- (commandes au numéro non vérifié) : annulés, pour qu'aucun ne rattache l'adresse d'un tiers.
UPDATE "email_verifications" SET "consumed_at" = now() WHERE "consumed_at" IS NULL;
