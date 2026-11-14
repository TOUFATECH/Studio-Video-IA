# Studio Vidéo IA — consignes pour Claude Code

Projet de **TOUFATECH** (Mayotte). Réponses en **français, au tutoiement**, courtes, le résultat d'abord. Code et commentaires en français.

## Règles à respecter

- **Jamais de secret dans le dépôt** (dépôt public) : pas de clé, pas de `.env`, pas de `donnees/`, pas de `*.db`. Les clés API sont saisies dans l'app (Réglages → Clés API), chiffrées côté serveur, jamais renvoyées au navigateur.
- **`main` = production.** Travail sur une branche, PR, fusion seulement après validation de l'utilisateur.
- **Design : maquette d'abord**, validée avant de coder.
- **Toute modification** d'une fonction existante : proposer la liste (catégorie, recommandation, priorité), attendre la validation.
- Rien de payant (crédits IA, serveur, domaine) sans accord.
- Toujours vérifier la dernière version publiée d'une dépendance avant de l'ajouter ou de la monter.
- Dire clairement ce qui n'a pas été testé.

## Le projet

Monorepo npm workspaces, Node 22 :

| Dossier | Rôle |
|---|---|
| `apps/web` | Site Next.js 15 (App Router, React 19, Sass) |
| `apps/worker` | Worker : file de tâches, génération IA, montage ffmpeg, publication, statistiques |
| `packages/core` | Logique pure (durées, prompts, statuts, coûts, versions) |
| `packages/integrations` | Clients OpenAI, xAI Grok, Anthropic, ElevenLabs, Meta, TikTok, YouTube |
| `packages/base` | Base SQLite par défaut ou PostgreSQL (`DATABASE_URL`), migrations, règles d'accès, TOTP |

IA utilisées : **ChatGPT/OpenAI** (écriture, storyboard `gpt-image-2`), **Claude** en option pour l'écriture, **Grok** (vidéo `grok-imagine-video-1.5`, voix, sons, `grok-stt`). Sora est fermé depuis le 24/09/2026.

Déploiement : **Docker** (`docker compose up -d --build`, voir `docs/INSTALLER.md`). Pas Vercel : le worker doit tourner en continu et les données sont sur disque. Instagram et TikTok exigent une adresse **https** publique (`APP_URL`), via Cloudflare Tunnel par exemple (`studio.toufatech.com` prévu).

## Commandes

```bash
npm install
npm run typecheck
npm test                      # base, core, intégrations, web, worker
npm run build
npm run dev:web               # site en local (port 3000)
npm run dev:worker            # worker en local, dans un 2e terminal
```

Tests PostgreSQL : `TEST_DATABASE_URL=postgres://… npx vitest run --root packages/base`.

## Où on en est (14/11/2026)

- `main` contient le cahier des charges « Studio Séries IA » (PR #1 fusionnée) : bibliothèque, arc → story → scènes → plans, versions, retouches, contrôle qualité, Grok avec références, montage (rappel, effets, logo, carte de fin), 9 statuts, coût avant lancement, double authentification.
- Docs : `docs/GUIDE-SERIES.md`, `docs/TESTER.md`, `docs/CONFIGURER-LES-API.md`, `docs/INSTALLER.md`.
- Maquette (à valider) : https://claude.ai/artifact/E7yyyFrt936rZUtQ193Drg — tableau de bord, téléphone, profils, paiements TikTok, utilisateurs et accès.

### En attente de validation (rien n'est codé)

1. Administrateur = premier compte, voit et gère tout.
2. Accès délégués par utilisateur : tous les profils, un profil, ou seulement Instagram / TikTok / YouTube de certains profils. Rôles Lecteur / Créateur, case « voir les paiements ».
3. Nouvel inscrit sans aucun profil ; création de comptes par l'admin avec mot de passe provisoire.
4. Un profil = 1 Instagram + 1 TikTok (+ 1 YouTube). Doublons existants passés en « déconnecté », rien supprimé.
5. Tableau de bord (remplace Statistiques) filtré selon les droits.
6. Paiements TikTok par compte : saisie ou import CSV (pas d'API TikTok pour les gains), RPM calculé, virements, historique, encadré « Comment c'est calculé ».
7. Part du client en % par profil (70 % dans la maquette, à confirmer).
8. Durée TikTok par défaut 1:05 (Creator Rewards ne paie que les vidéos de plus d'une minute).
9. Vue « Tous les profils ».
10. Libellés : « compte » (espace) → « profil » ; menu « Statistiques » → « Tableau de bord ».

### Prochaine étape prévue

Test de publication réel sur les comptes Instagram et TikTok de l'utilisateur, depuis son installation Docker en https :
- connexion par le bouton « Connecter » (OAuth) — **ne jamais demander ni recevoir de mot de passe** ;
- TikTok non audité : compte TikTok en privé au moment du test, vidéo en « Moi uniquement » ;
- Instagram : compte professionnel, ajouté comme testeur de l'app Meta ; le Reel de test sera public ;
- test avec un vrai épisode (coût annoncé avant lancement).

### Pas encore fait

Snapchat et Story Instagram (via Ayrshare ou Zernio), RGPD (export, suppression), export PDF du storyboard, notifications e-mail, historique des montages. Montées de version majeures recommandées (Next 16, TypeScript 7, Vitest 5, Zod 4), à faire après accord.
