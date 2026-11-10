# Tester Studio Vidéo IA, étape par étape

Chaque niveau valide le précédent. Les niveaux 0 à 2 sont **gratuits**. À partir du niveau 3, les appels aux IA coûtent de l'argent : règle d'abord un **plafond mensuel bas** (par exemple 10 €) dans Réglages → Budget.

## Niveau 0 — Le code, sans aucune clé (gratuit, 5 min)

```bash
npm install
npm run typecheck                    # 0 erreur attendue
npm test                             # 275 tests attendus, tous verts
npm run build -w @studio-video-ia/web     # le site se compile, sans .env
bash supabase/tests/lancer.sh        # migrations + sécurité sur un PostgreSQL local (si PostgreSQL est installé)
```

Ce que couvre `npm test` :
- la logique : durées des plans, sous-titres SRT, fuseaux horaires, hashtags, chiffrement des clés ;
- les clips musicaux : lecture des paroles, placement des mots dans la chanson (y compris en japonais), découpage calé sur les paroles et le tempo, plan de composition de la musique, sous-titres des paroles ;
- chaque API (OpenAI, xAI, ElevenLabs, YouTube, Instagram, TikTok), avec des réponses simulées : URL, en-têtes, corps envoyés, erreurs 401 et 429, pagination ;
- le worker : file de tâches, budget, planificateur, et un **vrai rendu ffmpeg** (1080x1920, voix, sous-titres, et un clip musical 16:9 monté sur une chanson) si ffmpeg est installé ;
- le site : validations, signature OAuth, contrôle des fichiers importés, statistiques, programmation.

Dans `supabase/tests/lancer.sh`, les lignes `ERROR` affichées sont des refus **voulus** : le navigateur ne peut ni lire une clé, ni créer une tâche, et un utilisateur ne voit rien des données d'un autre.

## Niveau 1 — Base, site et worker en marche (gratuit, 15 min)

1. Supabase : exécute les 6 fichiers de `supabase/migrations/` dans l'ordre (SQL Editor), puis configure l'URL du site (voir le README).
2. Remplis `.env` et `apps/web/.env.local` (README, étape 2).
3. Lance `npm run dev:web`, puis le worker : `npm run dev:worker` (PC) ou `docker compose up -d --build` (Docker).
4. Crée ton compte sur http://localhost:3000/connexion.
5. Ouvre **Diagnostic**. Attendu : Supabase OK, bucket `medias` OK, worker en ligne, ffmpeg, libass, police des sous-titres.

Depuis le terminal du worker : `npm run diagnostic` affiche le même bilan (code de sortie 1 si un point bloque).

## Niveau 2 — Les clés API, sans rien générer (gratuit, 10 min)

