-- Corrections issues de la relecture de sécurité et nouveau format « YouTube » (2 à 4 min, 16:9).

-- ---------- Format « moyen » : épisode YouTube de 2:00 à 4:00 ----------
alter table public.episodes drop constraint if exists episodes_format_check;
alter table public.episodes add constraint episodes_format_check check (format in ('court', 'moyen', 'long'));

-- Tarif d'image par défaut aligné sur une image en qualité moyenne (valeur d'exemple, à remplacer par la tienne).
alter table public.reglages alter column tarifs set default '{"image":0.07,"video_seconde":0.05,"voix_1000_car":0.30}';

-- ---------- Tâches bloquées : 3 essais au plus, jamais de relance sans fin ----------
-- Le worker rafraîchit le verrou des tâches en cours toutes les 30 s : seule une tâche vraiment abandonnée
-- (worker arrêté ou planté) dépasse 30 min. Au-delà de 3 essais, elle passe en échec au lieu d'être relancée.
create or replace function public.liberer_taches_bloquees() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.taches
     set statut = 'echec', erreur = 'Abandonnée après 3 essais : le worker s''est arrêté pendant cette tâche. Relance-la à la main si besoin.',
         verrouille_par = null, verrouille_le = null, modifie_le = now()
   where statut = 'en_cours' and verrouille_le < now() - interval '30 minutes' and essais >= 3;
  update public.taches
     set statut = 'en_file', verrouille_par = null, verrouille_le = null, modifie_le = now()
   where statut = 'en_cours' and verrouille_le < now() - interval '30 minutes' and essais < 3;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.liberer_taches_bloquees() from public, anon, authenticated;

-- ---------- Une publication ne vise que les comptes réseau de l'utilisateur ----------
drop policy if exists p_publications on public.publications;
create policy p_publications on public.publications for all to authenticated
  using (public.episode_a_moi(episode_id) and public.reseau_a_moi(reseau_connecte_id))
  with check (public.episode_a_moi(episode_id) and public.reseau_a_moi(reseau_connecte_id));

-- ---------- Cohérence des liens et des chemins de fichiers ----------
-- Ces colonnes sont modifiables par l'utilisateur mais lues par le worker avec la clé service_role :
-- on vérifie qu'elles ne désignent jamais l'objet ou le fichier d'un autre espace.

/** Espace d'une série. */
create or replace function public.espace_de_serie(s uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select espace_id from public.series where id = s;
$$;

create or replace function public.verifier_personnage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fiche_chemin is not null and new.fiche_chemin not like (public.espace_de_serie(new.serie_id)::text || '/%') then
    raise exception 'Chemin de fiche refusé : il doit appartenir au compte de la série.';
  end if;
  return new;
end $$;
drop trigger if exists personnages_coherence on public.personnages;
create trigger personnages_coherence before insert or update on public.personnages
for each row execute function public.verifier_personnage();

create or replace function public.verifier_episode() returns trigger
language plpgsql security definer set search_path = public as $$
declare prefixe text := public.espace_de_serie(new.serie_id)::text || '/';
declare c text;
begin
  if not exists (select 1 from public.saisons where id = new.saison_id and serie_id = new.serie_id) then
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
drop trigger if exists episodes_coherence on public.episodes;
create trigger episodes_coherence before insert or update on public.episodes
for each row execute function public.verifier_episode();

create or replace function public.verifier_saison() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.opening_id is not null and not exists (select 1 from public.episodes where id = new.opening_id and serie_id = new.serie_id) then
    raise exception 'L''opening doit être un épisode de la même série.';
  end if;
  if new.ending_id is not null and not exists (select 1 from public.episodes where id = new.ending_id and serie_id = new.serie_id) then
    raise exception 'L''ending doit être un épisode de la même série.';
  end if;
  return new;
end $$;
drop trigger if exists saisons_coherence on public.saisons;
create trigger saisons_coherence before insert or update on public.saisons
for each row execute function public.verifier_saison();

create or replace function public.verifier_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.personnage_id is not null and not exists (
    select 1 from public.personnages p join public.episodes e on e.serie_id = p.serie_id
     where p.id = new.personnage_id and e.id = new.episode_id) then
    raise exception 'Le personnage doit appartenir à la série de l''épisode.';
  end if;
  return new;
end $$;
drop trigger if exists plans_coherence on public.plans;
create trigger plans_coherence before insert or update on public.plans
for each row execute function public.verifier_plan();

-- ---------- Pas de double génération payante par double clic (tâches sans épisode) ----------
create unique index if not exists taches_personnage_actif
  on public.taches ((donnees ->> 'personnage_id'), type)
  where type in ('fiche_personnage', 'clone_voix') and statut in ('en_file', 'en_cours', 'en_pause');
create unique index if not exists taches_test_complet_actif
  on public.taches (espace_id)
  where type = 'test_complet' and statut in ('en_file', 'en_cours', 'en_pause');
