// Coût estimé d'un lancement (images ou clips) et confirmation au-delà du plafond par épisode.
import "server-only";
import { coutLancement, dureesParPlan, type Episode, type Personnage, type Plan } from "@studio-video-ia/core";
import { ErreurUtilisateur } from "./erreurs";
import { euros } from "./format";
import { lignePersonnage, lignePlan, lignes } from "./lignes";
import { chargerReglages } from "./reglages";
import { utilisateur } from "./session";

/** Plans et personnages d'un épisode (règles d'accès). */
export async function plansEtPersonnages(episode: Pick<Episode, "id" | "serie_id">): Promise<{ plans: Plan[]; personnages: Personnage[] }> {
  const { db } = await utilisateur();
  const [plans, personnages] = await Promise.all([
    db.from("plans").select("*").eq("episode_id", episode.id).order("position").then((x) => lignes(lignePlan, x.data, "plans")),
    db.from("personnages").select("*").eq("serie_id", episode.serie_id).order("position").then((x) => lignes(lignePersonnage, x.data, "personnages")),
  ]);
  return { plans, personnages };
}

/**
 * Coût estimé d'un lancement, avec confirmation obligatoire au-delà du plafond par épisode (réglages).
 * Renvoie le coût formaté pour le message affiché.
 */
export async function verifierCoutLancement(params: { episode: Episode; plans: readonly Plan[]; genre: "image" | "clip"; propositions?: number; confirmer: boolean }): Promise<string> {
  const { tarifs, preferences } = await chargerReglages();
  const { personnages } = await plansEtPersonnages(params.episode);
  const durees = dureesParPlan(params.plans, params.episode.duree_cible, params.episode.format);
  const cout = coutLancement({ genre: params.genre, episode: params.episode, plans: params.plans, personnages, durees, tarifs, propositions: params.propositions ?? preferences.propositions });
  if (cout > preferences.plafond_episode && !params.confirmer) {
    throw new ErreurUtilisateur(`Coût estimé ${euros(cout)}, au-dessus de ton plafond par épisode (${euros(preferences.plafond_episode)}). Coche « Je confirme la dépense » puis relance.`);
  }
  return euros(cout);
}
