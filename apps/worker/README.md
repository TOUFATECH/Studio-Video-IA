# Worker Feuilleton

Le worker exécute la file de tâches : écriture des scénarios, images (OpenAI), clips (Grok), voix et bruitages
(ElevenLabs), montage ffmpeg, publications programmées (YouTube, Instagram, TikTok) et statistiques des comptes.

## Sur un PC

Prérequis : Node.js 20.11 ou plus récent, ffmpeg **avec libass** (sous-titres) et une police japonaise/coréenne
(Noto Sans CJK, paquet `fonts-noto-cjk` sous Debian/Ubuntu).

```bash
cp .env.example .env      # à la racine du dépôt, puis remplir les valeurs
npm install
npm run diagnostic        # vérifie tout avant de lancer
npm run dev:worker        # relance automatique à chaque modification
```

## Avec Docker

ffmpeg et les polices sont inclus dans l'image.

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f worker
docker compose run --rm worker npx tsx apps/worker/src/diagnostic-cli.ts   # diagnostic dans le conteneur
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

## Tests

```bash
npm test -w @feuilleton/worker        # dont un vrai rendu ffmpeg (ignoré si ffmpeg est absent)
npm run test:live -w @feuilleton/integrations   # appels réels en lecture seule, avec RUN_LIVE_TESTS=1
```
