-- Deux corrections :
-- 1. Une seule tâche active d'un même type par épisode (deux clics rapides ne lancent pas deux générations payantes).
-- 2. La dépense du mois n'est lisible que pour ses propres espaces (le worker, en service_role, garde l'accès).

create unique index if not exists taches_episode_type_actif
  on public.taches (episode_id, type)
  where episode_id is not null and type not in ('publication', 'stats') and statut in ('en_file', 'en_cours', 'en_pause');

create or replace function public.depense_du_mois(e uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(montant), 0) from public.depenses
   where espace_id = e
     and cree_le >= date_trunc('month', now())
     and (auth.role() = 'service_role' or public.espace_a_moi(e));
$$;
