# Guide : produire une série avec Studio Vidéo IA

Le chemin complet d'une série, de la bibliothèque à la publication. Les IA utilisées :
**ChatGPT** (ou **Claude**) écrit, **OpenAI Images** dessine le storyboard, **Grok** fait les vidéos, les paroles des personnages et les sons. L'app monte, sous-titre et publie.

## 1. La bibliothèque de la série

Série → onglet **Bibliothèque**.

| Élément | À quoi ça sert |
|---|---|
| **Personnages** | 1 à 10 photos ou dessins par personnage. « Proposer 4 visages » crée des fiches au choix ; celle que tu choisis sert de référence dans chaque plan. Voix Grok à choisir dans **Bible et personnages** (Eve par défaut). |
| **Décors** | Photos ou vidéos du vrai lieu (salon, façade, rue). Envoyées à l'IA avec chaque plan qui s'y passe. |
| **Variantes** | « Capuche cachant les cheveux », « tenue de soirée » : une photo à part pour un personnage, choisie plan par plan. |
| **Activités** | Ce que fait le personnage (couper, jouer à la PS5, danser) : une consigne de mouvement réutilisable. |
| **Marques** | Logo (PNG transparent), couleurs : logo posé sur chaque vidéo et carte de fin. |

- Une vidéo importée (MP4 ou MOV, 60 Mo max) donne une image de référence prise au milieu.
- Les photos sont redressées et recadrées automatiquement.
- **Vraie personne** : coche « Photo ou vidéo d'une vraie personne » ; l'import exige alors la case d'accord (droit à l'image). Sans accord, la photo est refusée.
- « Partager avec toutes les séries du compte » : un décor ou une marque réutilisable ailleurs.

## 2. L'arc de la saison

Série → **Épisodes** → « Arc de la saison » :
1. Titre, arc (début, montée, retournement, fin) et nombre d'épisodes (1 à 30), à la main ; **ou**
2. « Écrire l'arc avec l'IA » : ton idée en quelques lignes, le nombre d'épisodes, **ChatGPT ou Claude**. L'IA propose un titre, un résumé et une accroche par épisode. Les épisodes déjà écrits ne changent pas.

## 3. L'épisode : story, scènes, plans

Épisode → étape **Scénario** :
1. **Story** : accroche, déroulé, fin et suite, et la case « Rappel de 2 s de l'épisode précédent ».
2. **Écrire avec l'IA** (ChatGPT ou Claude) : scènes (lieu, moment, personnages) et plans détaillés.
3. Chaque plan se modifie à la main : durée (1 à 8 s), personnages, décor, activité, variantes, cadrage, mouvement, texte à l'écran, son, effet (zoom, tremblement, ralenti), transition (coupe, fondu, flash).
4. La durée totale est contrôlée : alerte au-delà de 60 s, **blocage au-delà de 90 s** pour un épisode vertical.
5. **Valider le scénario** quand tout te va.

## 4. Le storyboard (images)

1. « Générer les images » : 1 à 4 propositions par plan (Réglages → Préférences). Le coût s'affiche ; au-delà du plafond par épisode (20 € par défaut), coche « Je confirme la dépense ».
2. Une image douteuse (contrôle qualité automatique) est entourée en orange avec la raison.
3. Pour chaque plan, « Versions · retouche · commentaires » :
   - **Refaire avec une consigne corrigée** (« la capuche doit cacher tous les cheveux ») ;
   - **Retoucher** l'image actuelle (« t-shirt noir au lieu de blanc ») ;
   - **Remplacer par mon image** (ton fichier, fait dans ChatGPT par exemple) ;
   - **Commentaires** : notes prises en compte à la prochaine génération ;
   - **Versions** : clique une ancienne image pour revenir dessus.
4. « Refaire les images » en lot : plans en erreur ou douteux, une scène, ou tout l'épisode.
5. Valide chaque image, puis **Valider et lancer les clips**.

## 5. Les vidéos (Grok)

- Chaque plan part avec son image en première image, les photos des personnages et du décor, la voix Grok du personnage qui parle, et les sons du plan.
- Mêmes outils qu'au storyboard : refaire avec consigne, remplacer par ta vidéo, versions, refaire en lot.
- Une vidéo plus ancienne que l'image retenue de son plan est considérée périmée : refais-la.

## 6. Le montage

- Effets et transitions de chaque plan, rappel de l'épisode précédent, texte à l'écran en haut.
- **Logo** et **carte de fin** de la série, activables pour chaque épisode.
- Sous-titres au choix par langue. Si le montage existe déjà et qu'un plan change, il est refait tout seul.
- **Valider la vidéo**, puis Publication.

## 7. Le suivi

Le statut de chaque épisode suit 9 étapes : Brouillon → Scénario validé → Images générées → Storyboard validé → Vidéos générées → Monté → Validé → Programmé → Publié. L'accueil affiche le temps restant estimé des tâches en cours.

## 8. La sécurité du compte

Réglages → **Sécurité** → double authentification : scanne le QR code avec Google Authenticator, 1Password ou une autre application, puis saisis le code. À chaque connexion, le code à 6 chiffres est demandé après le mot de passe.

Téléphone perdu, sur la machine du studio :

```bash
npm run mot-de-passe -- moi@exemple.fr "nouveau mot de passe" --sans-2fa
```

## Ce qui n'est pas encore là

- Publication **Snapchat** et Story Instagram (il faut passer par un service intermédiaire : Ayrshare ou Zernio).
- Rôles propriétaire / créateur / lecteur, export et suppression des données (RGPD).
- Export PDF du storyboard, notifications par e-mail.
- Historique des montages (un montage refait remplace l'ancien).
