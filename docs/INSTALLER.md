# Installer Studio Vidéo IA

Studio Vidéo IA garde tout chez toi : une **base SQLite** (un simple fichier), les **médias** et la **clé de chiffrement**, dans un dossier « données ». Une **base PostgreSQL externe** peut remplacer SQLite avec un seul réglage.

| Quoi | Où, par défaut |
|---|---|
| Base de données | `donnees/studio.db` (SQLite) ; `/donnees/studio.db` dans Docker |
| Médias (images, vidéos, voix, chansons, rendus) | `donnees/medias/` |
| Clé de chiffrement des clés API et des jetons | `donnees/cle-chiffrement` (créée au premier lancement) |
| Sauvegardes | `donnees/sauvegardes/<date>/` |

## 1. Avec Docker (recommandé)

Prérequis : Docker Desktop (Windows, macOS) ou Docker Engine avec Compose (Linux).

```bash
git clone https://github.com/TOUFATECH/Studio-Video-IA.git
cd Studio-Video-IA
docker compose up -d --build
```

- Deux services démarrent : **web** (le site, port 3000) et **worker** (génération, montage ffmpeg, publication, statistiques). ffmpeg et les polices japonaises et coréennes sont dans l'image.
- Au premier lancement, la base, son schéma, le dossier des médias et la clé sont créés dans le volume Docker `donnees`. Ils survivent aux redémarrages et aux mises à jour.
- Ouvre http://localhost:3000 et crée ton compte.

Commandes utiles :

```bash
docker compose logs -f worker                  # suivre le worker
docker compose exec web npm run sauvegarde     # sauvegarde dans le volume (/donnees/sauvegardes)
git pull && docker compose up -d --build        # mise à jour
docker compose down                            # arrêter (les données restent dans le volume)
```

Changer le port : `PORT=8080 docker compose up -d`.

## 2. Sur un PC, sans Docker

Prérequis : **Node.js 22.13 ou plus récent** (la base SQLite est intégrée à Node), **ffmpeg** avec libass (sous-titres) et une police japonaise/coréenne (Noto Sans CJK).

```bash
npm install
npm run dev:web        # le site : http://localhost:3000
npm run dev:worker     # le worker, dans un second terminal
```

Les données vont dans `donnees/` à la racine du dépôt (ignoré par Git). Pour un autre dossier : `DONNEES_DIR=/chemin` dans `.env`.

En production sur un serveur : `npm run build -w @studio-video-ia/web` puis `npm run start -w @studio-video-ia/web` et `npm run start -w @studio-video-ia/worker`, chacun gardé en marche par ton outil habituel (systemd, pm2…).

## 3. Réglages (.env)

Tout est facultatif. Copie `.env.example` en `.env` à la racine : le site et le worker lisent le même fichier.

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Vide : SQLite local. `postgres://…` : base externe. |
| `DONNEES_DIR`, `MEDIAS_DIR` | Dossier des données, dossier des médias (si tu veux les mettre sur un autre disque). |
| `ENCRYPTION_KEY` | Vide : clé générée et gardée dans le dossier des données. Sinon 32 octets en base64 (`openssl rand -base64 32`). |
| `APP_URL` | Adresse du site (retours OAuth, liens pour Instagram). |
| `INSCRIPTIONS` | `fermees` : seul le premier compte peut être créé. |

## 4. Base de données externe (PostgreSQL)

Mets dans `.env` :

```
DATABASE_URL=postgres://utilisateur:mot-de-passe@serveur:5432/studio
```

puis relance le site et le worker. Le schéma se crée (et se met à jour) tout seul au démarrage. Il faut PostgreSQL 13 ou plus récent et un utilisateur qui a le droit de créer des tables dans cette base.

- **Ton serveur ou un hébergeur** (OVH, Scaleway, Neon…) : copie l'adresse de connexion qu'il te donne. Ajoute `?sslmode=require` si l'hébergeur l'exige.
- **Base d'un projet Supabase** : Project Settings → Database → Connection string (mode « Session »).
- **PostgreSQL dans Docker, à côté du studio** : mets `DATABASE_URL=postgres://studio:studio@postgres:5432/studio` dans `.env`, puis `docker compose --profile postgres up -d --build`. Change le mot de passe avec `POSTGRES_PASSWORD` dans `.env` (et dans l'adresse).

Les médias restent dans le dossier des données, quelle que soit la base. La page **Diagnostic** affiche la base utilisée et la version du schéma.

Passer de SQLite à PostgreSQL : le schéma est le même, mais les données ne sont pas copiées automatiquement. Le plus simple est de choisir la base avant de commencer à produire.

## 5. Sauvegardes

```bash
npm run sauvegarde                          # sur un PC
docker compose exec web npm run sauvegarde  # avec Docker
```

La commande copie la base SQLite (copie cohérente, possible pendant que le studio tourne), les médias et la clé de chiffrement dans `donnees/sauvegardes/<date>/`. Pour restaurer : arrête le studio, remets ces fichiers à leur place, relance.

Avec PostgreSQL, la base se sauvegarde avec l'outil habituel : `pg_dump "$DATABASE_URL" > studio.sql`. La commande copie quand même les médias et la clé.

Garde la **clé de chiffrement** avec tes sauvegardes : sans elle, les clés API et les jetons enregistrés sont illisibles (il faudrait les saisir à nouveau).

## 6. Publier sur Instagram depuis une installation locale

TikTok et YouTube reçoivent la vidéo directement : rien à faire. **Instagram**, lui, télécharge la vidéo depuis ton site : il faut que `APP_URL` soit une adresse **https joignable depuis Internet**.

- Sur un serveur avec un nom de domaine : `APP_URL=https://studio.mon-domaine.fr` (derrière un proxy https comme Caddy ou Nginx).
- Sur un PC : un tunnel, par exemple Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3000`), puis `APP_URL=https://<adresse-du-tunnel>` dans `.env`, et relance.

Seuls les médias à lien signé (valable une heure) sont accessibles sans connexion ; tout le reste du site demande un compte. La page **Diagnostic** indique si l'adresse convient à Instagram.

Les retours OAuth (connexion des comptes TikTok, Instagram, YouTube) utilisent aussi `APP_URL` : déclare `<APP_URL>/api/oauth/<reseau>/retour` dans chaque console développeur (voir `docs/CONFIGURER-LES-API.md`).

## 7. Mot de passe oublié

Sur la machine du studio :

```bash
npm run mot-de-passe -- moi@exemple.fr "mon nouveau mot de passe"
docker compose exec web npm run mot-de-passe -- moi@exemple.fr "mon nouveau mot de passe"   # avec Docker
```

Téléphone de la double authentification perdu : ajoute `--sans-2fa` à la fin de la commande, elle désactive aussi la double authentification.

Les sessions ouvertes de ce compte sont fermées.
