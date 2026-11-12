// Schéma SQLite de Studio Vidéo IA (base locale, par défaut).
// Même contenu que le schéma PostgreSQL : seules les écritures changent (texte pour les dates et le JSON,
// 0/1 pour les booléens, déclencheurs au lieu des fonctions PL/pgSQL).
// Les migrations sont numérotées : une version déjà appliquée n'est jamais rejouée.

/** Expression SQLite qui produit un UUID v4 (pour les lignes créées par les déclencheurs). */
const UUID = `(lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))))`;
/** Horodatage ISO 8601 en UTC, comme `new Date().toISOString()`. */
const MAINTENANT = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const LANGUES = `('fr','en','ja','ko','pt')`;
/** Couleur « #RRGGBB ». */
const HEX = "[0-9A-Fa-f]";

/** Version 1 : schéma complet (regroupe toutes les évolutions précédentes). */
const V1 = `
create table if not exists utilisateurs (
  id text primary key default ${UUID},
  email text not null unique collate nocase check (length(email) between 3 and 254),
  mot_de_passe text not null,
  cree_le text not null default ${MAINTENANT}
);

create table if not exists sessions (
  id text primary key,
  utilisateur_id text not null references utilisateurs(id) on delete cascade,
  expire_le text not null,
  cree_le text not null default ${MAINTENANT}
);
create index if not exists sessions_utilisateur on sessions (utilisateur_id);

create table if not exists espaces (
  id text primary key default ${UUID},
  proprietaire text not null references utilisateurs(id) on delete cascade,
  nom text not null check (length(nom) between 1 and 80),
  couleur text not null default '#FF6A3D' check (couleur glob '#${HEX}${HEX}${HEX}${HEX}${HEX}${HEX}'),
  plafond_mensuel real not null default 50 check (plafond_mensuel >= 0),
  fuseau text not null default 'Indian/Mayotte',
  cree_le text not null default ${MAINTENANT}
);
create index if not exists espaces_proprietaire on espaces (proprietaire);

create table if not exists reglages (
  proprietaire text primary key references utilisateurs(id) on delete cascade,
  tarifs text not null default '{"image":0.07,"video_seconde":0.05,"voix_1000_car":0.30,"musique_minute":0.50}' check (json_valid(tarifs)),
  preferences text not null default '{"parallele":2,"sous_titres":"aucun","prises":1,"memoire_auto":true}' check (json_valid(preferences)),
  modifie_le text not null default ${MAINTENANT}
);

create table if not exists cles_api (
  proprietaire text not null references utilisateurs(id) on delete cascade,
  fournisseur text not null check (fournisseur in ('openai','xai','elevenlabs','google','meta','tiktok','anthropic')),
  valeur_chiffree text not null,
  apercu text not null,
  modifie_le text not null default ${MAINTENANT},
  primary key (proprietaire, fournisseur)
);

create table if not exists reseaux_connectes (
  id text primary key default ${UUID},
  espace_id text not null references espaces(id) on delete cascade,
  reseau text not null check (reseau in ('tiktok','instagram','youtube')),
  nom_compte text not null,
  langue text not null default 'fr' check (langue in ${LANGUES}),
  id_externe text,
  jeton_acces_chiffre text,
  jeton_renouvellement_chiffre text,
  jeton_expire_le text,
  statut text not null default 'connecte' check (statut in ('connecte','expire','deconnecte')),
  audit_tiktok_valide integer not null default 0 check (audit_tiktok_valide in (0,1)),
  infos text not null default '{}' check (json_valid(infos)),
  cree_le text not null default ${MAINTENANT},
  unique (espace_id, reseau, id_externe)
);

create table if not exists series (
  id text primary key default ${UUID},
  espace_id text not null references espaces(id) on delete cascade,
  nom text not null check (length(nom) between 1 and 120),
  style_visuel text not null default 'Cinématique',
  langue text not null default 'fr' check (langue in ${LANGUES}),
  univers text not null default '',
  fil_rouge text not null default '',
  rythme text not null default '{"tous_les_jours":2,"heure":"18:00","reseaux":[],"auto":false}' check (json_valid(rythme)),
  hashtags text not null default '{}' check (json_valid(hashtags)),
  genre text not null default 'serie' check (genre in ('serie','clips')),
  cree_le text not null default ${MAINTENANT}
);
create unique index if not exists series_clips_unique on series (espace_id) where genre = 'clips';

create table if not exists personnages (
  id text primary key default ${UUID},
  serie_id text not null references series(id) on delete cascade,
  nom text not null,
  description text not null default '',
  source_voix text not null default 'elevenlabs' check (source_voix in ('elevenlabs','elevenlabs_clone','grok')),
  voix_id text not null default '',
  accord_clone integer not null default 0 check (accord_clone in (0,1)),
  fiche_chemin text,
  fiche_statut text not null default 'a_faire' check (fiche_statut in ('a_faire','en_cours','prete','echec')),
  position integer not null default 0,
  -- Une voix clonée n'est utilisable qu'avec l'accord de la personne.
  check (source_voix <> 'elevenlabs_clone' or accord_clone = 1)
);

create table if not exists saisons (
  id text primary key default ${UUID},
  serie_id text not null references series(id) on delete cascade,
  numero integer not null check (numero >= 1),
  opening_id text references episodes(id) on delete set null,
  ending_id text references episodes(id) on delete set null,
  unique (serie_id, numero)
);

create table if not exists episodes (
  id text primary key default ${UUID},
  serie_id text not null references series(id) on delete cascade,
  saison_id text not null references saisons(id) on delete cascade,
  genre text not null default 'episode' check (genre in ('episode','opening','ending','clip')),
  numero integer not null default 1,
  titre text not null default '',
  idee text not null default '',
  format text not null default 'court' check (format in ('court','moyen','long')),
  duree_cible integer not null default 75 check (duree_cible between 15 and 1200),
  langue text not null default 'fr' check (langue in ${LANGUES}),
  langues text not null default '["fr"]' check (json_valid(langues) and json_type(langues) = 'array'),
  sous_titres text not null default '{}' check (json_valid(sous_titres)),
  prises integer not null default 1 check (prises in (1,2)),
  enchainer integer not null default 1 check (enchainer in (0,1)),
  musique integer not null default 1 check (musique in (0,1)),
  bruitages integer not null default 1 check (bruitages in (0,1)),
  chapitres text not null default '[]' check (json_valid(chapitres)),
  titres_traduits text not null default '{}' check (json_valid(titres_traduits)),
  choix_titres text not null default '{}' check (json_valid(choix_titres)),
  miniature text check (miniature is null or json_valid(miniature)),
  memoire_faite integer not null default 0 check (memoire_faite in (0,1)),
  hashtags text not null default '{}' check (json_valid(hashtags)),
  style_visuel text not null default '',
  paroles text not null default '' check (length(paroles) <= 20000),
  paroles_alignees text check (paroles_alignees is null or (json_valid(paroles_alignees) and json_type(paroles_alignees) = 'array')),
  paroles_traduites text not null default '{}' check (json_valid(paroles_traduites)),
  bpm real check (bpm is null or bpm between 40 and 240),
  extrait_debut real not null default 0,
  extrait_fin real,
  musique_style text not null default '',
  instrumental integer not null default 0 check (instrumental in (0,1)),
  fournisseur_texte text not null default 'openai' check (fournisseur_texte in ('openai','anthropic')),
  cree_le text not null default ${MAINTENANT},
  check (extrait_debut >= 0 and (extrait_fin is null or (extrait_fin > extrait_debut and extrait_fin - extrait_debut <= 600)))
);
create index if not exists episodes_saison on episodes (saison_id, genre, numero);

create table if not exists plans (
  id text primary key default ${UUID},
  episode_id text not null references episodes(id) on delete cascade,
  position integer not null,
  section text not null default 'principal',
  type text not null check (type in ('accroche','action','dialogue','decor','climax','final')),
  texte text not null default '',
  personnage_id text references personnages(id) on delete set null,
  replique text not null default '',
  repliques_traduites text not null default '{}' check (json_valid(repliques_traduites)),
  duree_fixee integer check (duree_fixee in (3,5,8,10,15)),
  valide integer not null default 0 check (valide in (0,1)),
  modifie integer not null default 0 check (modifie in (0,1)),
  prise_choisie text not null default 'A' check (prise_choisie in ('A','B')),
  debut real,
  fin real,
  check ((debut is null and fin is null) or (debut >= 0 and fin > debut and fin - debut <= 15.5))
);
create index if not exists plans_episode on plans (episode_id, position);

create table if not exists fichiers (
  id text primary key default ${UUID},
  espace_id text not null references espaces(id) on delete cascade,
  episode_id text references episodes(id) on delete cascade,
  plan_id text references plans(id) on delete cascade,
  personnage_id text references personnages(id) on delete cascade,
  genre text not null check (genre in ('image','clip','voix','rendu','bande_annonce','miniature','fiche','bruitage','musique','echantillon_voix','chanson')),
  langue text check (langue in ${LANGUES}),
  prise text check (prise in ('A','B')),
  chemin text,
  duree_s real,
  secondes_generation real,
  cout real not null default 0,
  statut text not null default 'pret' check (statut in ('pret','echec')),
  erreur text,
  essais integer not null default 0,
  cree_le text not null default ${MAINTENANT}
);
create index if not exists fichiers_episode on fichiers (episode_id, genre);
create index if not exists fichiers_espace_mois on fichiers (espace_id, cree_le);

create table if not exists publications (
  id text primary key default ${UUID},
  episode_id text not null references episodes(id) on delete cascade,
  reseau_connecte_id text not null references reseaux_connectes(id) on delete cascade,
  langue text not null check (langue in ${LANGUES}),
  livrable text not null default 'court' check (livrable in ('court','film','bande_annonce')),
  programmee_le text not null,
  statut text not null default 'programmee' check (statut in ('attend_rendu','programmee','envoi','traitement','publiee','privee','echec','annulee')),
  id_externe text,
  url text,
  erreur text,
  progression integer not null default 0 check (progression between 0 and 100),
  stats text not null default '{}' check (json_valid(stats)),
  stats_le text,
  publiee_le text,
  cree_le text not null default ${MAINTENANT}
);
create index if not exists publications_dues on publications (statut, programmee_le);

create table if not exists taches (
  id text primary key default ${UUID},
  espace_id text not null references espaces(id) on delete cascade,
  episode_id text references episodes(id) on delete cascade,
  publication_id text references publications(id) on delete cascade,
  type text not null check (type in ('scenario','storyboard','clips','rendu','publication','stats','fiche_personnage','memoire','clone_voix','test_complet','paroles','musique','synchro')),
  statut text not null default 'en_file' check (statut in ('en_file','en_cours','terminee','echec','en_pause','annulee')),
  priorite integer not null default 0,
  donnees text not null default '{}' check (json_valid(donnees)),
  progression text not null default '{}' check (json_valid(progression)),
  erreur text,
  essais integer not null default 0,
  executer_apres text not null default ${MAINTENANT},
  verrouille_par text,
  verrouille_le text,
  cree_le text not null default ${MAINTENANT},
  modifie_le text not null default ${MAINTENANT}
);
create index if not exists taches_file on taches (statut, executer_apres, priorite desc, cree_le);
create index if not exists taches_episode on taches (episode_id, statut);
-- Pas de double tâche active (double clic, deux workers) :
create unique index if not exists taches_publication_active on taches (publication_id)
  where publication_id is not null and statut in ('en_file','en_cours','en_pause');
create unique index if not exists taches_episode_type_actif on taches (episode_id, type)
  where episode_id is not null and type not in ('publication','stats') and statut in ('en_file','en_cours','en_pause');
create unique index if not exists taches_personnage_actif on taches (json_extract(donnees, '$.personnage_id'), type)
  where type in ('fiche_personnage','clone_voix') and statut in ('en_file','en_cours','en_pause');
create unique index if not exists taches_test_complet_actif on taches (espace_id)
  where type = 'test_complet' and statut in ('en_file','en_cours','en_pause');

create table if not exists memoire (
  id text primary key default ${UUID},
  serie_id text not null references series(id) on delete cascade,
  episode_id text references episodes(id) on delete set null,
  genre text not null check (genre in ('fait','personnage','lieu','objet','mystere')),
  texte text not null,
  ouvert integer not null default 0 check (ouvert in (0,1)),
  cree_le text not null default ${MAINTENANT}
);

create table if not exists workers_etat (
  nom text primary key,
  vu_le text not null default ${MAINTENANT},
  version_ffmpeg text,
  infos text not null default '{}' check (json_valid(infos))
);

create table if not exists depenses (
  id text primary key default ${UUID},
  espace_id text not null references espaces(id) on delete cascade,
  fichier_id text,
  genre text not null,
  montant real not null check (montant >= 0),
  cree_le text not null default ${MAINTENANT}
);
create index if not exists depenses_espace_mois on depenses (espace_id, cree_le);

create table if not exists videos_reseau (
  id text primary key default ${UUID},
  reseau_connecte_id text not null references reseaux_connectes(id) on delete cascade,
  id_externe text not null,
  publication_id text references publications(id) on delete set null,
  titre text not null default '',
  url text,
  miniature_url text,
  publiee_le text,
  duree_s real,
  vues integer not null default 0,
  jaime integer not null default 0,
  commentaires integer not null default 0,
  partages integer not null default 0,
  revenu_estime real,
  devise text,
  maj_le text not null default ${MAINTENANT},
  unique (reseau_connecte_id, id_externe)
);
create index if not exists videos_reseau_vues on videos_reseau (reseau_connecte_id, vues desc);

create table if not exists stats_comptes (
  id text primary key default ${UUID},
  reseau_connecte_id text not null references reseaux_connectes(id) on delete cascade,
  jour text not null,
  abonnes integer,
  abonnements integer,
  jaime_total integer,
  videos integer,
  vues_total integer,
  revenu_estime real,
  devise text,
  unique (reseau_connecte_id, jour)
);

create table if not exists revenus (
  id text primary key default ${UUID},
  reseau_connecte_id text not null references reseaux_connectes(id) on delete cascade,
  mois text not null check (substr(mois, 9, 2) = '01'),
  montant real not null check (montant >= 0),
  devise text not null default 'EUR' check (devise glob '[A-Z][A-Z][A-Z]'),
  source text not null check (source in ('api','manuel')),
  note text not null default '',
  cree_le text not null default ${MAINTENANT},
  unique (reseau_connecte_id, mois, source)
);

-- ---------- Déclencheurs : journal des dépenses et cohérence des liens ----------

-- Chaque fichier payant inscrit sa dépense ; la ligne reste si le fichier est supprimé ensuite.
create trigger if not exists fichiers_depense after insert on fichiers when new.cout > 0
begin
  insert into depenses (id, espace_id, fichier_id, genre, montant, cree_le) values (${UUID}, new.espace_id, new.id, new.genre, new.cout, new.cree_le);
end;

-- Une fiche de personnage reste dans le dossier du compte de sa série.
create trigger if not exists personnages_coherence_ins before insert on personnages
when new.fiche_chemin is not null and new.fiche_chemin not like (select espace_id from series where id = new.serie_id) || '/%'
begin select raise(abort, 'Chemin de fiche refusé : il doit appartenir au compte de la série.'); end;
create trigger if not exists personnages_coherence_maj before update on personnages
when new.fiche_chemin is not null and new.fiche_chemin not like (select espace_id from series where id = new.serie_id) || '/%'
begin select raise(abort, 'Chemin de fiche refusé : il doit appartenir au compte de la série.'); end;

-- La saison d'un épisode est de la même série ; la langue est l'une des langues ; les miniatures restent dans le compte.
create trigger if not exists episodes_coherence_ins before insert on episodes
begin
  select raise(abort, 'La saison doit appartenir à la même série que l''épisode.')
   where not exists (select 1 from saisons where id = new.saison_id and serie_id = new.serie_id);
  select raise(abort, 'La langue de l''épisode doit faire partie de ses langues.')
   where not exists (select 1 from json_each(new.langues) where value = new.langue);
  select raise(abort, 'Chemin de miniature refusé : il doit appartenir au compte de la série.')
   where new.miniature is not null and json_type(new.miniature, '$.chemins') = 'array'
     and exists (select 1 from json_each(new.miniature, '$.chemins') c
                  where c.value not like (select espace_id from series where id = new.serie_id) || '/%');
end;
create trigger if not exists episodes_coherence_maj before update on episodes
begin
  select raise(abort, 'La saison doit appartenir à la même série que l''épisode.')
   where not exists (select 1 from saisons where id = new.saison_id and serie_id = new.serie_id);
  select raise(abort, 'La langue de l''épisode doit faire partie de ses langues.')
   where not exists (select 1 from json_each(new.langues) where value = new.langue);
  select raise(abort, 'Chemin de miniature refusé : il doit appartenir au compte de la série.')
   where new.miniature is not null and json_type(new.miniature, '$.chemins') = 'array'
     and exists (select 1 from json_each(new.miniature, '$.chemins') c
                  where c.value not like (select espace_id from series where id = new.serie_id) || '/%');
end;

-- L'opening et l'ending d'une saison sont des épisodes de sa série.
create trigger if not exists saisons_coherence_maj before update on saisons
begin
  select raise(abort, 'L''opening doit être un épisode de la même série.')
   where new.opening_id is not null and not exists (select 1 from episodes where id = new.opening_id and serie_id = new.serie_id);
  select raise(abort, 'L''ending doit être un épisode de la même série.')
   where new.ending_id is not null and not exists (select 1 from episodes where id = new.ending_id and serie_id = new.serie_id);
end;

-- Le personnage d'un plan est un personnage de la série de l'épisode.
create trigger if not exists plans_coherence_ins before insert on plans
when new.personnage_id is not null and not exists (
  select 1 from personnages p join episodes e on e.serie_id = p.serie_id where p.id = new.personnage_id and e.id = new.episode_id)
begin select raise(abort, 'Le personnage doit appartenir à la série de l''épisode.'); end;
create trigger if not exists plans_coherence_maj before update on plans
when new.personnage_id is not null and not exists (
  select 1 from personnages p join episodes e on e.serie_id = p.serie_id where p.id = new.personnage_id and e.id = new.episode_id)
begin select raise(abort, 'Le personnage doit appartenir à la série de l''épisode.'); end;
`;

