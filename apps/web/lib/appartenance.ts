// Vérifications d'appartenance : chaque objet est relu avec le client de l'utilisateur (RLS).
// S'il revient, il est à lui ; ces fonctions sont appelées AVANT toute écriture en service_role.
import "server-only";
import type { Episode, Espace, Personnage, Plan, Publication, ReseauConnecte, Saison, Serie } from "@feuilleton/core";
import { ErreurUtilisateur } from "./erreurs";
import { ligne, ligneEpisode, ligneEspace, lignePersonnage, lignePlan, lignePublication, ligneReseau, ligneSaison, ligneSerie } from "./lignes";
import { utilisateur } from "./session";

/** Message commun : on ne dit pas si l'objet existe chez quelqu'un d'autre. */
const INTROUVABLE = "Élément introuvable.";

/** Espace de l'utilisateur. */
export async function espaceAMoi(espaceId: string): Promise<Espace> {
  const { supabase } = await utilisateur();
  const { data } = await supabase.from("espaces").select("*").eq("id", espaceId).maybeSingle();
  const e = ligne(ligneEspace, data);
  if (!e) throw new ErreurUtilisateur(INTROUVABLE);
  return e;
}

/** Série de l'utilisateur. */
export async function serieAMoi(serieId: string): Promise<Serie> {
  const { supabase } = await utilisateur();
  const { data } = await supabase.from("series").select("*").eq("id", serieId).maybeSingle();
  const s = ligne(ligneSerie, data);
  if (!s) throw new ErreurUtilisateur(INTROUVABLE);
  return s;
}

/** Saison de l'utilisateur, avec sa série. */
export async function saisonAMoi(saisonId: string): Promise<{ saison: Saison; serie: Serie }> {
  const { supabase } = await utilisateur();
  const { data } = await supabase.from("saisons").select("*").eq("id", saisonId).maybeSingle();
  const saison = ligne(ligneSaison, data);
  if (!saison) throw new ErreurUtilisateur(INTROUVABLE);
  return { saison, serie: await serieAMoi(saison.serie_id) };
}

/** Épisode de l'utilisateur, avec sa série. */
export async function episodeAMoi(episodeId: string): Promise<{ episode: Episode; serie: Serie }> {
  const { supabase } = await utilisateur();
  const { data } = await supabase.from("episodes").select("*").eq("id", episodeId).maybeSingle();
  const episode = ligne(ligneEpisode, data);
  if (!episode) throw new ErreurUtilisateur(INTROUVABLE);
  return { episode, serie: await serieAMoi(episode.serie_id) };
}

/** Plan de l'utilisateur, avec son épisode et sa série. */
export async function planAMoi(planId: string): Promise<{ plan: Plan; episode: Episode; serie: Serie }> {
  const { supabase } = await utilisateur();
  const { data } = await supabase.from("plans").select("*").eq("id", planId).maybeSingle();
  const plan = ligne(lignePlan, data);
  if (!plan) throw new ErreurUtilisateur(INTROUVABLE);
  return { plan, ...(await episodeAMoi(plan.episode_id)) };
}

/** Personnage de l'utilisateur, avec sa série. */
export async function personnageAMoi(personnageId: string): Promise<{ personnage: Personnage; serie: Serie }> {
  const { supabase } = await utilisateur();
  const { data } = await supabase.from("personnages").select("*").eq("id", personnageId).maybeSingle();
  const personnage = ligne(lignePersonnage, data);
  if (!personnage) throw new ErreurUtilisateur(INTROUVABLE);
  return { personnage, serie: await serieAMoi(personnage.serie_id) };
}

/** Publication de l'utilisateur, avec son épisode et sa série. */
export async function publicationAMoi(publicationId: string): Promise<{ publication: Publication; episode: Episode; serie: Serie }> {
  const { supabase } = await utilisateur();
  const { data } = await supabase.from("publications").select("*").eq("id", publicationId).maybeSingle();
  const publication = ligne(lignePublication, data);
  if (!publication) throw new ErreurUtilisateur(INTROUVABLE);
  return { publication, ...(await episodeAMoi(publication.episode_id)) };
}

/** Colonnes de reseaux_connectes lisibles par l'utilisateur (les jetons chiffrés ne le sont pas). */
export const COLONNES_RESEAU = "id, espace_id, reseau, nom_compte, langue, id_externe, jeton_expire_le, statut, audit_tiktok_valide, infos, cree_le";

/** Compte de réseau connecté de l'utilisateur. */
export async function reseauAMoi(reseauId: string): Promise<ReseauConnecte> {
  const { supabase } = await utilisateur();
  const { data } = await supabase.from("reseaux_connectes").select(COLONNES_RESEAU).eq("id", reseauId).maybeSingle();
  const r = ligne(ligneReseau, data);
  if (!r) throw new ErreurUtilisateur(INTROUVABLE);
  return r;
}
