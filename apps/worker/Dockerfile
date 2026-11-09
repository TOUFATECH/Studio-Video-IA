# Image du worker Feuilleton : Node 22, ffmpeg avec libass, polices Noto (dont japonais et coréen).
# Contexte de build : la racine du dépôt (docker compose up -d --build).

# Étape 1 : ne garder que les package.json et le verrou, pour que « npm ci » reste en cache tant qu'ils ne changent pas.
FROM node:22-bookworm-slim AS manifestes
WORKDIR /src
COPY . .
RUN mkdir -p /out \
 && cp package.json package-lock.json /out/ \
 && find packages apps -name package.json -not -path "*/node_modules/*" -exec cp --parents {} /out \;

# Étape 2 : l'image d'exécution.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk fonts-noto-core fontconfig ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

WORKDIR /app
ENV NODE_ENV=production \
    WORKER_TMP_DIR=/data/tmp \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe \
    SUBTITLE_FONT="Noto Sans CJK JP"

COPY --from=manifestes /out/ ./
# Dépendances du worker seulement (tsx compris), sans les outils de développement.
RUN npm ci --workspace @feuilleton/worker --include-workspace-root --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/integrations ./packages/integrations
COPY apps/worker ./apps/worker

# Utilisateur non root, propriétaire du dossier de travail des rendus.
RUN mkdir -p /data/tmp && chown -R node:node /data
USER node

CMD ["npx", "tsx", "apps/worker/src/index.ts"]
