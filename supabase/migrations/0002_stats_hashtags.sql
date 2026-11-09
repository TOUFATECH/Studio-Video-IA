-- Hashtags par réseau, toutes les vidéos des comptes (publiées par l'app ou non),
-- historique des abonnés et des vues, revenus (API YouTube ou saisie manuelle pour TikTok et Instagram).

-- ---------- Hashtags par réseau : défaut de la série, surcharge possible par épisode ----------
-- Forme : {"tiktok": "#a #b", "instagram": "#a #c", "youtube": "#a"}
alter table public.series add column if not exists hashtags jsonb not null default '{}';
alter table public.episodes add column if not exists hashtags jsonb not null default '{}';

-- ---------- Appartenance d'un réseau connecté (pour les règles RLS) ----------
create or replace function public.reseau_a_moi(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.reseaux_connectes x join public.espaces e on e.id = x.espace_id where x.id = r and e.proprietaire = auth.uid());
$$;

-- ---------- Vidéos présentes sur chaque compte connecté ----------
create table if not exists public.videos_reseau (
  id uuid primary key default gen_random_uuid(),
  reseau_connecte_id uuid not null references public.reseaux_connectes(id) on delete cascade,
  id_externe text not null,
  publication_id uuid references public.publications(id) on delete set null,
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
create index if not exists videos_reseau_vues on public.videos_reseau (reseau_connecte_id, vues desc);

-- ---------- Chiffres d'un compte jour par jour (courbes d'abonnés et de vues) ----------
create table if not exists public.stats_comptes (
  id uuid primary key default gen_random_uuid(),
  reseau_connecte_id uuid not null references public.reseaux_connectes(id) on delete cascade,
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

-- ---------- Revenus par mois : API YouTube ou saisie manuelle (TikTok, Instagram n'ont pas d'API de revenus) ----------
create table if not exists public.revenus (
  id uuid primary key default gen_random_uuid(),
  reseau_connecte_id uuid not null references public.reseaux_connectes(id) on delete cascade,
  mois date not null check (extract(day from mois) = 1),
  montant numeric(12,2) not null check (montant >= 0),
  devise text not null default 'EUR' check (devise ~ '^[A-Z]{3}$'),
  source text not null check (source in ('api','manuel')),
  note text not null default '',
  cree_le timestamptz not null default now(),
  unique (reseau_connecte_id, mois, source)
);

alter table public.videos_reseau enable row level security;
alter table public.stats_comptes enable row level security;
alter table public.revenus enable row level security;

drop policy if exists p_videos_reseau on public.videos_reseau;
create policy p_videos_reseau on public.videos_reseau for select to authenticated using (public.reseau_a_moi(reseau_connecte_id));
drop policy if exists p_stats_comptes on public.stats_comptes;
create policy p_stats_comptes on public.stats_comptes for select to authenticated using (public.reseau_a_moi(reseau_connecte_id));
-- Les revenus manuels se saisissent depuis l'app ; les revenus « api » sont écrits par le worker (service_role).
drop policy if exists p_revenus_lecture on public.revenus;
create policy p_revenus_lecture on public.revenus for select to authenticated using (public.reseau_a_moi(reseau_connecte_id));
drop policy if exists p_revenus_manuels on public.revenus;
create policy p_revenus_manuels on public.revenus for all to authenticated
  using (public.reseau_a_moi(reseau_connecte_id) and source = 'manuel')
  with check (public.reseau_a_moi(reseau_connecte_id) and source = 'manuel');
