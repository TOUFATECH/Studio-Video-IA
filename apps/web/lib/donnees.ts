// Chargement groupé des données de production d'une portée (un espace ou tous) et calcul de l'état de chaque épisode.
// Partagé par la coquille (badge « À faire »), l'accueil, les séries et le calendrier, une seule fois par requête.
import "server-only";
import {
  etatEpisode,
  type Episode,
  type EtatEpisode,
  type Fichier,
  type Personnage,
  type Plan,
  type Publication,
  type ReseauConnecte,
  type Saison,
  type Serie,
  type Tache,
} from "@studio-video-ia/core";
import { cache } from "react";
import { COLONNES_RESEAU } from "./appartenance";
import { porteeCourante, type Portee } from "./espace-courant";
import { ligneEpisode, ligneFichier, lignePersonnage, lignePlan, lignePublication, ligneReseau, ligneSaison, ligneSerie, lignes, ligneTache } from "./lignes";
import { utilisateur } from "./session";

/** Toutes les données utiles d'une portée. */
export type Production = {
  portee: Portee;
  series: Serie[];
  saisons: Saison[];
  episodes: Episode[];
  plans: Plan[];
  personnages: Personnage[];
  fichiers: Fichier[];
  /** Tâches actives (en file, en cours, en pause). */
  taches: Tache[];
  /** Tâches finies (terminées, en échec, annulées) des 3 derniers jours. */
  tachesRecentes: Tache[];
  publications: Publication[];
  reseaux: ReseauConnecte[];
  etats: Map<string, EtatEpisode>;
  depenses: Map<string, number>;
};

/** Découpe une liste en lots (les filtres « in » passent dans l'URL : on évite les URL trop longues). */
export function enLots<T>(liste: readonly T[], taille = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < liste.length; i += taille) out.push(liste.slice(i, i + taille));
  return out;
}

/** Groupe une liste par clé. */
export function grouper<T>(liste: readonly T[], cle: (x: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of liste) {
    const k = cle(x);
    if (k === null) continue;
    const l = m.get(k);
    if (l) l.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** Charge la production de la portée courante (mise en cache pour la requête). */
export const chargerProduction = cache(async (): Promise<Production> => {
  const { db } = await utilisateur();
  const portee = await porteeCourante();
  const ids = portee.ids;
  if (!ids.length) {
    return { portee, series: [], saisons: [], episodes: [], plans: [], personnages: [], fichiers: [], taches: [], tachesRecentes: [], publications: [], reseaux: [], etats: new Map(), depenses: new Map() };
  }
  const [rSeries, rReseaux, rTaches, rEchecs, rFichiers] = await Promise.all([
    db.from("series").select("*").in("espace_id", ids).order("cree_le"),
    db.from("reseaux_connectes").select(COLONNES_RESEAU).in("espace_id", ids).order("cree_le"),
    db.from("taches").select("*").in("espace_id", ids).in("statut", ["en_file", "en_cours", "en_pause"]).order("cree_le"),
    db
      .from("taches")
      .select("*")
      .in("espace_id", ids)
      .in("statut", ["echec", "terminee", "annulee"])
      .gte("modifie_le", new Date(Date.now() - 3 * 86_400_000).toISOString())
      .order("modifie_le", { ascending: false })
      .limit(300),
    db.from("fichiers").select("*").in("espace_id", ids).not("episode_id", "is", null),
  ]);
  const series = lignes(ligneSerie, rSeries.data, "series");
  const serieIds = series.map((s) => s.id);
  const [saisons, episodes, personnages] = await Promise.all([
    serieIds.length ? db.from("saisons").select("*").in("serie_id", serieIds).order("numero").then((r) => lignes(ligneSaison, r.data, "saisons")) : Promise.resolve([]),
    serieIds.length ? db.from("episodes").select("*").in("serie_id", serieIds).order("numero").then((r) => lignes(ligneEpisode, r.data, "episodes")) : Promise.resolve([]),
    serieIds.length ? db.from("personnages").select("*").in("serie_id", serieIds).order("position").then((r) => lignes(lignePersonnage, r.data, "personnages")) : Promise.resolve([]),
  ]);
  const episodeIds = episodes.map((e) => e.id);
  const lots = enLots(episodeIds);
  const [plans, publications] = await Promise.all([
    Promise.all(lots.map((l) => db.from("plans").select("*").in("episode_id", l).order("position"))).then((rs) => rs.flatMap((r) => lignes(lignePlan, r.data, "plans"))),
    Promise.all(lots.map((l) => db.from("publications").select("*").in("episode_id", l).order("programmee_le"))).then((rs) => rs.flatMap((r) => lignes(lignePublication, r.data, "publications"))),
  ]);
  const fichiers = lignes(ligneFichier, rFichiers.data, "fichiers");
  const taches = lignes(ligneTache, rTaches.data, "taches");
  const tachesRecentes = lignes(ligneTache, rEchecs.data, "taches");

  const plansPar = grouper(plans, (p) => p.episode_id);
  const fichiersPar = grouper(fichiers, (f) => f.episode_id);
  const tachesPar = grouper(taches, (t) => t.episode_id);
  const pubsPar = grouper(publications, (p) => p.episode_id);
  const persoPar = grouper(personnages, (p) => p.serie_id);
  const etats = new Map<string, EtatEpisode>();
  for (const ep of episodes) {
    etats.set(
      ep.id,
      etatEpisode({
        episode: ep,
        plans: plansPar.get(ep.id) ?? [],
        personnages: persoPar.get(ep.serie_id) ?? [],
        fichiers: fichiersPar.get(ep.id) ?? [],
        taches: tachesPar.get(ep.id) ?? [],
        publications: (pubsPar.get(ep.id) ?? []).filter((p) => p.statut !== "annulee"),
      }),
    );
  }

  const depenses = new Map<string, number>();
  await Promise.all(
    ids.map(async (id) => {
      const { data } = await db.rpc("depense_du_mois", { e: id });
      depenses.set(id, Number(data ?? 0) || 0);
    }),
  );

  return { portee, series, saisons, episodes, plans, personnages, fichiers, taches, tachesRecentes, publications, reseaux: lignes(ligneReseau, rReseaux.data, "reseaux"), etats, depenses };
});