/**
 * Version 2 : cahier des charges « Studio Séries IA ».
 * Bibliothèque (décors, activités, marque, sons, variantes), scènes, plans détaillés, versions des fichiers
 * (choix, consigne, fournisseur, contrôle qualité), arc de saison, story d'épisode, double authentification.
 */
const V2 = `
create table if not exists elements (
  id text primary key default ${UUID},
  espace_id text not null references espaces(id) on delete cascade,
  -- null : élément partagé avec toutes les séries du compte.
  serie_id text references series(id) on delete cascade,
  genre text not null check (genre in ('decor','activite','marque','son','variante')),
  nom text not null check (length(nom) between 1 and 120),
  description text not null default '' check (length(description) <= 4000),
  moment text not null default '',
  consigne text not null default '' check (length(consigne) <= 2000),
  personnage_id text references personnages(id) on delete cascade,
  couleurs text not null default '{}' check (json_valid(couleurs)),
  position integer not null default 0,
  cree_le text not null default ${MAINTENANT},
  check (genre <> 'variante' or personnage_id is not null)
);
create index if not exists elements_espace on elements (espace_id, genre);

-- Un élément reste dans son compte : sa série et son personnage sont de ce compte.
create trigger if not exists elements_coherence_ins before insert on elements
begin
  select raise(abort, 'La série de l''élément doit appartenir au même compte.')
   where new.serie_id is not null and not exists (select 1 from series where id = new.serie_id and espace_id = new.espace_id);
  select raise(abort, 'Le personnage de la variante doit appartenir au même compte.')
   where new.personnage_id is not null and not exists (select 1 from personnages p join series s on s.id = p.serie_id where p.id = new.personnage_id and s.espace_id = new.espace_id);
end;
create trigger if not exists elements_coherence_maj before update on elements
begin
  select raise(abort, 'La série de l''élément doit appartenir au même compte.')
   where new.serie_id is not null and not exists (select 1 from series where id = new.serie_id and espace_id = new.espace_id);
  select raise(abort, 'Le personnage de la variante doit appartenir au même compte.')
   where new.personnage_id is not null and not exists (select 1 from personnages p join series s on s.id = p.serie_id where p.id = new.personnage_id and s.espace_id = new.espace_id);
end;

create table if not exists scenes (
  id text primary key default ${UUID},
  episode_id text not null references episodes(id) on delete cascade,
  position integer not null default 0,
  titre text not null default '',
  lieu_id text references elements(id) on delete set null,
  moment text not null default '',
  resume text not null default '',
  personnages text not null default '[]' check (json_valid(personnages) and json_type(personnages) = 'array')
);
create index if not exists scenes_episode on scenes (episode_id, position);

alter table plans add column scene_id text references scenes(id) on delete set null;
alter table plans add column duree real check (duree is null or (duree >= 1 and duree <= 15));
alter table plans add column decor_id text references elements(id) on delete set null;
alter table plans add column activite_id text references elements(id) on delete set null;
alter table plans add column personnages text not null default '[]' check (json_valid(personnages) and json_type(personnages) = 'array');
alter table plans add column variantes text not null default '[]' check (json_valid(variantes) and json_type(variantes) = 'array');
alter table plans add column cadrage text not null default '';
alter table plans add column mouvement text not null default '';
alter table plans add column transition text not null default 'coupe' check (transition in ('coupe','fondu','flash'));
alter table plans add column effet text not null default 'aucun' check (effet in ('aucun','zoom','tremblement','ralenti'));
alter table plans add column texte_ecran text not null default '';
alter table plans add column son text not null default '';
alter table plans add column commentaires text not null default '[]' check (json_valid(commentaires) and json_type(commentaires) = 'array');

-- La scène d'un plan est une scène du même épisode ; son décor et son activité sont du même compte.
create trigger if not exists plans_scene_ins before insert on plans
begin
  select raise(abort, 'La scène doit appartenir au même épisode que le plan.')
   where new.scene_id is not null and not exists (select 1 from scenes where id = new.scene_id and episode_id = new.episode_id);
  select raise(abort, 'Le décor ou l''activité doit appartenir au compte de la série.')
   where (new.decor_id is not null and not exists (select 1 from elements el join series s on s.espace_id = el.espace_id join episodes e on e.serie_id = s.id where el.id = new.decor_id and e.id = new.episode_id))
      or (new.activite_id is not null and not exists (select 1 from elements el join series s on s.espace_id = el.espace_id join episodes e on e.serie_id = s.id where el.id = new.activite_id and e.id = new.episode_id));
end;
create trigger if not exists plans_scene_maj before update on plans
begin
  select raise(abort, 'La scène doit appartenir au même épisode que le plan.')
   where new.scene_id is not null and not exists (select 1 from scenes where id = new.scene_id and episode_id = new.episode_id);
  select raise(abort, 'Le décor ou l''activité doit appartenir au compte de la série.')
   where (new.decor_id is not null and not exists (select 1 from elements el join series s on s.espace_id = el.espace_id join episodes e on e.serie_id = s.id where el.id = new.decor_id and e.id = new.episode_id))
      or (new.activite_id is not null and not exists (select 1 from elements el join series s on s.espace_id = el.espace_id join episodes e on e.serie_id = s.id where el.id = new.activite_id and e.id = new.episode_id));
end;
create trigger if not exists scenes_lieu_ins before insert on scenes
when new.lieu_id is not null and not exists (select 1 from elements el join series s on s.espace_id = el.espace_id join episodes e on e.serie_id = s.id where el.id = new.lieu_id and e.id = new.episode_id)
begin select raise(abort, 'Le lieu doit appartenir au compte de la série.'); end;
create trigger if not exists scenes_lieu_maj before update on scenes
when new.lieu_id is not null and not exists (select 1 from elements el join series s on s.espace_id = el.espace_id join episodes e on e.serie_id = s.id where el.id = new.lieu_id and e.id = new.episode_id)
begin select raise(abort, 'Le lieu doit appartenir au compte de la série.'); end;

alter table saisons add column titre text not null default '';
alter table saisons add column arc text not null default '' check (length(arc) <= 20000);
alter table saisons add column nombre_episodes integer check (nombre_episodes is null or nombre_episodes between 1 and 30);

alter table episodes add column accroche text not null default '';
alter table episodes add column deroule text not null default '' check (length(deroule) <= 20000);
alter table episodes add column fin_suite text not null default '';
alter table episodes add column rappel integer not null default 1 check (rappel in (0,1));
alter table episodes add column logo integer not null default 1 check (logo in (0,1));
alter table episodes add column carte_fin integer not null default 1 check (carte_fin in (0,1));
alter table episodes add column scenario_valide integer not null default 0 check (scenario_valide in (0,1));
alter table episodes add column video_validee integer not null default 0 check (video_validee in (0,1));

alter table utilisateurs add column totp_chiffre text;
alter table utilisateurs add column totp_actif integer not null default 0 check (totp_actif in (0,1));

-- Fichiers : nouveau genre « reference » (photos et vidéos de la bibliothèque) et suivi des versions.
-- SQLite ne sait pas changer une contrainte : la table est reconstruite (aucune autre table ne la référence).
create table fichiers_v2 (
  id text primary key default ${UUID},
  espace_id text not null references espaces(id) on delete cascade,
  episode_id text references episodes(id) on delete cascade,
  plan_id text references plans(id) on delete cascade,
  personnage_id text references personnages(id) on delete cascade,
  element_id text references elements(id) on delete cascade,
  genre text not null check (genre in ('image','clip','voix','rendu','bande_annonce','miniature','fiche','bruitage','musique','echantillon_voix','chanson','reference')),
  langue text check (langue in ${LANGUES}),
  prise text check (prise in ('A','B')),
  chemin text,
  duree_s real,
  secondes_generation real,
  cout real not null default 0,
  statut text not null default 'pret' check (statut in ('pret','echec')),
  erreur text,
  essais integer not null default 0,
  -- Version retenue : la plus récente par « actif_le », sinon par date de création.
  actif_le text,
  consigne text not null default '',
  fournisseur text not null default '',
  controle text check (controle is null or json_valid(controle)),
  -- Photo d'une vraie personne : son accord est obligatoire (case cochée à l'import).
  personne_reelle integer not null default 0 check (personne_reelle in (0,1)),
  accord_image integer not null default 0 check (accord_image in (0,1)),
  nom_origine text not null default '',
  cree_le text not null default ${MAINTENANT},
  check (personne_reelle = 0 or accord_image = 1)
);
insert into fichiers_v2 (id, espace_id, episode_id, plan_id, personnage_id, genre, langue, prise, chemin, duree_s, secondes_generation, cout, statut, erreur, essais, cree_le)
  select id, espace_id, episode_id, plan_id, personnage_id, genre, langue, prise, chemin, duree_s, secondes_generation, cout, statut, erreur, essais, cree_le from fichiers;
drop table fichiers;
alter table fichiers_v2 rename to fichiers;
create index if not exists fichiers_episode on fichiers (episode_id, genre);
create index if not exists fichiers_espace_mois on fichiers (espace_id, cree_le);
create index if not exists fichiers_element on fichiers (element_id);
create index if not exists fichiers_personnage on fichiers (personnage_id, genre);
create trigger if not exists fichiers_depense after insert on fichiers when new.cout > 0
begin
  insert into depenses (id, espace_id, fichier_id, genre, montant, cree_le) values (${UUID}, new.espace_id, new.id, new.genre, new.cout, new.cree_le);
end;
`;

/** Migrations SQLite, dans l'ordre. Ajouter une version à la fin, ne jamais modifier une version publiée. */
export const MIGRATIONS_SQLITE: readonly { version: number; nom: string; sql: string }[] = [
  { version: 1, nom: "schéma initial", sql: V1 },
  { version: 2, nom: "bibliothèque, scènes, versions, double authentification", sql: V2 },
];
