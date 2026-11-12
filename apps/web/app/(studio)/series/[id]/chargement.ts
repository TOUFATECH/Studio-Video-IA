// Chargement de tout ce qu'affiche la fiche d'une série (lecture limitée à l’utilisateur).
import "server-only";
import { etatEpisode, type EtatEpisode } from "@studio-video-ia/core";
import { notFound, redirect } from "next/navigation";
import { COLONNES_RESEAU } from "@/lib/appartenance";
import { enLots, grouper } from "@/lib/donnees";
import { ligne, ligneElement, ligneEpisode, ligneEspace, ligneFichier, ligneMemoire, lignePersonnage, lignePlan, lignePublication, ligneReseau, ligneSaison, ligneSerie, lignes, ligneTache } from "@/lib/lignes";
import { id as schemaId } from "@/lib/schemas";
import { utilisateur } from "@/lib/session";

/** Charge la série, ses saisons, épisodes, plans, personnages, mémoire, publications et l'état de chaque épisode. */
export async function chargerSerie(brut: string) {
  const r = schemaId.safeParse(brut);
  if (!r.success) notFound();
  const { db, user } = await utilisateur();
  const serie = ligne(ligneSerie, (await db.from("series").select("*").eq("id", r.data).maybeSingle()).data);
  if (!serie) notFound();
  // L'espace Clips n'a pas de fiche série : il a sa propre page.
  if (serie.genre === "clips") redirect("/clips");
  const [espace, saisons, episodes, personnages, memoire, comptes] = await Promise.all([
    db.from("espaces").select("*").eq("id", serie.espace_id).maybeSingle().then((x) => ligne(ligneEspace, x.data)),
    db.from("saisons").select("*").eq("serie_id", serie.id).order("numero").then((x) => lignes(ligneSaison, x.data, "saisons")),
    db.from("episodes").select("*").eq("serie_id", serie.id).order("numero").then((x) => lignes(ligneEpisode, x.data, "episodes")),
    db.from("personnages").select("*").eq("serie_id", serie.id).order("position").then((x) => lignes(lignePersonnage, x.data, "personnages")),
    db.from("memoire").select("*").eq("serie_id", serie.id).order("cree_le").then((x) => lignes(ligneMemoire, x.data, "memoire")),
    db.from("reseaux_connectes").select(COLONNES_RESEAU).eq("espace_id", serie.espace_id).order("cree_le").then((x) => lignes(ligneReseau, x.data, "reseaux")),
  ]);
  if (!espace) notFound();
  const lots = enLots(episodes.map((e) => e.id));
  const [plans, fichiers, taches, publications] = await Promise.all([
    Promise.all(lots.map((l) => db.from("plans").select("*").in("episode_id", l).order("position"))).then((rs) => rs.flatMap((x) => lignes(lignePlan, x.data, "plans"))),
    Promise.all(lots.map((l) => db.from("fichiers").select("*").in("episode_id", l))).then((rs) => rs.flatMap((x) => lignes(ligneFichier, x.data, "fichiers"))),
    Promise.all(lots.map((l) => db.from("taches").select("*").in("episode_id", l).in("statut", ["en_file", "en_cours", "en_pause"]))).then((rs) => rs.flatMap((x) => lignes(ligneTache, x.data, "taches"))),
    Promise.all(lots.map((l) => db.from("publications").select("*").in("episode_id", l).order("programmee_le"))).then((rs) => rs.flatMap((x) => lignes(lignePublication, x.data, "publications"))),
  ]);
  // Tâches de fiche de personnage (sans épisode) : pour l'état « en cours » des fiches.
  const fiches = lignes(ligneTache, (await db.from("taches").select("*").eq("espace_id", serie.espace_id).in("type", ["fiche_personnage", "clone_voix"]).in("statut", ["en_file", "en_cours"])).data, "taches");
  // Arcs de saison en cours d'écriture (tâches « scenario » sans épisode).
  const tachesArc = lignes(ligneTache, (await db.from("taches").select("*").eq("espace_id", serie.espace_id).eq("type", "scenario").is("episode_id", null).in("statut", ["en_file", "en_cours"])).data, "taches");
  const arcs = new Set(tachesArc.map((t) => String(t.donnees.saison_id ?? "")));
  // Bibliothèque : éléments de la série et partagés, photos de référence, visages proposés.
  const [elements, references, fichesProposees] = await Promise.all([
    db.from("elements").select("*").eq("espace_id", serie.espace_id).order("position").then((x) => lignes(ligneElement, x.data, "elements").filter((e) => e.serie_id === null || e.serie_id === serie.id)),
    db.from("fichiers").select("*").eq("espace_id", serie.espace_id).eq("genre", "reference").order("cree_le", { ascending: false }).then((x) => lignes(ligneFichier, x.data, "fichiers")),
    personnages.length
      ? db.from("fichiers").select("*").eq("genre", "fiche").in("personnage_id", personnages.map((p) => p.id)).order("cree_le", { ascending: false }).then((x) => lignes(ligneFichier, x.data, "fichiers"))
      : Promise.resolve([]),
  ]);
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
  return { user, serie, espace, saisons, episodes, personnages, memoire, comptes, plans, plansPar, fichiers, taches, publications, pubsPar, etats, fiches, arcs, elements, references, fichesProposees };
}

/** Données de la fiche série. */
export type DonneesSerie = Awaited<ReturnType<typeof chargerSerie>>;
