-- Schéma de Feuilleton : espaces (comptes), réseaux connectés, séries, épisodes, plans,
-- fichiers générés, file de tâches du worker, publications, mémoire des séries.
-- Sécurité : chaque ligne appartient à un utilisateur via son espace (RLS).
-- Les jetons et clés chiffrés ne sont jamais lisibles par le navigateur (droits de colonnes).

create extension if not exists pgcrypto;

-- ---------- Espaces (les « comptes » de l'interface) ----------
create table if not exists public.espaces (
  id uuid primary key default gen_random_uuid(),
  proprietaire uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nom text not null check (char_length(nom) between 1 and 80),
  couleur text not null default '#FF6A3D' check (couleur ~ '^#[0-9A-Fa-f]{6}$'),
  plafond_mensuel numeric(10,2) not null default 50 check (plafond_mensuel >= 0),
  fuseau text not null default 'Indian/Mayotte',
  cree_le timestamptz not null default now()
);
create index if not exists espaces_proprietaire on public.espaces (proprietaire);

-- ---------- Réglages de l'utilisateur (tarifs, préférences) ----------
create table if not exists public.reglages (
  proprietaire uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  tarifs jsonb not null default '{"image":0.04,"video_seconde":0.05,"voix_1000_car":0.30}',
  preferences jsonb not null default '{"parallele":2,"sous_titres":"aucun","prises":1,"memoire_auto":true}',
  modifie_le timestamptz not null default now()
);

-- ---------- Clés API (chiffrées AES-256-GCM par le serveur) ----------
create table if not exists public.cles_api (
  proprietaire uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fournisseur text not null check (fournisseur in ('openai','xai','elevenlabs','google','meta','tiktok')),
  valeur_chiffree text not null,
  apercu text not null,
  modifie_le timestamptz not null default now(),
  primary key (proprietaire, fournisseur)
);

-- ---------- Réseaux connectés (TikTok, Instagram, YouTube) ----------
create table if not exists public.reseaux_connectes (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references public.espaces(id) on delete cascade,
  reseau text not null check (reseau in ('tiktok','instagram','youtube')),
  nom_compte text not null,
  langue text not null default 'fr' check (langue in ('fr','en','ja','ko','pt')),
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

-- ---------- Séries, personnages, saisons ----------
create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references public.espaces(id) on delete cascade,
  nom text not null check (char_length(nom) between 1 and 120),
  style_visuel text not null default 'Cinématique',
  langue text not null default 'fr' check (langue in ('fr','en','ja','ko','pt')),
  univers text not null default '',
  fil_rouge text not null default '',
  rythme jsonb not null default '{"tous_les_jours":2,"heure":"18:00","reseaux":[],"auto":false}',
  cree_le timestamptz not null default now()
);

create table if not exists public.personnages (
  id uuid primary key default gen_random_uuid(),
  serie_id uuid not null references public.series(id) on delete cascade,
  nom text not null,
  description text not null default '',
  source_voix text not null default 'elevenlabs' check (source_voix in ('elevenlabs','elevenlabs_clone','grok')),
  voix_id text not null default '',
  accord_clone boolean not null default false,
  fiche_chemin text,
  fiche_statut text not null default 'a_faire' check (fiche_statut in ('a_faire','en_cours','prete','echec')),
  position int not null default 0,
  -- Une voix clonée n'est utilisable qu'avec l'accord de la personne.
  constraint clone_avec_accord check (source_voix <> 'elevenlabs_clone' or accord_clone)
);

create table if not exists public.saisons (
  id uuid primary key default gen_random_uuid(),
  serie_id uuid not null references public.series(id) on delete cascade,
  numero int not null check (numero >= 1),
  opening_id uuid,
  ending_id uuid,
  unique (serie_id, numero)
);

-- ---------- Épisodes (et génériques) ----------
create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  serie_id uuid not null references public.series(id) on delete cascade,
  saison_id uuid not null references public.saisons(id) on delete cascade,
  genre text not null default 'episode' check (genre in ('episode','opening','ending')),
  numero int not null default 1,
  titre text not null default '',
  idee text not null default '',
  format text not null default 'court' check (format in ('court','long')),
  duree_cible int not null default 75 check (duree_cible between 15 and 1200),
  langue text not null default 'fr' check (langue in ('fr','en','ja','ko','pt')),
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
  cree_le timestamptz not null default now(),
  constraint langue_dans_langues check (langue = any(langues))
);
create index if not exists episodes_saison on public.episodes (saison_id, genre, numero);

