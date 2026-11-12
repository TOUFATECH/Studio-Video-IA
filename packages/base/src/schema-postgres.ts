// Schéma PostgreSQL de Studio Vidéo IA (base externe : ton serveur, un hébergeur, ou la base d'un projet Supabase).
// Même contenu que le schéma SQLite. Pas de RLS ici : l'application filtre chaque requête par utilisateur
// (voir politiques.ts), comme en SQLite, pour un comportement identique sur les deux bases.

const LANGUES = `('fr','en','ja','ko','pt')`;

/** Version 1 : schéma complet. */
const V1 = `

create table if not exists utilisateurs (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254),
  mot_de_passe text not null,
  cree_le timestamptz not null default now()
);
create unique index if not exists utilisateurs_email on utilisateurs (lower(email));

create table if not exists sessions (
  id text primary key,
  utilisateur_id uuid not null references utilisateurs(id) on delete cascade,
  expire_le timestamptz not null,
  cree_le timestamptz not null default now()
);
create index if not exists sessions_utilisateur on sessions (utilisateur_id);

create table if not exists espaces (
  id uuid primary key default gen_random_uuid(),
  proprietaire uuid not null references utilisateurs(id) on delete cascade,
  nom text not null check (char_length(nom) between 1 and 80),
  couleur text not null default '#FF6A3D' check (couleur ~ '^#[0-9A-Fa-f]{6}$'),
  plafond_mensuel numeric(10,2) not null default 50 check (plafond_mensuel >= 0),
  fuseau text not null default 'Indian/Mayotte',
  cree_le timestamptz not null default now()
);
create index if not exists espaces_proprietaire on espaces (proprietaire);

create table if not exists reglages (
  proprietaire uuid primary key references utilisateurs(id) on delete cascade,
  tarifs jsonb not null default '{"image":0.07,"video_seconde":0.05,"voix_1000_car":0.30,"musique_minute":0.50}',
  preferences jsonb not null default '{"parallele":2,"sous_titres":"aucun","prises":1,"memoire_auto":true}',
  modifie_le timestamptz not null default now()
);

create table if not exists cles_api (
  proprietaire uuid not null references utilisateurs(id) on delete cascade,
  fournisseur text not null check (fournisseur in ('openai','xai','elevenlabs','google','meta','tiktok','anthropic')),
  valeur_chiffree text not null,
  apercu text not null,
  modifie_le timestamptz not null default now(),
  primary key (proprietaire, fournisseur)
);

create table if not exists reseaux_connectes (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references espaces(id) on delete cascade,
  reseau text not null check (reseau in ('tiktok','instagram','youtube')),
  nom_compte text not null,
  langue text not null default 'fr' check (langue in ${LANGUES}),
  id_externe text,
  jeton_acces_chiffre text,
  jeton_renouvellement_chiffre text,
  jeton_expire_le timestamptz,
  statut text not null default 'connecte' check (statut in ('connecte','expire','deconnecte')),
  audit_tiktok_valide boolean not null default false,
  infos jsonb not null default '{}',
  cree_le timestamptz not null default now(),
  unique (espace_id, reseau, id_externe)
);

create table if not exists series (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references espaces(id) on delete cascade,
  nom text not null check (char_length(nom) between 1 and 120),
  style_visuel text not null default 'Cinématique',
  langue text not null default 'fr' check (langue in ${LANGUES}),
  univers text not null default '',
  fil_rouge text not null default '',
  rythme jsonb not null default '{"tous_les_jours":2,"heure":"18:00","reseaux":[],"auto":false}',
  hashtags jsonb not null default '{}',
  genre text not null default 'serie' check (genre in ('serie','clips')),
  cree_le timestamptz not null default now()
);
create unique index if not exists series_clips_unique on series (espace_id) where genre = 'clips';

create table if not exists personnages (
  id uuid primary key default gen_random_uuid(),
  serie_id uuid not null references series(id) on delete cascade,
  nom text not null,
  description text not null default '',
  source_voix text not null default 'elevenlabs' check (source_voix in ('elevenlabs','elevenlabs_clone','grok')),
  voix_id text not null default '',
  accord_clone boolean not null default false,
  fiche_chemin text,
  fiche_statut text not null default 'a_faire' check (fiche_statut in ('a_faire','en_cours','prete','echec')),
  position int not null default 0,
  constraint clone_avec_accord check (source_voix <> 'elevenlabs_clone' or accord_clone)
);

create table if not exists saisons (
  id uuid primary key default gen_random_uuid(),
  serie_id uuid not null references series(id) on delete cascade,
  numero int not null check (numero >= 1),
  opening_id uuid,
  ending_id uuid,
  unique (serie_id, numero)
);

create table if not exists episodes (
  id uuid primary key default gen_random_uuid(),
  serie_id uuid not null references series(id) on delete cascade,
  saison_id uuid not null references saisons(id) on delete cascade,
  genre text not null default 'episode' check (genre in ('episode','opening','ending','clip')),
  numero int not null default 1,
  titre text not null default '',
  idee text not null default '',
  format text not null default 'court' check (format in ('court','moyen','long')),
  duree_cible int not null default 75 check (duree_cible between 15 and 1200),
  langue text not null default 'fr' check (langue in ${LANGUES}),
  langues text[] not null default '{fr}',
  sous_titres jsonb not null default '{}',
  prises int not null default 1 check (prises in (1,2)),
  enchainer boolean not null default true,
  musique boolean not null default true,
  bruitages boolean not null default true,
  chapitres jsonb not null default '[]',
  titres_traduits jsonb not null default '{}',
  choix_titres jsonb not null default '{}',
  miniature jsonb,
  memoire_faite boolean not null default false,
  hashtags jsonb not null default '{}',
  style_visuel text not null default '',
  paroles text not null default '' check (char_length(paroles) <= 20000),
  paroles_alignees jsonb check (paroles_alignees is null or jsonb_typeof(paroles_alignees) = 'array'),
  paroles_traduites jsonb not null default '{}',
  bpm numeric(6,2) check (bpm is null or bpm between 40 and 240),
  extrait_debut numeric(8,3) not null default 0,
  extrait_fin numeric(8,3),
  musique_style text not null default '',
  instrumental boolean not null default false,
  fournisseur_texte text not null default 'openai' check (fournisseur_texte in ('openai','anthropic')),
  cree_le timestamptz not null default now(),
  constraint langue_dans_langues check (langue = any(langues)),
  constraint episodes_extrait_check check (extrait_debut >= 0 and (extrait_fin is null or (extrait_fin > extrait_debut and extrait_fin - extrait_debut <= 600)))
);
create index if not exists episodes_saison on episodes (saison_id, genre, numero);

alter table saisons drop constraint if exists saisons_opening_fk;
alter table saisons add constraint saisons_opening_fk foreign key (opening_id) references episodes(id) on delete set null;
alter table saisons drop constraint if exists saisons_ending_fk;
alter table saisons add constraint saisons_ending_fk foreign key (ending_id) references episodes(id) on delete set null;

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  position int not null,
  section text not null default 'principal',
  type text not null check (type in ('accroche','action','dialogue','decor','climax','final')),
  texte text not null default '',
  personnage_id uuid references personnages(id) on delete set null,
  replique text not null default '',
  repliques_traduites jsonb not null default '{}',
  duree_fixee int check (duree_fixee in (3,5,8,10,15)),
  valide boolean not null default false,
  modifie boolean not null default false,
  prise_choisie text not null default 'A' check (prise_choisie in ('A','B')),
  debut numeric(8,3),
  fin numeric(8,3),
  constraint plans_debut_fin_check check ((debut is null and fin is null) or (debut >= 0 and fin > debut and fin - debut <= 15.5))
);
create index if not exists plans_episode on plans (episode_id, position);

create table if not exists fichiers (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references espaces(id) on delete cascade,
  episode_id uuid references episodes(id) on delete cascade,
  plan_id uuid references plans(id) on delete cascade,
  personnage_id uuid references personnages(id) on delete cascade,
  genre text not null check (genre in ('image','clip','voix','rendu','bande_annonce','miniature','fiche','bruitage','musique','echantillon_voix','chanson')),
  langue text check (langue in ${LANGUES}),
  prise text check (prise in ('A','B')),
  chemin text,
  duree_s numeric,
  secondes_generation numeric,
  cout numeric(10,4) not null default 0,
  statut text not null default 'pret' check (statut in ('pret','echec')),
  erreur text,
  essais int not null default 0,
  cree_le timestamptz not null default now()
);
create index if not exists fichiers_episode on fichiers (episode_id, genre);
create index if not exists fichiers_espace_mois on fichiers (espace_id, cree_le);

create table if not exists publications (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  reseau_connecte_id uuid not null references reseaux_connectes(id) on delete cascade,
  langue text not null check (langue in ${LANGUES}),
  livrable text not null default 'court' check (livrable in ('court','film','bande_annonce')),
  programmee_le timestamptz not null,
  statut text not null default 'programmee' check (statut in ('attend_rendu','programmee','envoi','traitement','publiee','privee','echec','annulee')),
  id_externe text,
  url text,
  erreur text,
  progression int not null default 0 check (progression between 0 and 100),
  stats jsonb not null default '{}',
  stats_le timestamptz,
  publiee_le timestamptz,
  cree_le timestamptz not null default now()
);
create index if not exists publications_dues on publications (statut, programmee_le);

create table if not exists taches (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references espaces(id) on delete cascade,
  episode_id uuid references episodes(id) on delete cascade,
  publication_id uuid references publications(id) on delete cascade,
  type text not null check (type in ('scenario','storyboard','clips','rendu','publication','stats','fiche_personnage','memoire','clone_voix','test_complet','paroles','musique','synchro')),
  statut text not null default 'en_file' check (statut in ('en_file','en_cours','terminee','echec','en_pause','annulee')),
  priorite int not null default 0,
  donnees jsonb not null default '{}',
  progression jsonb not null default '{}',
  erreur text,
  essais int not null default 0,
  executer_apres timestamptz not null default now(),
  verrouille_par text,
  verrouille_le timestamptz,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);
create index if not exists taches_file on taches (statut, executer_apres, priorite desc, cree_le);
create index if not exists taches_episode on taches (episode_id, statut);
create unique index if not exists taches_publication_active on taches (publication_id)
  where publication_id is not null and statut in ('en_file','en_cours','en_pause');
create unique index if not exists taches_episode_type_actif on taches (episode_id, type)
  where episode_id is not null and type not in ('publication','stats') and statut in ('en_file','en_cours','en_pause');
create unique index if not exists taches_personnage_actif on taches ((donnees ->> 'personnage_id'), type)
  where type in ('fiche_personnage','clone_voix') and statut in ('en_file','en_cours','en_pause');
create unique index if not exists taches_test_complet_actif on taches (espace_id)
  where type = 'test_complet' and statut in ('en_file','en_cours','en_pause');

create table if not exists memoire (
  id uuid primary key default gen_random_uuid(),
  serie_id uuid not null references series(id) on delete cascade,
  episode_id uuid references episodes(id) on delete set null,
  genre text not null check (genre in ('fait','personnage','lieu','objet','mystere')),
  texte text not null,
  ouvert boolean not null default false,
  cree_le timestamptz not null default now()
);

create table if not exists workers_etat (
  nom text primary key,
  vu_le timestamptz not null default now(),
  version_ffmpeg text,
  infos jsonb not null default '{}'
);

create table if not exists depenses (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references espaces(id) on delete cascade,
  fichier_id uuid,
  genre text not null,
  montant numeric(10,4) not null check (montant >= 0),
  cree_le timestamptz not null default now()
);
create index if not exists depenses_espace_mois on depenses (espace_id, cree_le);

create table if not exists videos_reseau (
  id uuid primary key default gen_random_uuid(),
  reseau_connecte_id uuid not null references reseaux_connectes(id) on delete cascade,
  id_externe text not null,
  publication_id uuid references publications(id) on delete set null,
  titre text not null default '',
  url text,
  miniature_url text,
  publiee_le timestamptz,
  duree_s numeric,
  vues bigint not null default 0,
  jaime bigint not null default 0,
  commentaires bigint not null default 0,
  partages bigint not null default 0,
  revenu_estime numeric(12,2),
  devise text,
  maj_le timestamptz not null default now(),
  unique (reseau_connecte_id, id_externe)
);
create index if not exists videos_reseau_vues on videos_reseau (reseau_connecte_id, vues desc);

create table if not exists stats_comptes (
  id uuid primary key default gen_random_uuid(),
  reseau_connecte_id uuid not null references reseaux_connectes(id) on delete cascade,
  jour date not null,
  abonnes bigint,
  abonnements bigint,
  jaime_total bigint,
  videos bigint,
  vues_total bigint,
  revenu_estime numeric(12,2),
  devise text,
  unique (reseau_connecte_id, jour)
);

create table if not exists revenus (
  id uuid primary key default gen_random_uuid(),
  reseau_connecte_id uuid not null references reseaux_connectes(id) on delete cascade,
  mois date not null check (extract(day from mois) = 1),
  montant numeric(12,2) not null check (montant >= 0),
  devise text not null default 'EUR' check (devise ~ '^[A-Z]{3}$'),
  source text not null check (source in ('api','manuel')),
  note text not null default '',
  cree_le timestamptz not null default now(),
  unique (reseau_connecte_id, mois, source)
);

-- ---------- Déclencheurs : journal des dépenses et cohérence des liens ----------
create or replace function journaliser_depense() returns trigger language plpgsql as $$
begin
  if new.cout > 0 then
    insert into depenses (espace_id, fichier_id, genre, montant, cree_le) values (new.espace_id, new.id, new.genre, new.cout, new.cree_le);
  end if;
  return new;
end $$;
drop trigger if exists fichiers_depense on fichiers;
create trigger fichiers_depense after insert on fichiers for each row execute function journaliser_depense();

create or replace function espace_de_serie(s uuid) returns uuid language sql stable as $$
  select espace_id from series where id = s;
$$;

create or replace function verifier_personnage() returns trigger language plpgsql as $$
begin
  if new.fiche_chemin is not null and new.fiche_chemin not like (espace_de_serie(new.serie_id)::text || '/%') then
    raise exception 'Chemin de fiche refusé : il doit appartenir au compte de la série.';
  end if;
  return new;
end $$;
drop trigger if exists personnages_coherence on personnages;
create trigger personnages_coherence before insert or update on personnages for each row execute function verifier_personnage();

create or replace function verifier_episode() returns trigger language plpgsql as $$
declare prefixe text := espace_de_serie(new.serie_id)::text || '/';
declare c text;
begin
  if not exists (select 1 from saisons where id = new.saison_id and serie_id = new.serie_id) then
    raise exception 'La saison doit appartenir à la même série que l''épisode.';
  end if;
  if new.miniature is not null and jsonb_typeof(new.miniature -> 'chemins') = 'array' then
    for c in select jsonb_array_elements_text(new.miniature -> 'chemins') loop
      if c not like prefixe || '%' then
        raise exception 'Chemin de miniature refusé : il doit appartenir au compte de la série.';
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists episodes_coherence on episodes;
create trigger episodes_coherence before insert or update on episodes for each row execute function verifier_episode();

create or replace function verifier_saison() returns trigger language plpgsql as $$
begin
  if new.opening_id is not null and not exists (select 1 from episodes where id = new.opening_id and serie_id = new.serie_id) then
    raise exception 'L''opening doit être un épisode de la même série.';
  end if;
  if new.ending_id is not null and not exists (select 1 from episodes where id = new.ending_id and serie_id = new.serie_id) then
    raise exception 'L''ending doit être un épisode de la même série.';
  end if;
  return new;
end $$;
drop trigger if exists saisons_coherence on saisons;
create trigger saisons_coherence before update on saisons for each row execute function verifier_saison();

create or replace function verifier_plan() returns trigger language plpgsql as $$
begin
  if new.personnage_id is not null and not exists (
    select 1 from personnages p join episodes e on e.serie_id = p.serie_id where p.id = new.personnage_id and e.id = new.episode_id) then
    raise exception 'Le personnage doit appartenir à la série de l''épisode.';
  end if;
  return new;
end $$;
drop trigger if exists plans_coherence on plans;
create trigger plans_coherence before insert or update on plans for each row execute function verifier_plan();
`;

