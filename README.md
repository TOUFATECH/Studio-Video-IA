# Studio Vidéo IA

Studio Vidéo IA écrit, génère, monte et publie des séries vidéo :

**histoire (OpenAI) → images (OpenAI Images) → clips (xAI Grok) → voix (ElevenLabs) → montage et sous-titres (ffmpeg) → publication programmée (TikTok, Instagram, YouTube) → statistiques.**

- Plusieurs **comptes** (espaces), chacun avec ses propres comptes TikTok, Instagram et YouTube, ses séries et son budget.
- Séries, saisons, épisodes, opening et ending, avec une **bible** (univers, personnages, voix) et une **mémoire** mise à jour après chaque épisode, pour que les histoires se suivent.
- Trois formats : **court** (1:00 à 2:00, vertical : TikTok, Instagram, Short YouTube), **YouTube** (2:00 à 4:00, 16:9, avec bande annonce verticale pour TikTok et Instagram) et **film** (5 à 20 min, 16:9, opening, ending, bande annonce). Une vidéo trop longue pour un réseau est refusée avant l'envoi.
- Voix en français, anglais, japonais, coréen et portugais ; **sous-titres incrustés au choix pour chaque version** (ou aucun).
- Publication à une date précise : YouTube programme lui-même ; TikTok et Instagram sont publiés à l'heure exacte par le worker.

## Organisation du dépôt

| Dossier | Rôle |
|---|---|
| `apps/web` | Application Next.js : interface, connexion, OAuth des réseaux, clés API, page Diagnostic. |
| `apps/worker` | Worker Node : file de tâches, appels aux IA, rendu ffmpeg, publication, statistiques. Tourne sur un PC ou dans Docker. |
| `packages/core` | Logique partagée : durées, sous-titres, planning, titres, prompts, état des épisodes, chiffrement. |
| `packages/integrations` | Clients OpenAI, xAI, ElevenLabs, YouTube, Instagram, TikTok. |
| `supabase/migrations` | Schéma de la base, règles de sécurité (RLS), stockage. |
| `docs/` | Configuration des API et guide de test. |

## Mise en route

### 1. Supabase

1. Crée un projet sur https://supabase.com.
2. **SQL Editor** : exécute dans l'ordre les fichiers `supabase/migrations/0001` à `0005` (ou `supabase db push` avec la CLI).
3. **Authentication → URL Configuration** : *Site URL* = ton `APP_URL`, et ajoute `<APP_URL>/auth/callback` dans les *Redirect URLs*.
4. **Project Settings → API** : note l'URL, la clé `anon` et la clé `service_role`.

### 2. Variables d'environnement

```bash
cp .env.example .env                    # worker
cp .env.example apps/web/.env.local     # site web
openssl rand -base64 32                 # → ENCRYPTION_KEY, la même dans les deux fichiers
```

Remplis les valeurs Supabase, `ENCRYPTION_KEY` et `APP_URL`. Les clés OpenAI, xAI et ElevenLabs se saisissent dans l'app, pas dans ces fichiers (sauf pour `npm run test:live`).

### 3. Installer et lancer

Prérequis : Node.js 20.11 ou plus récent. Pour le worker sur un PC : ffmpeg avec libass (sous-titres), et une police japonaise/coréenne (Noto Sans CJK).

```bash
npm install
npm run dev:web        # http://localhost:3000
npm run dev:worker     # dans un second terminal, sur un PC
```

Ou le worker dans Docker (ffmpeg et les polices sont inclus) :

```bash
docker compose up -d --build
docker compose logs -f worker
```

### 4. Dans l'application

1. Crée ton compte utilisateur sur `/connexion`.
2. **Réglages → Clés API** : OpenAI, xAI, ElevenLabs, puis les applications Google, Meta et TikTok (voir `docs/CONFIGURER-LES-API.md`).
3. **Réglages → Comptes** : crée tes comptes et connecte leurs réseaux.
4. **Diagnostic** : tout doit être vert, puis lance le **test complet**.

## Tester

Voir `docs/TESTER.md`. En résumé :

```bash
npm run typecheck      # types de tout le dépôt
npm test               # tests automatiques (API simulées + vrai rendu ffmpeg)
npm run test:live      # appels réels en lecture seule (RUN_LIVE_TESTS=1 et clés dans .env)
npm run diagnostic     # état du worker, de ffmpeg, des clés et des comptes connectés
```

## Sécurité

- Les clés API et les jetons des réseaux sont chiffrés (AES-256-GCM) avec `ENCRYPTION_KEY` et ne sont jamais lisibles depuis le navigateur.
- Chaque ligne de la base appartient à un utilisateur (RLS). Les médias sont privés et servis par des liens signés temporaires.
- Ne committe jamais `.env` ni `apps/web/.env.local`.
