# Configurer les API

Toutes les clés se saisissent dans l'app, **Réglages → Clés API**. Elles sont chiffrées sur le serveur et ne sont jamais réaffichées (seuls les 4 derniers caractères restent visibles). Ne les colle jamais dans un fichier du dépôt.

L'adresse de retour OAuth à déclarer chez Google, Meta et TikTok est affichée dans Réglages → Clés API. Elle a la forme :

```
<APP_URL>/api/oauth/youtube/retour
<APP_URL>/api/oauth/instagram/retour
<APP_URL>/api/oauth/tiktok/retour
```

En local, `APP_URL` vaut `http://localhost:3000`. Certains fournisseurs refusent `http` ou `localhost` : utilise alors l'adresse publique de ton déploiement, ou un tunnel HTTPS.

## OpenAI (scénarios, images, fiches personnages, traductions)

1. https://platform.openai.com → API keys → Create new secret key.
2. Ajoute un moyen de paiement. La génération d'images peut demander la vérification de l'organisation.
3. Modèles utilisés : `OPENAI_TEXT_MODEL` et `OPENAI_IMAGE_MODEL` dans `.env` (modifiables sans toucher au code).

## xAI · Grok (clips vidéo)

1. https://console.x.ai → API Keys → Create.
2. Modèle et résolution : `XAI_VIDEO_MODEL` et `XAI_VIDEO_RESOLUTION` dans `.env`.
3. Les vidéos renvoyées par xAI sont des liens temporaires : le worker les télécharge et les range tout de suite dans Supabase Storage.

## ElevenLabs (voix, voix clonées, bruitages)

1. https://elevenlabs.io → profil → API Keys.
2. Le clonage de voix dépend de ton abonnement ElevenLabs. Clone seulement ta voix ou celle d'une personne qui a donné son accord (case obligatoire dans la bible).
3. Le modèle `eleven_multilingual_v2` parle français, anglais, japonais, coréen et portugais avec la même voix.

## YouTube (Google Cloud)

1. https://console.cloud.google.com → crée un projet.
2. **API et services → Bibliothèque** : active « YouTube Data API v3 » et « YouTube Analytics API » (vues détaillées et revenus).
3. **Écran de consentement OAuth** : type Externe, avec les autorisations `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly` et `yt-analytics-monetary.readonly`. Tant que l'app est « En test », ajoute ton adresse Google dans les utilisateurs de test.
4. **Identifiants → Créer → ID client OAuth → Application Web**, avec l'adresse de retour YouTube ci-dessus.
5. Dans Feuilleton : Réglages → Clés API → Google : identifiant client et secret client. Puis Réglages → Comptes → Connecter YouTube (une fois par chaîne).
6. Programmation : YouTube publie lui-même à la date choisie (vidéo envoyée en privé avec une date de publication).
7. Revenus : lus automatiquement par l'API YouTube Analytics si la chaîne est monétisée (Programme Partenaire YouTube). Sinon, l'app indique « revenus indisponibles ».
8. Limites : le quota d'envoi par jour est limité par Google. Google peut exiger un audit de ton projet (« YouTube API Services ») avant que les vidéos envoyées par l'API soient publiques : si elles restent privées, c'est la raison.

## Instagram (Meta)

1. https://developers.facebook.com → Mes apps → Créer une app.
2. Ajoute le produit **Instagram** → « API avec connexion Instagram ».
3. Autorisations : `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`. Déclare l'adresse de retour Instagram.
4. Ton compte Instagram doit être **professionnel** (Créateur ou Entreprise). En mode développement, ajoute-le comme testeur de l'app.
5. Dans Feuilleton : Réglages → Clés API → Meta : identifiant et secret de l'app Instagram. Puis Réglages → Comptes → Connecter Instagram.
6. Statistiques : abonnés, vues, j'aime et commentaires de toutes les vidéos du compte. Instagram n'a pas d'API pour les revenus : saisis-les chaque mois dans Statistiques → Revenus.
7. Limite : 100 publications par API sur 24 h. L'API n'a pas de programmation : le worker publie à l'heure exacte, il doit être allumé.

## TikTok

1. https://developers.tiktok.com → Manage apps → Connect an app.
2. Ajoute **Login Kit** et **Content Posting API** (active « Direct Post »). Scopes : `user.info.basic`, `user.info.stats` (abonnés), `video.publish`, `video.list` (vidéos du compte et leurs vues). Déclare l'adresse de retour TikTok.
3. Dans Feuilleton : Réglages → Clés API → TikTok : client key et client secret. Puis Réglages → Comptes → Connecter TikTok.
4. **Tant que ton app n'a pas passé l'audit de TikTok, les vidéos publiées par l'API restent privées** (visibles par toi seul). Une fois l'audit validé, coche « Audit TikTok validé » sur le compte dans Réglages → Comptes.
5. L'API n'a pas de programmation : le worker publie à l'heure exacte. Les vidéos sont marquées comme contenu généré par IA.
6. Statistiques : abonnés, j'aime totaux et vues de chaque vidéo publique. TikTok n'a pas d'API pour les revenus : saisis-les chaque mois dans Statistiques → Revenus.