/** Version 2 : bibliothèque, scènes, plans détaillés, versions des fichiers, arc de saison, double authentification. */
const V2 = `
create table if not exists elements (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references espaces(id) on delete cascade,
  serie_id uuid references series(id) on delete cascade,
  genre text not null check (genre in ('decor','activite','marque','son','variante')),
  nom text not null check (length(nom) between 1 and 120),
  description text not null default '' check (length(description) <= 4000),
  moment text not null default '',
  consigne text not null default '' check (length(consigne) <= 2000),
  personnage_id uuid references personnages(id) on delete cascade,
  couleurs jsonb not null default '{}',
  position int not null default 0,
  cree_le timestamptz not null default now(),
  check (genre <> 'variante' or personnage_id is not null)
);
create index if not exists elements_espace on elements (espace_id, genre);

create or replace function verifier_element() returns trigger language plpgsql as $$
begin
  if new.serie_id is not null and not exists (select 1 from series where id = new.serie_id and espace_id = new.espace_id) then
    raise exception 'La série de l''élément doit appartenir au même compte.';
  end if;
  if new.personnage_id is not null and not exists (select 1 from personnages p join series s on s.id = p.serie_id where p.id = new.personnage_id and s.espace_id = new.espace_id) then
    raise exception 'Le personnage de la variante doit appartenir au même compte.';
  end if;
  return new;
end $$;
drop trigger if exists elements_coherence on elements;
create trigger elements_coherence before insert or update on elements for each row execute function verifier_element();

create table if not exists scenes (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  position int not null default 0,
  titre text not null default '',
  lieu_id uuid references elements(id) on delete set null,
  moment text not null default '',
  resume text not null default '',
  personnages jsonb not null default '[]' check (jsonb_typeof(personnages) = 'array')
);
create index if not exists scenes_episode on scenes (episode_id, position);

create or replace function element_du_compte_episode(el uuid, ep uuid) returns boolean language sql stable as $$
  select exists (select 1 from elements x join series s on s.espace_id = x.espace_id join episodes e on e.serie_id = s.id where x.id = el and e.id = ep);
$$;
create or replace function verifier_scene() returns trigger language plpgsql as $$
begin
  if new.lieu_id is not null and not element_du_compte_episode(new.lieu_id, new.episode_id) then
    raise exception 'Le lieu doit appartenir au compte de la série.';
  end if;
  return new;
end $$;
drop trigger if exists scenes_coherence on scenes;
create trigger scenes_coherence before insert or update on scenes for each row execute function verifier_scene();

alter table plans add column if not exists scene_id uuid references scenes(id) on delete set null;
alter table plans add column if not exists duree numeric(6,3) check (duree is null or (duree >= 1 and duree <= 15));
alter table plans add column if not exists decor_id uuid references elements(id) on delete set null;
alter table plans add column if not exists activite_id uuid references elements(id) on delete set null;
alter table plans add column if not exists personnages jsonb not null default '[]' check (jsonb_typeof(personnages) = 'array');
alter table plans add column if not exists variantes jsonb not null default '[]' check (jsonb_typeof(variantes) = 'array');
alter table plans add column if not exists cadrage text not null default '';
alter table plans add column if not exists mouvement text not null default '';
alter table plans add column if not exists transition text not null default 'coupe' check (transition in ('coupe','fondu','flash'));
alter table plans add column if not exists effet text not null default 'aucun' check (effet in ('aucun','zoom','tremblement','ralenti'));
alter table plans add column if not exists texte_ecran text not null default '';
alter table plans add column if not exists son text not null default '';
alter table plans add column if not exists commentaires jsonb not null default '[]' check (jsonb_typeof(commentaires) = 'array');

create or replace function verifier_plan() returns trigger language plpgsql as $$
begin
  if new.personnage_id is not null and not exists (
    select 1 from personnages p join episodes e on e.serie_id = p.serie_id where p.id = new.personnage_id and e.id = new.episode_id) then
    raise exception 'Le personnage doit appartenir à la série de l''épisode.';
  end if;
  if new.scene_id is not null and not exists (select 1 from scenes where id = new.scene_id and episode_id = new.episode_id) then
    raise exception 'La scène doit appartenir au même épisode que le plan.';
  end if;
  if (new.decor_id is not null and not element_du_compte_episode(new.decor_id, new.episode_id))
     or (new.activite_id is not null and not element_du_compte_episode(new.activite_id, new.episode_id)) then
    raise exception 'Le décor ou l''activité doit appartenir au compte de la série.';
  end if;
  return new;
end $$;

alter table saisons add column if not exists titre text not null default '';
alter table saisons add column if not exists arc text not null default '' check (length(arc) <= 20000);
alter table saisons add column if not exists nombre_episodes int check (nombre_episodes is null or nombre_episodes between 1 and 30);

alter table episodes add column if not exists accroche text not null default '';
alter table episodes add column if not exists deroule text not null default '' check (length(deroule) <= 20000);
alter table episodes add column if not exists fin_suite text not null default '';
alter table episodes add column if not exists rappel boolean not null default true;
alter table episodes add column if not exists logo boolean not null default true;
alter table episodes add column if not exists carte_fin boolean not null default true;
alter table episodes add column if not exists scenario_valide boolean not null default false;
alter table episodes add column if not exists video_validee boolean not null default false;

alter table utilisateurs add column if not exists totp_chiffre text;
alter table utilisateurs add column if not exists totp_actif boolean not null default false;

alter table fichiers drop constraint if exists fichiers_genre_check;
alter table fichiers add constraint fichiers_genre_check check (genre in ('image','clip','voix','rendu','bande_annonce','miniature','fiche','bruitage','musique','echantillon_voix','chanson','reference'));
alter table fichiers add column if not exists element_id uuid references elements(id) on delete cascade;
alter table fichiers add column if not exists actif_le timestamptz;
alter table fichiers add column if not exists consigne text not null default '';
alter table fichiers add column if not exists fournisseur text not null default '';
alter table fichiers add column if not exists controle jsonb;
alter table fichiers add column if not exists personne_reelle boolean not null default false;
alter table fichiers add column if not exists accord_image boolean not null default false;
alter table fichiers add column if not exists nom_origine text not null default '';
alter table fichiers drop constraint if exists fichiers_accord_check;
alter table fichiers add constraint fichiers_accord_check check (not personne_reelle or accord_image);
create index if not exists fichiers_element on fichiers (element_id);
create index if not exists fichiers_personnage on fichiers (personnage_id, genre);
`;

/** Migrations PostgreSQL, dans l'ordre (mêmes numéros que SQLite). */
export const MIGRATIONS_POSTGRES: readonly { version: number; nom: string; sql: string }[] = [
  { version: 1, nom: "schéma initial", sql: V1 },
  { version: 2, nom: "bibliothèque, scènes, versions, double authentification", sql: V2 },
];
