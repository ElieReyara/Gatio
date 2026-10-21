# Dossier de contrôle PC-0a et PC-0b — Avant la tranche 0

21/10/2026 · Arrêt prévu : nouvelles dépendances (PC-0a) et premier envoi vers
le dépôt distant public (PC-0b).

## 1. Ce qui est prêt
- Plan validé (PC-00) ; CLAUDE.md complété (branche `dev`, dépôt distant,
  configuration d'exécution, contraintes de mémoire).
- Dépôt git local sur `dev`, `origin` = https://github.com/ElieReyara/Gatio.git
  (vide). Un premier enregistrement local contient `.gitignore`, `CLAUDE.md` et `docs_ia/`.
  **Rien n'a été envoyé.**
- Journal de bord : entrées 58 à 60 ajoutées.

## 2. PC-0a — Dépendances à approuver
Règle de version proposée : dernière version de la ligne majeure stable,
publiée depuis au moins 2 semaines au moment de l'installation ; versions
exactes figées (fichier de verrouillage pnpm) et notées dans `dependances.md`.

| Paquet | Ligne | Où | Rôle | Source |
|---|---|---|---|---|
| pnpm (via corepack, champ `packageManager`) | dernière stable | racine | Monorepo (dernière stable) | Instructions générales |
| typescript | 7 si typescript-eslint et Next l'acceptent, sinon 6.0 | racine (dev) | Langage | Instructions générales |
| @types/node | 22 | racine (dev) | Types de Node 22 | — |
| eslint + typescript-eslint + eslint-config-next | dernières stables | racine (dev) | Lint | Conception §7 (CI « style ») |
| prettier | 3 | racine (dev) | Mise en forme | Conception §7 (CI « style ») |
| vitest | dernière stable | racine (dev) | Tests unitaires et d'intégration | Conception §7 |
| fastify | 5 | api | API | Conception §3.2 |
| zod | 4 | shared, api, web | Schémas partagés, validation de la configuration | Conception §3.2 |
| fastify-type-provider-zod + @fastify/swagger | dernières compatibles Fastify 5 | api | Validation par Zod, OpenAPI généré | Conception §3.2, §6.1 |
| drizzle-orm + drizzle-kit | dernières stables | api | Accès base, migrations versionnées | Conception §3.3 |
| pg + @types/pg | 8 | api | Pilote PostgreSQL (partagé par Drizzle et pg-boss) | Conception §3.3, §3.4 |
| pg-boss | dernière stable | api | Tâches de fond | Conception §3.4 |
| tsx | 4 | api (dev) | Exécution TypeScript en développement | — |
| next, react, react-dom (+ @types/react, @types/react-dom) | Next 16, React 19 | web | Interface | Conception §3.1 |
| Image `postgres:17-alpine` | 17 | Docker | Base locale (déjà présente sur le poste) | Conception §3.3 |
| Image `axllent/mailpit` | dernière stable | Docker | Boîte email de test | Conception §3.11 |

Choix faits pour rester léger : un seul pilote PostgreSQL (`pg`) ; journaux
avec pino, déjà inclus dans Fastify (masquage des téléphones et emails par sa
fonction de rédaction) ; aucun outil d'orchestration du monorepo (scripts
`pnpm -r`) ; pas de Playwright avant la tranche 5 (accord demandé à ce moment-là).
Les dépendances des tranches suivantes (Ed25519, qr-scanner, argon2, WebP,
PDF, TOTP…) feront chacune l'objet d'une demande à leur tranche.

**Décision attendue** : approuver cette liste (ou la corriger).
Recommandation : approuver telle quelle.

## 3. PC-0b — Premier envoi vers le dépôt distant
Le dépôt est **public** : tout ce qui est envoyé devient lisible par tous et
reste dans l'historique, même si le dépôt devient privé ensuite.

| Contenu | Recommandation |
|---|---|
| Code, `CLAUDE.md`, `docs_ia/` | Envoyer |
| `docs_business/` (cahier des charges, conception, maquettes, journal de bord) | **Ne pas envoyer tant que le dépôt est public** : modèle économique, failles possibles et contacts y figurent. L'ajouter quand le dépôt sera privé. En attendant, il reste sur le poste, hors suivi git |

Décisions attendues :
1. Puis-je envoyer `dev` maintenant (sans `docs_business/`) ?
2. Ensuite, envoi automatique de `dev` à chaque tranche clôturée ?
3. La CI GitHub Actions (conception §7) tourne sur un dépôt public sans coût :
   la créer en tranche 0 ?

Recommandation : oui aux trois, `docs_business/` reste exclu jusqu'au passage
en privé.

## 4. Réglage du poste recommandé (facultatif, hors périmètre de l'agent)
Docker peut prendre jusqu'à environ 4 Go sur 8. Pour laisser plus de mémoire à
Windows, créer `C:\Users\Alladoum\.wslconfig` avec :
```
[wsl2]
memory=2GB
swap=4GB
```
puis redémarrer Docker Desktop (`wsl --shutdown`). 2 Go suffisent pour
PostgreSQL et Mailpit. Je ne le fais pas moi-même : ce fichier est hors du
projet et touche les autres projets Docker du poste.

## 5. Ce qui continue pendant l'attente
Rien ne peut avancer sans dépendances : la tranche 0 démarre dès l'accord PC-0a.

## 6. « À confirmer » cumulés
Questions Q2 à Q9 du dossier PC-00 (non bloquantes pour la tranche 0).
