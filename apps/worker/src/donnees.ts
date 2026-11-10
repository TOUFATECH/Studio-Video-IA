// Lectures et écritures communes aux tâches : épisode complet, réglages, fichiers produits, suppression de fichiers.
import {
  cleFichier,
  indexerFichiers,
  schemaPreferences,
  schemaTarifs,
  type Episode,
  type Fichier,
  type GenreFichier,
  type Langue,
  type Personnage,
  type Plan,
  type Preferences,
  type Saison,
  type Serie,
  type Tarifs,
} from "@studio-video-ia/core";
import type { Stockage } from "./stockage";
import { ecrire, ligne, lignes, type Base } from "./supabase";

/** Tarifs par défaut (ceux de la migration), si les réglages sont absents ou invalides. */
export const TARIFS_DEFAUT: Tarifs = { image: 0.07, video_seconde: 0.05, voix_1000_car: 0.3, musique_minute: 0.5 };
/** Préférences par défaut (celles de la migration). */
export const PREFERENCES_DEFAUT: Preferences = { parallele: 2, sous_titres: "aucun", prises: 1, memoire_auto: true };

/** Un épisode avec tout ce qu'il faut pour le produire. */
export type EpisodeComplet = {
  episode: Episode;
  serie: Serie;
  saison: Saison;
  personnages: Personnage[];
  plans: Plan[];
  fichiers: Fichier[];
};

/** Normalise les champs JSON d'un épisode (valeurs manquantes sur une base plus ancienne). */
function normaliserEpisode(e: Episode): Episode {
  return {
    ...e,
    sous_titres: e.sous_titres ?? {},
    chapitres: e.chapitres ?? [],
    titres_traduits: e.titres_traduits ?? {},
    choix_titres: e.choix_titres ?? {},
    hashtags: e.hashtags ?? {},
    langues: e.langues?.length ? e.langues : [e.langue],
    // Champs des clips, absents sur une base sans la migration 0006.
    style_visuel: e.style_visuel ?? "",
    paroles: e.paroles ?? "",
    paroles_alignees: e.paroles_alignees ?? null,
    paroles_traduites: e.paroles_traduites ?? {},
    bpm: e.bpm == null ? null : Number(e.bpm),
    extrait_debut: Number(e.extrait_debut ?? 0),
    extrait_fin: e.extrait_fin == null ? null : Number(e.extrait_fin),
    musique_style: e.musique_style ?? "",
    instrumental: e.instrumental ?? false,
    fournisseur_texte: e.fournisseur_texte ?? "openai",
  };
}

/** Normalise un plan (traductions absentes). */
function normaliserPlan(p: Plan): Plan {
  // Les colonnes numeric arrivent parfois en texte depuis PostgREST : on les ramène en nombres.
  return { ...p, repliques_traduites: p.repliques_traduites ?? {}, debut: p.debut == null ? null : Number(p.debut), fin: p.fin == null ? null : Number(p.fin) };
}

/** Charge un épisode, sa série, sa saison, les personnages, les plans (dans l'ordre) et ses fichiers. */
export async function chargerEpisode(db: Base, episodeId: string): Promise<EpisodeComplet> {
  const episode = normaliserEpisode(await ligne<Episode>(db.from("episodes").select("*").eq("id", episodeId).limit(1), "épisode"));
  const [serie, saison, personnages, plans, fichiers] = await Promise.all([
    ligne<Serie>(db.from("series").select("*").eq("id", episode.serie_id).limit(1), "série"),
    ligne<Saison>(db.from("saisons").select("*").eq("id", episode.saison_id).limit(1), "saison"),
    lignes<Personnage>(db.from("personnages").select("*").eq("serie_id", episode.serie_id).order("position"), "personnages"),
    lignes<Plan>(db.from("plans").select("*").eq("episode_id", episodeId).order("position"), "plans"),
    lignes<Fichier>(db.from("fichiers").select("*").eq("episode_id", episodeId).order("cree_le"), "fichiers"),
  ]);
  return { episode, serie: { ...serie, hashtags: serie.hashtags ?? {}, genre: serie.genre ?? "serie" }, saison, personnages, plans: plans.map(normaliserPlan), fichiers };
}

