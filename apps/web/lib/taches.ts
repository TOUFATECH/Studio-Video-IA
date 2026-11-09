// Mise en file des tâches du worker : SEUL point de création de tâches de l'app web.
// L'appelant a déjà vérifié que l'espace (et l'épisode) appartiennent à l'utilisateur.
import "server-only";
import type { TypeTache } from "@feuilleton/core";
import { ErreurUtilisateur } from "./erreurs";
import { clientAdmin } from "./supabase/admin";

/** Demande de tâche. */
export type DemandeTache = {
  espace_id: string;
  episode_id?: string | null;
  publication_id?: string | null;
  type: TypeTache;
  donnees?: Record<string, unknown>;
  priorite?: number;
};

/** Résultat d'une mise en file. */
export type ResultatFile = { ok: true; id: string } | { ok: false; raison: string };

/** Libellés utilisés dans les messages de doublon. */
const NOMS: Record<TypeTache, string> = {
  scenario: "L’écriture",
  storyboard: "La génération des images",
  clips: "La génération des clips",
  rendu: "Le rendu",
  publication: "La publication",
  stats: "La synchronisation",
  fiche_personnage: "La fiche de ce personnage",
  memoire: "La mise à jour de la mémoire",
  clone_voix: "Le clonage de cette voix",
  test_complet: "Le test complet",
};

/**
 * Met une tâche en file. Refuse un doublon : même type et même épisode déjà « en_file », « en_cours » ou « en_pause ».
 * Sans épisode, le doublon se juge sur l'espace et, pour une fiche ou une voix, sur le personnage.
 */
export async function mettreEnFile(d: DemandeTache): Promise<ResultatFile> {
  const admin = clientAdmin();
  let requete = admin.from("taches").select("id").eq("espace_id", d.espace_id).eq("type", d.type).in("statut", ["en_file", "en_cours", "en_pause"]);
  requete = d.episode_id ? requete.eq("episode_id", d.episode_id) : requete.is("episode_id", null);
  const personnage = d.donnees?.personnage_id;
  if (!d.episode_id && typeof personnage === "string") requete = requete.contains("donnees", { personnage_id: personnage });
  const { data: existantes, error: e1 } = await requete.limit(1);
  if (e1) throw new Error(`Lecture de la file impossible : ${e1.message}`);
  if (existantes && existantes.length > 0) return { ok: false, raison: `${NOMS[d.type]} est déjà en file ou en cours.` };
  const { data, error } = await admin
    .from("taches")
    .insert({
      espace_id: d.espace_id,
      episode_id: d.episode_id ?? null,
      publication_id: d.publication_id ?? null,
      type: d.type,
      donnees: d.donnees ?? {},
      priorite: d.priorite ?? 0,
    })
    .select("id")
    .single();
  // 23505 : l'index unique de la base a bloqué un doublon créé au même instant (double clic) : même message.
  if (error?.code === "23505") return { ok: false, raison: `${NOMS[d.type]} est déjà en file ou en cours.` };
  if (error || !data) throw new Error(`Mise en file impossible : ${error?.message ?? "réponse vide"}`);
  return { ok: true, id: String(data.id) };
}

/** Met en file et lève une erreur affichable en cas de doublon. */
export async function exigerMiseEnFile(d: DemandeTache): Promise<string> {
  const r = await mettreEnFile(d);
  if (!r.ok) throw new ErreurUtilisateur(r.raison);
  return r.id;
}