1. **Réglages → Clés API** : colle les clés OpenAI, xAI, ElevenLabs (et Claude si tu veux l'utiliser), puis clique **Tester** sur chacune. Ces tests lisent seulement la liste des modèles ou ton profil.
2. Optionnel, en ligne de commande : mets les trois clés dans `.env` avec `RUN_LIVE_TESTS=1`, puis lance `npm run test:live`. Ce sont des appels réels en lecture seule.
3. **Réglages → Clés API** : identifiants des applications Google, Meta et TikTok (`docs/CONFIGURER-LES-API.md`).
4. **Réglages → Comptes** : connecte un compte TikTok, Instagram et YouTube. Diagnostic doit les afficher en vert.
5. **Statistiques → Synchroniser maintenant** : tes vidéos déjà en ligne et tes abonnés apparaissent (gratuit, lecture seule).

## Niveau 3 — Le test complet (quelques centimes, 2 à 5 min)

**Diagnostic → Lancer le test complet**, en choisissant la langue des sous-titres. Le test enchaîne :
1. une image OpenAI en qualité basse ;
2. un clip Grok de 2 s en 480p à partir de cette image ;
3. une voix ElevenLabs courte ;
4. un rendu ffmpeg vertical avec sous-titres.

Chaque étape affiche son temps et son résultat, et le rendu se lit dans la page. Rien n'est publié.

## Niveau 4 — Un vrai épisode court (coût réel : environ 11 images et 75 s de vidéo)

1. **Séries → Nouvelle série** : remplis la bible (univers, personnages, voix). Génère les fiches de référence des personnages.
2. Épisode 1 → **Écrire avec l'IA** → relis les plans, modifie ce que tu veux.
3. **Storyboard** → Générer les images → valide-les une par une ou refais celles qui ne vont pas.
4. **Valider et lancer les clips** : suis la progression, le temps et le coût. Un échec est réessayé une fois tout seul.
5. **Montage** : langues, sous-titres pour chaque version, titre, puis **Lancer le rendu**.
6. **Publication**, pour un premier essai sans risque :
   - **YouTube** : choisis une **date précise demain**. La vidéo part tout de suite en privé et YouTube la publie à l'heure. Tu peux la supprimer avant.
   - **TikTok** : tant que l'audit n'est pas validé, la vidéo est publiée **en privé**, visible par toi seul.
   - **Instagram** : il n'y a pas de mode privé. Teste sur un compte d'essai ou accepte la publication.
7. Une fois publié : **Écrire la suite** crée l'épisode 2. La mémoire de la série est mise à jour (onglet Mémoire).

## Niveau 5 — Un clip musical (coût réel : une image et quelques secondes de vidéo par phrase chantée)

1. **Clips → Nouveau clip** : titre, langue de la chanson, format **Vertical** pour un premier essai (2:00 max).
2. **Son et paroles** : colle tes paroles (une ligne par phrase chantée, `[Refrain]` pour marquer une section), choisis ChatGPT ou Claude, **Enregistrer**.
3. La chanson, au choix :
   - **Importer** ta chanson (MP3, WAV ou M4A, 45 Mo max) : la synchronisation des paroles se lance toute seule ;
   - ou **Générer la musique** (ElevenLabs Music, style et durée à choisir) : la chanson est composée avec tes paroles, puis synchronisée.
   Sans paroles saisies, elles sont reconnues dans ta chanson. Attendu : la liste « Paroles dans la chanson » avec un horaire pour chaque ligne.
4. **Le clip** : règle l'extrait (début et fin, proposés automatiquement), le tempo si tu le connais, les sous-titres (paroles, traduction ou aucun), puis **Découper et écrire les scènes**. Attendu : un plan par phrase chantée, avec ce qui est chanté et ce qu'on voit.
5. **Storyboard**, **Vidéos**, **Montage** : comme pour un épisode. Le rendu pose les vidéos sur la chanson, sans le son de Grok.
6. **Publication** : un clip vertical part sur TikTok, Instagram et en Short YouTube ; un clip 16:9 seulement sur YouTube (catégorie Musique).

Pour changer d'avis : modifie l'extrait ou le tempo puis **Redécouper**, ou change une scène (« Modifier ce plan avec l'IA »). Les paroles restent calées sur la chanson.

## Si quelque chose ne marche pas

| Symptôme | Cause probable | Que faire |
|---|---|---|
| Les tâches restent « en file » | Worker éteint | Diagnostic → worker en ligne ? Relance-le. |
| Tâche « Budget atteint » | Plafond du mois atteint | Réglages → Budget : relève le plafond, la tâche repart seule. |
| « Reconnecte le compte » | Jeton expiré ou autorisation retirée | Réglages → Comptes → Reconnecter. |
| Sous-titres absents | ffmpeg sans libass | Utilise l'image Docker, ou installe un ffmpeg avec libass. |
| Japonais ou coréen en carrés | Police absente | Installe Noto Sans CJK et règle `SUBTITLE_FONT`. |
| Vidéo TikTok privée | App TikTok non auditée | Normal avant l'audit (`docs/CONFIGURER-LES-API.md`). |
| Vidéo YouTube restée privée | Projet Google non audité | Demande l'audit « YouTube API Services ». |
| Revenus YouTube « indisponibles » | Chaîne non monétisée, ou autorisation manquante | Reconnecte la chaîne. Les revenus exigent le Programme Partenaire. |
| Film refusé au stockage | Limite de taille des fichiers Supabase | Augmente la limite (plan Pro) dans Storage → Settings. |
| Musique refusée par ElevenLabs | Nom d'artiste ou paroles existantes, ou offre gratuite | Retire les noms du style et des paroles ; la musique demande un abonnement ElevenLabs. |
| Paroles mal placées | Paroles différentes de ce qui est chanté | Corrige les paroles pour qu'elles collent à la chanson, Enregistrer, puis Resynchroniser. |
| Chanson refusée à l'import | Fichier de plus de 45 Mo ou format inconnu | Exporte en MP3 (192 kb/s suffit). |
