// Chargement de tout ce qu'affiche la page d'un épisode, avec les URL signées de ses médias.
import "server-only";
import { coutEstimeEpisode, dureesParPlan, etatEpisode, indexerFichiers, aGeneriques, DUREE_GENERIQUES } from "@studio-video-ia/core";
import { notFound } from "next/navigation";
import { COLONNES_RESEAU } from "@/lib/appartenance";
import { ordreLecture } from "@/lib/episodes";
import { ligne, ligneEpisode, ligneEspace, ligneFichier, ligneMemoire, lignePersonnage, lignePlan, lignePublication, ligneReseau, ligneSaison, ligneSerie, lignes, ligneTache } from "@/lib/lignes";
import { urlsSignees } from "@/lib/medias";
import { chargerReglages } from "@/lib/reglages";
import { id as schemaId } from "@/lib/schemas";
import { utilisateur } from "@/lib/session";

/** Charge l'épisode, sa série, ses plans, fichiers, tâches, publications et le contexte de continuité. */
export async function chargerEpisode(brut: string) {
  const r = schemaId.safeParse(brut);
  if (!r.success) notFound();
  const { supabase } = await utilisateur();
  const episode = ligne(ligneEpisode, (await supabase.from("episodes").select("*").eq("id", r.data).maybeSingle()).data);
  if (!episode) notFound();
  const serie = ligne(ligneSerie, (await supabase.from("series").select("*").eq("id", episode.serie_id).maybeSingle()).data);
  if (!serie) notFound();
  const [espace, saisons, episodesSerie, plans, personnages, fichiers, taches, recentes, publications, comptes, mysteres, musiques, reglages] = await Promise.all([
    supabase.from("espaces").select("*").eq("id", serie.espace_id).maybeSingle().then((x) => ligne(ligneEspace, x.data)),
    supabase.from("saisons").select("*").eq("serie_id", serie.id).order("numero").then((x) => lignes(ligneSaison, x.data, "saisons")),
    supabase.from("episodes").select("*").eq("serie_id", serie.id).then((x) => lignes(ligneEpisode, x.data, "episodes")),
    supabase.from("plans").select("*").eq("episode_id", episode.id).order("position").then((x) => lignes(lignePlan, x.data, "plans")),
    supabase.from("personnages").select("*").eq("serie_id", serie.id).order("position").then((x) => lignes(lignePersonnage, x.data, "personnages")),
    supabase.from("fichiers").select("*").eq("episode_id", episode.id).order("cree_le").then((x) => lignes(ligneFichier, x.data, "fichiers")),
    supabase.from("taches").select("*").eq("episode_id", episode.id).in("statut", ["en_file", "en_cours", "en_pause"]).order("cree_le").then((x) => lignes(ligneTache, x.data, "taches")),
    supabase.from("taches").select("*").eq("episode_id", episode.id).in("statut", ["echec", "terminee"]).order("modifie_le", { ascending: false }).limit(10).then((x) => lignes(ligneTache, x.data, "taches")),
    supabase.from("publications").select("*").eq("episode_id", episode.id).order("programmee_le").then((x) => lignes(lignePublication, x.data, "publications")),
    supabase.from("reseaux_connectes").select(COLONNES_RESEAU).eq("espace_id", serie.espace_id).order("cree_le").then((x) => lignes(ligneReseau, x.data, "reseaux")),
    supabase.from("memoire").select("*").eq("serie_id", serie.id).eq("genre", "mystere").eq("ouvert", true).order("cree_le").then((x) => lignes(ligneMemoire, x.data, "memoire")),
    supabase.from("fichiers").select("*").eq("espace_id", serie.espace_id).eq("genre", "musique").order("cree_le", { ascending: false }).then((x) => lignes(ligneFichier, x.data, "fichiers")),
    chargerReglages(),
  ]);
  if (!espace) notFound();
  const saison = saisons.find((s) => s.id === episode.saison_id);
  const ordre = ordreLecture(episodesSerie, saisons);
  const position = ordre.findIndex((e) => e.id === episode.id);
  const precedent = position > 0 ? ordre[position - 1] : undefined;
  const suivant = position >= 0 ? ordre[position + 1] : undefined;
  const finPrecedent = precedent ? ligne(lignePlan, (await supabase.from("plans").select("*").eq("episode_id", precedent.id).order("position", { ascending: false }).limit(1).maybeSingle()).data) : null;
  const pubsActives = publications.filter((p) => p.statut !== "annulee");
  const etat = etatEpisode({ episode, plans, personnages, fichiers, taches, publications: pubsActives });
  const durees = dureesParPlan(plans, episode.duree_cible, episode.format);
  const index = indexerFichiers(fichiers);
  // Durée totale calculée (génériques compris pour un film) : sert au contrôle de durée par réseau avant le rendu.
  let dureeTotale = 0;
  for (const v of durees.values()) dureeTotale += v;
  if (aGeneriques(episode.format, episode.genre)) dureeTotale += DUREE_GENERIQUES;
  const fiches = personnages.map((p) => p.fiche_chemin);
  const miniatures = episode.miniature?.chemins ?? [];
  const urls = await urlsSignees([...fichiers.filter((f) => f.statut === "pret").map((f) => f.chemin), ...fiches, ...miniatures]);
  const depense = fichiers.reduce((a, f) => a + f.cout, 0);
  const estimation = coutEstimeEpisode(episode, plans, personnages, durees, reglages.tarifs);
  return {
    episode,
    serie,
    espace,
    saison,
    saisons,
    ordre,
    position,
    precedent,
    suivant,
    finPrecedent,
    plans,
    personnages,
    fichiers,
    index,
    dureeTotale,
    taches,
    recentes,
    publications,
    comptes,
    mysteres,
    musiques,
    reglages,
    etat,
    durees,
    urls,
    depense,
    estimation,
  };
}

/** Données de la page épisode. */
export type DonneesEpisode = Awaited<ReturnType<typeof chargerEpisode>>;
