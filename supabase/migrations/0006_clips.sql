-- Espace Clips : des clips musicaux montés sur une chanson importée ou générée.
-- Un clip est un épisode de genre « clip » rangé dans la série « clips » de l'espace (une par espace).
-- Ses plans portent leur début et leur fin dans la chanson : la vidéo suit les paroles et la musique.

-- ---------- Séries : série d'histoires ou espace Clips ----------
alter table public.series add column if not exists genre text not null default 'serie';
alter table public.series drop constraint if exists series_genre_check;
alter table public.series add constraint series_genre_check check (genre in ('serie', 'clips'));
-- Un seul espace Clips par compte.
create unique index if not exists series_clips_unique on public.series (espace_id) where genre = 'clips';

-- ---------- Épisodes : genre « clip » et champs de la chanson ----------
alter table public.episodes drop constraint if exists episodes_genre_check;
alter table public.episodes add constraint episodes_genre_check check (genre in ('episode', 'opening', 'ending', 'clip'));

alter table public.episodes
  add column if not exists style_visuel text not null default '',
  add column if not exists paroles text not null default '',
  add column if not exists paroles_alignees jsonb,
  add column if not exists paroles_traduites jsonb not null default '{}',
  add column if not exists bpm numeric(6,2),
  add column if not exists extrait_debut numeric(8,3) not null default 0,
  add column if not exists extrait_fin numeric(8,3),
  add column if not exists musique_style text not null default '',
  add column if not exists instrumental boolean not null default false,
  add column if not exists fournisseur_texte text not null default 'openai';

alter table public.episodes drop constraint if exists episodes_fournisseur_texte_check;
alter table public.episodes add constraint episodes_fournisseur_texte_check check (fournisseur_texte in ('openai', 'anthropic'));
alter table public.episodes drop constraint if exists episodes_bpm_check;
alter table public.episodes add constraint episodes_bpm_check check (bpm is null or bpm between 40 and 240);
alter table public.episodes drop constraint if exists episodes_extrait_check;
alter table public.episodes add constraint episodes_extrait_check
  check (extrait_debut >= 0 and (extrait_fin is null or (extrait_fin > extrait_debut and extrait_fin - extrait_debut <= 600)));
alter table public.episodes drop constraint if exists episodes_paroles_check;
alter table public.episodes add constraint episodes_paroles_check check (char_length(paroles) <= 20000);
alter table public.episodes drop constraint if exists episodes_paroles_alignees_check;
alter table public.episodes add constraint episodes_paroles_alignees_check
  check (paroles_alignees is null or jsonb_typeof(paroles_alignees) = 'array');

-- ---------- Plans : début et fin dans la chanson (secondes), pour les clips ----------
alter table public.plans
  add column if not exists debut numeric(8,3),
  add column if not exists fin numeric(8,3);
alter table public.plans drop constraint if exists plans_debut_fin_check;
alter table public.plans add constraint plans_debut_fin_check
  check ((debut is null and fin is null) or (debut >= 0 and fin > debut and fin - debut <= 15.5));

-- ---------- Fichiers : la chanson du clip ----------
alter table public.fichiers drop constraint if exists fichiers_genre_check;
alter table public.fichiers add constraint fichiers_genre_check
  check (genre in ('image','clip','voix','rendu','bande_annonce','miniature','fiche','bruitage','musique','echantillon_voix','chanson'));

-- ---------- Tâches : paroles, musique, synchronisation ----------
alter table public.taches drop constraint if exists taches_type_check;
alter table public.taches add constraint taches_type_check
  check (type in ('scenario','storyboard','clips','rendu','publication','stats','fiche_personnage','memoire','clone_voix','test_complet','paroles','musique','synchro'));

-- ---------- Clés : Claude (Anthropic) pour écrire scènes et paroles ----------
alter table public.cles_api drop constraint if exists cles_api_fournisseur_check;
alter table public.cles_api add constraint cles_api_fournisseur_check
  check (fournisseur in ('openai','xai','elevenlabs','google','meta','tiktok','anthropic'));

-- ---------- Tarif d'exemple de la musique générée (à remplacer par le tien) ----------
alter table public.reglages alter column tarifs set default '{"image":0.07,"video_seconde":0.05,"voix_1000_car":0.30,"musique_minute":0.50}';
