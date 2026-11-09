// Chargement de tout ce qu'affiche la fiche d'une série (lecture via RLS).
import "server-only";
import { etatEpisode, type EtatEpisode } from "@feuilleton/core";
import { notFound } from "next/navigation";
import { COLONNES_RESEAU } from "@/lib/appartenance";
import { enLots, grouper } from "@/lib/donnees";
import { ligne, ligneEpisode, ligneEspace, ligneFichier, ligneMemoire, lignePersonnage, lignePlan, lignePublication, ligneReseau, ligneSaison, ligneSerie, lignes, ligneTache } from "@/lib/lignes";
import { id as schemaId } from "@/lib/schemas";
import { utilisateur } from "@/lib/session";

/** Charge la série, ses saisons, épisodes, plans, personnages, mémoire, publications et l'état de chaque épisode. */
export async function chargerSerie(brut: string) {
  const r = schemaId.safeParse(brut);
  if (!r.success) notFound();
  const { supabase, user } = await utilisateur();
  const serie = ligne(ligneSerie, (await supabase.from("series").select("*").eq("id", r.data).maybeSingle()).data);
  if (!serie) notFound();
  const [espace, saisons, episodes, personnages, memoire, comptes] = await Promise.all([
    supabase.from("espaces").select("*").eq("id", serie.espace_id).maybeSingle().then((x) => ligne(ligneEspace, x.data)),
    supabase.from("saisons").select("*").eq("serie_id", serie.id).order("numero").then((x) => lignes(ligneSaison, x.data, "saisons")),
    supabase.from("episodes").select("*").eq("serie_id", serie.id).order("numero").then((x) => lignes(ligneEpisode, x.data, "episodes")),
    supabase.from("personnages").select("*").eq("serie_id", serie.id).order("position").then((x) => lignes(lignePersonnage, x.data, "personnages")),
    supabase.from("memoire").select("*").eq("serie_id", serie.id).order("cree_le").then((x) => lignes(ligneMemoire, x.data, "memoire")),
    supabase.from("reseaux_connectes").select(COLONNES_RESEAU).eq("espace_id", serie.espace_id).order("cree_le").then((x) => lignes(ligneReseau, x.data, "reseaux")),
  ]);
  if (!espace) notFound();
  const lots = enLots(episodes.map((e) => e.id));
  const [plans, fichiers, taches, publications] = await Promise.all([
    Promise.all(lots.map((l) => supabase.from("plans").select("*").in("episode_id", l).order("position"))).then((rs) => rs.flatMap((x) => lignes(lignePlan, x.data, "plans"))),
    Promise.all(lots.map((l) => supabase.from("fichiers").select("*").in("episode_id", l))).then((rs) => rs.flatMap((x) => lignes(ligneFichier, x.data, "fichiers"))),
    Promise.all(lots.map((l) => supabase.from("taches").select("*").in("episode_id", l).in("statut", ["en_file", "en_cours", "en_pause"]))).then((rs) => rs.flatMap((x) => lignes(ligneTache, x.data, "taches"))),
    Promise.all(lots.map((l) => supabase.from("publications").select("*").in("episode_id", l).order("programmee_le"))).then((rs) => rs.flatMap((x) => lignes(lignePublication, x.data, "publications"))),
  ]);
  // Tâches de fiche de personnage (sans épisode) : pour l'état « en cours » des fiches.
  const fiches = lignes(ligneTache, (await supabase.from("taches").select("*").eq("espace_id", serie.espace_id).in("type", ["fiche_personnage", "clone_voix"]).in("statut", ["en_file", "en_cours"])).data, "taches");
  const plansPar = grouper(plans, (p) => p.episode_id);
  const fichiersPar = grouper(fichiers, (f) => f.episode_id);
  const tachesPar = grouper(taches, (t) => t.episode_id);
  const pubsPar = grouper(publications, (p) => p.episode_id);
  const etats = new Map<string, EtatEpisode>();
  for (const ep of episodes) {
    etats.set(
      ep.id,
      etatEpisode({ episode: ep, plans: plansPar.get(ep.id) ?? [], personnages, fichiers: fichiersPar.get(ep.id) ?? [], taches: tachesPar.get(ep.id) ?? [], publications: (pubsPar.get(ep.id) ?? []).filter((p) => p.statut !== "annulee") }),
    );
  }
  return { user, serie, espace, saisons, episodes, personnages, memoire, comptes, plans, plansPar, fichiers, taches, publications, pubsPar, etats, fiches };
}

/** Données de la fiche série. */
export type DonneesSerie = Awaited<ReturnType<typeof chargerSerie>>;
