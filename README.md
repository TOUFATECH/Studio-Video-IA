# Studio Vidéo IA

Studio Vidéo IA écrit, génère, monte et publie des séries vidéo :

**arc et histoire (ChatGPT, ou Claude) → storyboard (OpenAI Images, à partir de tes photos de référence) → vidéos, paroles et sons (xAI Grok) → montage, logo et sous-titres (ffmpeg) → publication programmée (TikTok, Instagram, YouTube) → statistiques.**

- Plusieurs **comptes** (espaces), chacun avec ses propres comptes TikTok, Instagram et YouTube, ses séries et son budget.
- Séries, saisons, épisodes, opening et ending, avec une **bible** (univers, personnages, voix) et une **mémoire** mise à jour après chaque épisode, pour que les histoires se suivent.
- Trois formats : **court** (1:00 par défaut, 1:30 maximum, vertical : TikTok, Instagram, Short YouTube), **YouTube** (2:00 à 4:00, 16:9, avec bande annonce verticale pour TikTok et Instagram) et **film** (5 à 20 min, 16:9, opening, ending, bande annonce). Une vidéo trop longue pour un réseau est refusée avant l'envoi.
- **Bibliothèque** par série : personnages (1 à 10 photos ou dessins chacun, 4 visages proposés), décors réels, activités, variantes (« capuche », « tenue de soirée »), marque (logo, couleurs). Les photos sont envoyées à l'IA avec chaque plan pour que les visages et les lieux restent les mêmes. Case **droit à l'image** obligatoire pour une vraie personne.
- **Écriture en 3 temps** : arc de la saison (nombre d'épisodes au choix) → story de l'épisode (accroche, déroulé, fin) et scènes → plans détaillés (durée 1 à 8 s, cadrage, mouvement, décor, activité, texte à l'écran, son, effet, transition). Tout reste modifiable à la main.
- **Corrections sans tout refaire** : refaire une image ou une vidéo avec une consigne, retoucher une image (« t-shirt noir »), remplacer par ton propre fichier, commenter un plan, refaire un lot (plans douteux, une scène, tout l'épisode). Chaque version est gardée et on peut revenir à une ancienne. Contrôle qualité automatique des images (orange si douteuse).
- **Suivi** : 9 statuts (Brouillon → Publié), durée contrôlée (alerte au-delà de 60 s, blocage au-delà de 90 s pour un épisode vertical), coût estimé avant chaque lancement avec confirmation au-delà du plafond par épisode (20 € par défaut).
- **Montage** : rappel de 2 s de l'épisode précédent, effets (zoom, tremblement, ralenti), transitions (coupe, fondu, flash), logo de la série, carte de fin, texte à l'écran.
- Voix en français, anglais, japonais, coréen et portugais ; **sous-titres incrustés au choix pour chaque version** (ou aucun).
- Publication à une date précise : YouTube programme lui-même ; TikTok et Instagram sont publiés à l'heure exacte par le worker.
- **Espace Clips** : des clips musicaux à partir de ta chanson (importée) ou d'une musique **générée par ElevenLabs** avec tes paroles. Les paroles sont placées dans la chanson (alignement ElevenLabs), le clip est découpé une phrase chantée par plan (calé sur le tempo si tu le donnes), **ChatGPT ou Claude** écrit les scènes, ChatGPT dessine, Grok anime sans son, et le montage pose tout sur la chanson, paroles en sous-titres si tu veux. Formats : vertical 2:00 max (TikTok, Instagram, Short), YouTube 4:00 max, chanson entière 10:00 max.

## Installer en 2 minutes (Docker)

```bash
git clone https://github.com/TOUFATECH/Studio-Video-IA.git
cd Studio-Video-IA
docker compose up -d --build
```

Ouvre http://localhost:3000 : le studio est neuf, crée ton compte. Au premier lancement, le conteneur crée tout seul dans le volume `donnees` :
- la **base de données SQLite** (`studio.db`) et son schéma ;
- le dossier des **médias** (images, vidéos, voix, chansons, rendus) ;
- la **clé de chiffrement** des clés API (`cle-chiffrement`).

Rien à configurer pour démarrer. Réglages facultatifs : copie `.env.example` en `.env` (adresse du site, modèles, base externe…).

**Base externe** : mets `DATABASE_URL=postgres://utilisateur:mot-de-passe@serveur:5432/studio` dans `.env` (ton serveur, un hébergeur, ou la base d'un projet Supabase) et relance. Le schéma se crée seul. Pour un PostgreSQL dans Docker : `docker compose --profile postgres up -d` (voir `docs/INSTALLER.md`).

Sans Docker, sur un PC (Node.js 22.13 ou plus récent, ffmpeg) :

```bash
npm install
npm run dev:web        # http://localhost:3000
npm run dev:worker     # dans un second terminal
```

Guide complet : `docs/INSTALLER.md` (Docker, PC, base externe, sauvegardes, publication Instagram).

## Ensuite, dans l'application

1. Crée ton compte sur la page d'accueil (le premier compte se crée toujours ; `INSCRIPTIONS=fermees` bloque les suivants).
2. **Réglages → Clés API** : OpenAI, xAI, ElevenLabs (et Claude si tu veux l'utiliser pour les clips), puis les applications Google, Meta et TikTok (voir `docs/CONFIGURER-LES-API.md`).
3. **Réglages → Comptes** : crée tes comptes et connecte leurs réseaux.
4. **Diagnostic** : tout doit être vert, puis lance le **test complet**.

## Organisation du dépôt

| Dossier | Rôle |
|---|---|
| `apps/web` | Application Next.js : interface, comptes utilisateurs, OAuth des réseaux, clés API, médias, page Diagnostic. |
| `apps/worker` | Worker Node : file de tâches, appels aux IA, rendu ffmpeg, publication, statistiques. |
| `packages/base` | Base de données : SQLite local (par défaut) ou PostgreSQL externe, schéma et migrations, règles d'accès par utilisateur, comptes et sessions, fichiers des médias. |
| `packages/core` | Logique partagée : durées, sous-titres, clips musicaux, planning, titres, prompts, état des épisodes, chiffrement. |
| `packages/integrations` | Clients OpenAI, Anthropic (Claude), xAI, ElevenLabs (voix, musique, alignement des paroles), YouTube, Instagram, TikTok. |
| `docs/` | Installation, configuration des API, guide de test, guide des séries (`docs/GUIDE-SERIES.md`). |

## Tester

Voir `docs/TESTER.md`. En résumé :

```bash
npm run typecheck      # types de tout le dépôt
npm test               # tests automatiques (API simulées + vrai rendu ffmpeg)
npm run test:live      # appels réels en lecture seule (RUN_LIVE_TESTS=1 et clés dans .env)
npm run diagnostic     # état de la base, du worker, de ffmpeg, des clés et des comptes connectés
npm run sauvegarde     # copie de la base, des médias et de la clé dans donnees/sauvegardes/
```

## Sécurité

- Les clés API et les jetons des réseaux sont chiffrés (AES-256-GCM) avec la clé de chiffrement et ne sont jamais lisibles depuis le navigateur.
- Mots de passe hachés (scrypt), sessions par jeton aléatoire dont seule l'empreinte est en base.
- **Double authentification** (application Google Authenticator, 1Password…) à activer dans Réglages → Sécurité. Téléphone perdu : `npm run mot-de-passe -- <email> <nouveau mot de passe> --sans-2fa` sur la machine du studio.
- Chaque requête d'un utilisateur est limitée à ses propres données (règles d'accès appliquées par la couche base, testées sur SQLite et PostgreSQL). Les médias sont privés et servis par des liens signés temporaires.
- Ne committe jamais `.env` ni le dossier `donnees/` (déjà ignorés par Git).