alter table public.saisons
  drop constraint if exists saisons_opening_fk,
  add constraint saisons_opening_fk foreign key (opening_id) references public.episodes(id) on delete set null,
  drop constraint if exists saisons_ending_fk,
  add constraint saisons_ending_fk foreign key (ending_id) references public.episodes(id) on delete set null;

-- ---------- Plans du scénario ----------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  position int not null,
  section text not null default 'principal',
  type text not null check (type in ('accroche','action','dialogue','decor','climax','final')),
  texte text not null default '',
  personnage_id uuid references public.personnages(id) on delete set null,
  replique text not null default '',
  repliques_traduites jsonb not null default '{}',
  duree_fixee int check (duree_fixee in (3,5,8,10,15)),
  valide boolean not null default false,
  modifie boolean not null default false,
  prise_choisie text not null default 'A' check (prise_choisie in ('A','B'))
);
create index if not exists plans_episode on public.plans (episode_id, position);

-- ---------- Fichiers générés ou importés (bucket « medias ») ----------
create table if not exists public.fichiers (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references public.espaces(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete cascade,
  personnage_id uuid references public.personnages(id) on delete cascade,
  genre text not null check (genre in ('image','clip','voix','rendu','bande_annonce','miniature','fiche','bruitage','musique','echantillon_voix')),
  langue text check (langue in ('fr','en','ja','ko','pt')),
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
create index if not exists fichiers_episode on public.fichiers (episode_id, genre);
create index if not exists fichiers_espace_mois on public.fichiers (espace_id, cree_le);

-- ---------- File de tâches du worker ----------
create table if not exists public.taches (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references public.espaces(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete cascade,
  publication_id uuid,
  type text not null check (type in ('scenario','storyboard','clips','rendu','publication','stats','fiche_personnage','memoire','clone_voix','test_complet')),
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
create index if not exists taches_file on public.taches (statut, executer_apres, priorite desc, cree_le);
create index if not exists taches_episode on public.taches (episode_id, statut);

-- ---------- Publications ----------
create table if not exists public.publications (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  reseau_connecte_id uuid not null references public.reseaux_connectes(id) on delete cascade,
  langue text not null check (langue in ('fr','en','ja','ko','pt')),
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
create index if not exists publications_dues on public.publications (statut, programmee_le);
alter table public.taches
  drop constraint if exists taches_publication_fk,
  add constraint taches_publication_fk foreign key (publication_id) references public.publications(id) on delete cascade;

-- ---------- Mémoire des séries ----------
create table if not exists public.memoire (
  id uuid primary key default gen_random_uuid(),
  serie_id uuid not null references public.series(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete set null,
  genre text not null check (genre in ('fait','personnage','lieu','objet','mystere')),
  texte text not null,
  ouvert boolean not null default false,
  cree_le timestamptz not null default now()
);

-- ---------- État des workers (battement de cœur, version de ffmpeg) ----------
create table if not exists public.workers_etat (
  nom text primary key,
  vu_le timestamptz not null default now(),
  version_ffmpeg text,
  infos jsonb not null default '{}'
);

-- ---------- Fonctions d'appartenance (utilisées par les règles RLS) ----------
create or replace function public.espace_a_moi(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.espaces where id = e and proprietaire = auth.uid());
$$;
create or replace function public.serie_a_moi(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.series x join public.espaces e on e.id = x.espace_id where x.id = s and e.proprietaire = auth.uid());
$$;
create or replace function public.episode_a_moi(ep uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.episodes x join public.series s on s.id = x.serie_id join public.espaces e on e.id = s.espace_id where x.id = ep and e.proprietaire = auth.uid());
$$;

-- ---------- Règles RLS ----------
alter table public.espaces enable row level security;
alter table public.reglages enable row level security;
alter table public.cles_api enable row level security;
alter table public.reseaux_connectes enable row level security;
alter table public.series enable row level security;
alter table public.personnages enable row level security;
alter table public.saisons enable row level security;
alter table public.episodes enable row level security;
alter table public.plans enable row level security;
alter table public.fichiers enable row level security;
alter table public.taches enable row level security;
alter table public.publications enable row level security;
alter table public.memoire enable row level security;
alter table public.workers_etat enable row level security;

drop policy if exists p_espaces on public.espaces;
create policy p_espaces on public.espaces for all to authenticated using (proprietaire = auth.uid()) with check (proprietaire = auth.uid());
drop policy if exists p_reglages on public.reglages;
create policy p_reglages on public.reglages for all to authenticated using (proprietaire = auth.uid()) with check (proprietaire = auth.uid());
drop policy if exists p_cles_lecture on public.cles_api;
create policy p_cles_lecture on public.cles_api for select to authenticated using (proprietaire = auth.uid());
drop policy if exists p_reseaux on public.reseaux_connectes;
create policy p_reseaux on public.reseaux_connectes for all to authenticated using (public.espace_a_moi(espace_id)) with check (public.espace_a_moi(espace_id));
drop policy if exists p_series on public.series;
create policy p_series on public.series for all to authenticated using (public.espace_a_moi(espace_id)) with check (public.espace_a_moi(espace_id));
drop policy if exists p_personnages on public.personnages;
create policy p_personnages on public.personnages for all to authenticated using (public.serie_a_moi(serie_id)) with check (public.serie_a_moi(serie_id));
drop policy if exists p_saisons on public.saisons;
create policy p_saisons on public.saisons for all to authenticated using (public.serie_a_moi(serie_id)) with check (public.serie_a_moi(serie_id));
drop policy if exists p_episodes on public.episodes;
create policy p_episodes on public.episodes for all to authenticated using (public.serie_a_moi(serie_id)) with check (public.serie_a_moi(serie_id));
drop policy if exists p_plans on public.plans;
create policy p_plans on public.plans for all to authenticated using (public.episode_a_moi(episode_id)) with check (public.episode_a_moi(episode_id));
drop policy if exists p_fichiers on public.fichiers;
create policy p_fichiers on public.fichiers for select to authenticated using (public.espace_a_moi(espace_id));
drop policy if exists p_taches on public.taches;
create policy p_taches on public.taches for select to authenticated using (public.espace_a_moi(espace_id));
drop policy if exists p_publications on public.publications;
create policy p_publications on public.publications for all to authenticated using (public.episode_a_moi(episode_id)) with check (public.episode_a_moi(episode_id));
drop policy if exists p_memoire on public.memoire;
create policy p_memoire on public.memoire for all to authenticated using (public.serie_a_moi(serie_id)) with check (public.serie_a_moi(serie_id));
drop policy if exists p_workers on public.workers_etat;
create policy p_workers on public.workers_etat for select to authenticated using (true);

-- Droits de colonnes : le navigateur ne lit jamais les valeurs chiffrées.
-- Les écritures de clés et de jetons passent par le serveur (clé service_role).
revoke all on public.cles_api from anon, authenticated;
grant select (proprietaire, fournisseur, apercu, modifie_le) on public.cles_api to authenticated;
revoke all on public.reseaux_connectes from anon, authenticated;
grant select (id, espace_id, reseau, nom_compte, langue, id_externe, jeton_expire_le, statut, audit_tiktok_valide, infos, cree_le) on public.reseaux_connectes to authenticated;
grant update (nom_compte, langue, statut) on public.reseaux_connectes to authenticated;
grant delete on public.reseaux_connectes to authenticated;

-- ---------- File de tâches : prise d'une tâche sans conflit entre workers ----------
create or replace function public.prendre_tache(p_worker text, p_types text[] default null)
returns setof public.taches
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.taches t
     set statut = 'en_cours', verrouille_par = p_worker, verrouille_le = now(), essais = t.essais + 1, modifie_le = now()
   where t.id = (
     select id from public.taches
      where statut = 'en_file' and executer_apres <= now()
        and (p_types is null or type = any(p_types))
      order by priorite desc, cree_le
      for update skip locked
      limit 1)
  returning t.*;
end $$;

-- Remet en file les tâches d'un worker arrêté en plein travail (verrou de plus de 30 minutes).
create or replace function public.liberer_taches_bloquees() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.taches set statut = 'en_file', verrouille_par = null, verrouille_le = null, modifie_le = now()
   where statut = 'en_cours' and verrouille_le < now() - interval '30 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

-- Dépense du mois en cours pour un espace (somme des coûts des fichiers générés).
create or replace function public.depense_du_mois(e uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cout), 0) from public.fichiers
   where espace_id = e and cree_le >= date_trunc('month', now());
$$;

revoke execute on function public.prendre_tache(text, text[]) from public, anon, authenticated;
revoke execute on function public.liberer_taches_bloquees() from public, anon, authenticated;

-- ---------- Stockage privé des médias (accès par URL signée générée côté serveur) ----------
insert into storage.buckets (id, name, public)
values ('medias', 'medias', false)
on conflict (id) do nothing;

-- ---------- Temps réel : l'interface suit les tâches, fichiers et publications sans recharger ----------
do $$
begin
  begin alter publication supabase_realtime add table public.taches; exception when others then null; end;
  begin alter publication supabase_realtime add table public.fichiers; exception when others then null; end;
  begin alter publication supabase_realtime add table public.publications; exception when others then null; end;
end $$;
