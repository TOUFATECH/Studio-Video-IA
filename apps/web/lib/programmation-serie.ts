// Plan de programmation des épisodes prêts d'une série : calculé à l'identique pour l'aperçu et pour la confirmation.
import "server-only";
import { etatEpisode, livrablePour, type Episode, type Langue, type ReseauConnecte, type Serie } from "@feuilleton/core";
import { COLONNES_RESEAU } from "./appartenance";
import { grouper } from "./donnees";
import { ordreLecture } from "./episodes";
import { ligneEpisode, ligneEspace, ligneFichier, ligne, lignePersonnage, lignePlan, lignePublication, ligneReseau, ligneSaison, lignes, ligneTache } from "./lignes";
import { enchainerCreneaux } from "./programmation";
import { estPretAPublier } from "./resumes";
import { utilisateur } from "./session";

/** Une publication à créer. */
export type PublicationPrevue = { compte: ReseauConnecte; langue: Langue; statut: "programmee" | "attend_rendu" };
/** Un épisode et sa date de sortie proposée. */
export type SortiePrevue = { episode: Episode; instant: Date; publications: PublicationPrevue[] };

/** Calcule les sorties à programmer pour la série (épisodes rendus, sans publication, dans l'ordre de lecture). */
export async function planProgrammation(serie: Serie, maintenant: Date = new Date()): Promise<{ sorties: SortiePrevue[]; comptes: ReseauConnecte[]; fuseau: string }> {
  const { supabase } = await utilisateur();
  const [rEspace, rSaisons, rEpisodes, rPersos, rReseaux] = await Promise.all([
    supabase.from("espaces").select("*").eq("id", serie.espace_id).maybeSingle(),
    supabase.from("saisons").select("*").eq("serie_id", serie.id),
    supabase.from("episodes").select("*").eq("serie_id", serie.id),
    supabase.from("personnages").select("*").eq("serie_id", serie.id),
    supabase.from("reseaux_connectes").select(COLONNES_RESEAU).eq("espace_id", serie.espace_id),
  ]);
  const fuseau = ligne(ligneEspace, rEspace.data)?.fuseau ?? "Europe/Paris";
  const saisons = lignes(ligneSaison, rSaisons.data, "saisons");
  const episodes = lignes(ligneEpisode, rEpisodes.data, "episodes");
  const personnages = lignes(lignePersonnage, rPersos.data, "personnages");
  const comptes = lignes(ligneReseau, rReseaux.data, "reseaux").filter((r) => serie.rythme.reseaux.includes(r.id) && r.statut === "connecte");
  const ids = episodes.map((e) => e.id);
  if (!ids.length) return { sorties: [], comptes, fuseau };
  const [rPlans, rFichiers, rTaches, rPubs] = await Promise.all([
    supabase.from("plans").select("*").in("episode_id", ids),
    supabase.from("fichiers").select("*").in("episode_id", ids),
    supabase.from("taches").select("*").in("episode_id", ids).in("statut", ["en_file", "en_cours", "en_pause"]),
    supabase.from("publications").select("*").in("episode_id", ids),
  ]);
  const plans = grouper(lignes(lignePlan, rPlans.data, "plans"), (p) => p.episode_id);
  const fichiersTous = lignes(ligneFichier, rFichiers.data, "fichiers");
  const fichiers = grouper(fichiersTous, (f) => f.episode_id);
  const taches = grouper(lignes(ligneTache, rTaches.data, "taches"), (t) => t.episode_id);
  const pubsToutes = lignes(lignePublication, rPubs.data, "publications").filter((p) => p.statut !== "annulee");
  const pubs = grouper(pubsToutes, (p) => p.episode_id);
  const prets = ordreLecture(episodes, saisons).filter((e) =>
    estPretAPublier(
      e,
      etatEpisode({ episode: e, plans: plans.get(e.id) ?? [], personnages, fichiers: fichiers.get(e.id) ?? [], taches: taches.get(e.id) ?? [], publications: pubs.get(e.id) ?? [] }),
    ),
  );
  // Dernière sortie déjà programmée dans le futur : la suite se cale après elle.
  const futures = pubsToutes.filter((p) => (p.statut === "programmee" || p.statut === "attend_rendu") && Date.parse(p.programmee_le) > maintenant.getTime()).map((p) => Date.parse(p.programmee_le));
  const derniere = futures.length ? new Date(Math.max(...futures)) : null;
  const sorties = enchainerCreneaux(prets, serie.rythme, derniere, maintenant, fuseau).map(({ episode, instant }) => ({
    episode,
    instant,
    publications: comptes.map((compte) => {
      // La version publiée suit la langue du compte si l'épisode existe dans cette langue.
      const langue = episode.langues.includes(compte.langue) ? compte.langue : episode.langue;
      const rendu = fichiersTous.some((f) => f.episode_id === episode.id && f.genre === "rendu" && f.langue === langue && f.statut === "pret");
      return { compte, langue, statut: rendu ? ("programmee" as const) : ("attend_rendu" as const) };
    }),
  }));
  return { sorties, comptes, fuseau };
}

/** Lignes « publications » à insérer pour un plan de programmation. */
export function lignesPublications(sorties: readonly SortiePrevue[]) {
  return sorties.flatMap((s) =>
    s.publications.map((p) => ({
      episode_id: s.episode.id,
      reseau_connecte_id: p.compte.id,
      langue: p.langue,
      livrable: livrablePour(s.episode, p.compte.reseau),
      programmee_le: s.instant.toISOString(),
      statut: p.statut,
    })),
  );
}
