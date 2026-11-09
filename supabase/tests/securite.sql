\set ON_ERROR_STOP 0
\pset tuples_only on
-- Deux utilisateurs A et B
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
-- Fonction d'aide : agir comme un utilisateur connecté
create or replace function pg_temp.comme(u text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', u, false); perform set_config('request.jwt.claim.role', 'authenticated', false); end $$;

select pg_temp.comme('00000000-0000-0000-0000-00000000000a');
set role authenticated;
insert into espaces (nom) values ('Studio A') returning 'A crée son espace : ' || nom;
insert into series (espace_id, nom) select id, 'Renard' from espaces returning 'A crée une série : ' || nom;
insert into saisons (serie_id, numero) select id, 1 from series;
insert into episodes (serie_id, saison_id, titre) select s.id, sa.id, 'Ep1' from series s join saisons sa on sa.serie_id = s.id returning 'A crée un épisode';
insert into plans (episode_id, position, type, texte) select id, 0, 'accroche', 'x' from episodes returning 'A crée un plan';
-- Interdits pour A depuis le navigateur
insert into taches (espace_id, type) select id, 'storyboard' from espaces; -- doit échouer (lecture seule)
insert into fichiers (espace_id, genre) select id, 'image' from espaces; -- doit échouer
insert into cles_api (fournisseur, valeur_chiffree, apercu) values ('openai', 'x', '1234'); -- doit échouer
reset role;

-- Le serveur (service_role) écrit une clé et un fichier payant pour A
set role service_role;
insert into cles_api (proprietaire, fournisseur, valeur_chiffree, apercu) values ('00000000-0000-0000-0000-00000000000a', 'openai', 'v1.secret', 'abcd');
insert into fichiers (espace_id, genre, cout) select id, 'image', 0.04 from espaces;
insert into reseaux_connectes (espace_id, reseau, nom_compte, jeton_acces_chiffre) select id, 'tiktok', '@a', 'v1.jeton' from espaces;
reset role;

select pg_temp.comme('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select 'A lit l''aperçu de sa clé : ' || apercu from cles_api;
select valeur_chiffree from cles_api; -- doit échouer (colonne interdite)
select jeton_acces_chiffre from reseaux_connectes; -- doit échouer
select 'A voit son réseau : ' || nom_compte from reseaux_connectes;
select 'Dépense du mois de A : ' || depense_du_mois(id) from espaces;
reset role;

-- B ne voit rien de A
select pg_temp.comme('00000000-0000-0000-0000-00000000000b');
set role authenticated;
select 'B voit espaces=' || (select count(*) from espaces) || ' séries=' || (select count(*) from series) || ' épisodes=' || (select count(*) from episodes) || ' plans=' || (select count(*) from plans) || ' fichiers=' || (select count(*) from fichiers) || ' réseaux=' || (select count(*) from reseaux_connectes);
select 'Dépense de A vue par B : ' || depense_du_mois((select id from espaces limit 1));
select 'Dépense de A vue par B (id direct) : ' || depense_du_mois(e.id) from (select id from public.espaces) e;
update series set nom = 'pirate'; select 'B a modifié ' || count(*) || ' série(s) de A' from series where nom = 'pirate';
reset role;
set role postgres;
select 'Dépense de A demandée par B avec son id : ' || (select public.depense_du_mois(id) from espaces) as test_direct
  from (select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false), set_config('request.jwt.claim.role', 'authenticated', false)) x;
reset role;

-- File de tâches : le worker prend une tâche, pas deux fois ; doublons bloqués
set role service_role;
select set_config('request.jwt.claim.role', 'service_role', false);
insert into taches (espace_id, episode_id, type) select e.id, ep.id, 'storyboard' from espaces e, episodes ep;
insert into taches (espace_id, episode_id, type) select e.id, ep.id, 'storyboard' from espaces e, episodes ep; -- doit échouer (doublon)
select 'Worker 1 prend : ' || type from prendre_tache('w1', null);
select 'Worker 2 prend : ' || coalesce((select type from prendre_tache('w2', null)), 'rien (déjà prise)');
select 'Dépense vue par le worker : ' || depense_du_mois(id) from espaces;
-- Le coût reste après suppression du fichier
delete from fichiers;
select 'Dépense après suppression du fichier : ' || depense_du_mois(id) from espaces;
reset role;
-- Un utilisateur ne peut pas appeler prendre_tache
select pg_temp.comme('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select * from prendre_tache('pirate', null); -- doit échouer
reset role;
