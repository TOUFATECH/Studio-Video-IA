# Worker Studio Vidéo IA

Le worker exécute la file de tâches : écriture des scénarios, images (OpenAI), clips (Grok), voix et bruitages
(ElevenLabs), montage ffmpeg, publications programmées (YouTube, Instagram, TikTok) et statistiques des comptes.

## Sur un PC

Prérequis : Node.js 22.13 ou plus récent, ffmpeg **avec libass** (sous-titres) et une police japonaise/coréenne
(Noto Sans CJK, paquet `fonts-noto-cjk` sous Debian/Ubuntu).

Le worker partage avec le site la même base (SQLite dans `donnees/studio.db` par défaut, ou `DATABASE_URL`)
et le même dossier des médias : sur un PC, lance-les depuis le même dépôt ; dans Docker, ils partagent le volume `donnees`.

```bash
cp .env.example .env      # facultatif : à la racine du dépôt
npm install
npm run diagnostic        # vérifie tout avant de lancer
npm run dev:worker        # relance automatique à chaque modification
```

## Avec Docker

ffmpeg et les polices sont inclus dans l'image.

```bash
docker compose up -d --build
docker compose logs -f worker
docker compose exec worker npx tsx apps/worker/src/diagnostic-cli.ts   # diagnostic dans le conteneur
```

## Variables propres au worker

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `WORKER_NAME` | nom de la machine | Nom affiché dans l'état des workers |
| `WORKER_CONCURRENCY` | `2` | Nombre de tâches traitées en même temps (1 à 8) |
| `WORKER_TMP_DIR` | `./tmp` | Dossier de travail des rendus (nettoyé après chaque tâche) |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` | Chemins des outils s'ils ne sont pas dans le PATH |
| `SUBTITLE_FONT` | `Noto Sans CJK JP` | Police des sous-titres |
| `INSTAGRAM_API_VERSION` | `v25.0` | Version de l'API Graph d'Instagram |
| `APP_URL` | `http://localhost:3000` | Adresse du site : Instagram y télécharge les vidéos (https public nécessaire) |
| `DATABASE_URL`, `DONNEES_DIR`, `MEDIAS_DIR` | SQLite dans `donnees/` | Même base et mêmes médias que le site (voir `docs/INSTALLER.md`) |

## Tests

```bash
npm test -w @studio-video-ia/worker        # dont un vrai rendu ffmpeg (ignoré si ffmpeg est absent)
npm run test:live -w @studio-video-ia/integrations   # appels réels en lecture seule, avec RUN_LIVE_TESTS=1
```
