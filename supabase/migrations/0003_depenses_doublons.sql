-- Deux protections :
-- 1. Les dépenses sont gardées dans un journal : supprimer un plan ou un fichier n'efface plus ce qu'il a coûté.
-- 2. Une publication ne peut avoir qu'une seule tâche active (pas de double envoi si deux workers tournent).

-- ---------- Journal des dépenses ----------
create table if not exists public.depenses (
  id uuid primary key default gen_random_uuid(),
  espace_id uuid not null references public.espaces(id) on delete cascade,
  fichier_id uuid,
  genre text not null,
  montant numeric(10,4) not null check (montant >= 0),
  cree_le timestamptz not null default now()
);
create index if not exists depenses_espace_mois on public.depenses (espace_id, cree_le);

alter table public.depenses enable row level security;
drop policy if exists p_depenses on public.depenses;
create policy p_depenses on public.depenses for select to authenticated using (public.espace_a_moi(espace_id));

-- Chaque fichier généré avec un coût inscrit sa dépense ; la ligne reste même si le fichier est supprimé ensuite.
create or replace function public.journaliser_depense() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cout > 0 then
    insert into public.depenses (espace_id, fichier_id, genre, montant, cree_le)
    values (new.espace_id, new.id, new.genre, new.cout, new.cree_le);
  end if;
  return new;
end $$;

drop trigger if exists fichiers_depense on public.fichiers;
create trigger fichiers_depense after insert on public.fichiers
for each row execute function public.journaliser_depense();

-- Reprise des fichiers déjà présents (au cas où cette migration arrive après les premiers tests).
insert into public.depenses (espace_id, fichier_id, genre, montant, cree_le)
select f.espace_id, f.id, f.genre, f.cout, f.cree_le
  from public.fichiers f
 where f.cout > 0 and not exists (select 1 from public.depenses d where d.fichier_id = f.id);

-- La dépense du mois se lit désormais dans le journal.
create or replace function public.depense_du_mois(e uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(montant), 0) from public.depenses
   where espace_id = e and cree_le >= date_trunc('month', now());
$$;

-- ---------- Une seule tâche active par publication ----------
create unique index if not exists taches_publication_active
  on public.taches (publication_id)
  where publication_id is not null and statut in ('en_file', 'en_cours', 'en_pause');
