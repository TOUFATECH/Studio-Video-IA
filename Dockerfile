# Image unique de Studio Vidéo IA : le site (Next.js) et le worker (ffmpeg, polices), lancés comme deux services
# par docker-compose.yml. Au premier démarrage, la base SQLite, le dossier des médias et la clé de chiffrement
# sont créés dans le volume /donnees. Pour une base externe, mets DATABASE_URL=postgres://… dans .env.

# Étape 1 : ne garder que les package.json et le verrou, pour que « npm ci » reste en cache tant qu'ils ne changent pas.
FROM node:22-bookworm-slim AS manifestes
WORKDIR /src
COPY . .
RUN mkdir -p /out \
 && cp package.json package-lock.json /out/ \
 && find packages apps -name package.json -not -path "*/node_modules/*" -exec cp --parents {} /out \;

# Étape 2 : dépendances et construction du site.
FROM node:22-bookworm-slim AS construction
WORKDIR /app
COPY --from=manifestes /out/ ./
RUN npm ci --no-audit --no-fund
COPY . .
# Le dossier des données de la construction est jeté : la vraie base est créée au démarrage, dans le volume.
RUN DONNEES_DIR=/tmp/donnees-build npm run build -w @studio-video-ia/web && rm -rf /tmp/donnees-build

# Étape 3 : l'image d'exécution (ffmpeg avec libass, polices Noto dont japonais et coréen).
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk fonts-noto-core fontconfig ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

WORKDIR /app
ENV NODE_ENV=production \
    DONNEES_DIR=/donnees \
    WORKER_TMP_DIR=/donnees/tmp \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe \
    SUBTITLE_FONT="Noto Sans CJK JP" \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=construction --chown=node:node /app ./
# Volume des données, appartenant à l'utilisateur non root qui fait tourner l'application.
RUN mkdir -p /donnees && chown -R node:node /donnees
VOLUME /donnees
USER node
EXPOSE 3000

# Par défaut : le site. Le worker est lancé avec « npx tsx apps/worker/src/index.ts » (voir docker-compose.yml).
CMD ["npm", "run", "start", "-w", "@studio-video-ia/web", "--", "-p", "3000", "-H", "0.0.0.0"]