/** Tarifs et préférences d'un propriétaire, avec repli sur les valeurs par défaut. */
export async function chargerReglages(db: Base, proprietaire: string): Promise<{ tarifs: Tarifs; preferences: Preferences }> {
  const r = await lignes<{ tarifs: unknown; preferences: unknown }>(db.from("reglages").select("tarifs, preferences").eq("proprietaire", proprietaire).limit(1), "réglages");
  const tarifs = schemaTarifs.safeParse(r[0]?.tarifs);
  const preferences = schemaPreferences.safeParse(r[0]?.preferences);
  return { tarifs: tarifs.success ? tarifs.data : TARIFS_DEFAUT, preferences: preferences.success ? preferences.data : PREFERENCES_DEFAUT };
}

/** Ligne de fichier à créer. */
export type NouveauFichier = {
  espace_id: string;
  episode_id: string | null;
  plan_id?: string | null;
  personnage_id?: string | null;
  genre: GenreFichier;
  langue?: Langue | null;
  prise?: "A" | "B" | null;
  chemin: string | null;
  duree_s?: number | null;
  secondes_generation?: number | null;
  cout?: number;
  statut?: "pret" | "echec";
  erreur?: string | null;
  essais?: number;
};

/** Enregistre un fichier produit (ou un échec) et renvoie la ligne créée. */
export async function enregistrerFichier(db: Base, f: NouveauFichier): Promise<Fichier> {
  const valeur = {
    plan_id: null,
    personnage_id: null,
    langue: null,
    prise: null,
    duree_s: null,
    secondes_generation: null,
    statut: "pret",
    erreur: null,
    essais: 1,
    ...f,
    // numeric(10,4) : on arrondit pour éviter les flottants interminables.
    cout: Math.round((f.cout ?? 0) * 10000) / 10000,
  };
  return ligne<Fichier>(db.from("fichiers").insert(valeur).select("*"), "enregistrement d'un fichier");
}

/** Supprime des fichiers : objets du stockage puis lignes de la table. */
export async function supprimerFichiers(db: Base, stockage: Stockage, fichiers: readonly Fichier[]): Promise<void> {
  if (fichiers.length === 0) return;
  await stockage.supprimer(fichiers.map((f) => f.chemin ?? "").filter(Boolean));
  await ecrire(
    db.from("fichiers").delete().in(
      "id",
      fichiers.map((f) => f.id),
    ),
    "suppression de fichiers",
  );
}

/** Fichier prêt d'une unité (clé `<plan>:image`, `rendu:fr`…), ou null. */
export function fichierPret(fichiers: readonly Fichier[], cle: string): Fichier | null {
  const f = indexerFichiers(fichiers.filter((x) => x.statut === "pret")).get(cle);
  return f && f.chemin ? f : null;
}

/** Vrai si l'unité a déjà un fichier prêt (le plus récent pour cette clé est prêt). */
export function unitePrete(fichiers: readonly Fichier[], cle: string): boolean {
  const f = indexerFichiers(fichiers).get(cle);
  return f?.statut === "pret" && !!f.chemin;
}

/** Chanson d'un clip musical : le fichier « chanson » prêt le plus récent de l'épisode. */
export function chansonDuClip(fichiers: readonly Fichier[]): Fichier | null {
  const pretes = fichiers.filter((f) => f.genre === "chanson" && f.statut === "pret" && f.chemin);
  return [...pretes].sort((a, b) => b.cree_le.localeCompare(a.cree_le))[0] ?? null;
}

/** Message d'erreur court pour la colonne `erreur` (une ligne, 500 caractères au plus). */
export function erreurCourte(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/\s+/g, " ").trim().slice(0, 500);
}

/** Numéro lisible d'un plan (« plan 3 »). */
export function nomPlan(plans: readonly Plan[], plan: Plan): string {
  return `plan ${plans.findIndex((p) => p.id === plan.id) + 1}`;
}

export { cleFichier };
