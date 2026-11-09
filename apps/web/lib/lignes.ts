// Validation Zod des lignes lues dans Supabase, colonnes JSON comprises.
// Une colonne JSON mal formée retombe sur une valeur par défaut au lieu de casser la page.
import {
  schemaChapitre,
  schemaLangue,
  schemaPreferences,
  schemaReseau,
  schemaRythme,
  schemaSousTitres,
  schemaTarifs,
  schemaTypePlan,
  type Episode,
  type Espace,
  type FaitMemoire,
  type Fichier,
  type Personnage,
  type Plan,
  type Preferences,
  type Publication,
  type ReseauConnecte,
  type Revenu,
  type StatsCompte,
  type VideoReseau,
  type Saison,
  type Serie,
  type Tache,
  type Tarifs,
} from "@feuilleton/core";
import { z } from "zod";

/** Nombre venant de PostgreSQL (numeric peut arriver en texte). */
const nombre = z.coerce.number();
/** Nombre facultatif (null conservé). */
const nombreNul = z.union([z.null(), z.coerce.number()]);
/** Objet JSON libre. */
const objetLibre = z.record(z.unknown()).catch({});
/** Langue → texte. */
const textesParLangue = z.record(schemaLangue, z.string()).catch({});
/** Réseau → hashtags (« #a #b »). */
export const schemaHashtagsParReseau = z.record(schemaReseau, z.string().max(3000)).catch({});

export const ligneEspace = z.object({
  id: z.string(),
  proprietaire: z.string(),
  nom: z.string(),
  couleur: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  plafond_mensuel: nombre,
  fuseau: z.string(),
  cree_le: z.string(),
});

export const ligneReseau = z.object({
  id: z.string(),
  espace_id: z.string(),
  reseau: schemaReseau,
  nom_compte: z.string(),
  langue: schemaLangue,
  id_externe: z.string().nullable(),
  jeton_expire_le: z.string().nullable(),
  statut: z.enum(["connecte", "expire", "deconnecte"]),
  audit_tiktok_valide: z.boolean(),
  infos: objetLibre,
  cree_le: z.string(),
});

export const rythmeParDefaut = { tous_les_jours: 2, heure: "18:00", reseaux: [], auto: false };

export const ligneSerie = z.object({
  id: z.string(),
  espace_id: z.string(),
  nom: z.string(),
  style_visuel: z.string(),
  langue: schemaLangue,
  univers: z.string(),
  fil_rouge: z.string(),
  rythme: schemaRythme.catch(rythmeParDefaut),
  hashtags: schemaHashtagsParReseau.default({}),
  cree_le: z.string(),
});

export const lignePersonnage = z.object({
  id: z.string(),
  serie_id: z.string(),
  nom: z.string(),
  description: z.string(),
  source_voix: z.enum(["elevenlabs", "elevenlabs_clone", "grok"]),
  voix_id: z.string(),
  accord_clone: z.boolean(),
  fiche_chemin: z.string().nullable(),
  fiche_statut: z.enum(["a_faire", "en_cours", "prete", "echec"]),
  position: nombre,
});

export const ligneSaison = z.object({
  id: z.string(),
  serie_id: z.string(),
  numero: nombre,
  opening_id: z.string().nullable(),
  ending_id: z.string().nullable(),
});

export const ligneEpisode = z.object({
  id: z.string(),
  serie_id: z.string(),
  saison_id: z.string(),
  genre: z.enum(["episode", "opening", "ending"]),
  numero: nombre,
  titre: z.string(),
  idee: z.string(),
  format: z.enum(["court", "moyen", "long"]),
  duree_cible: nombre,
  langue: schemaLangue,
  langues: z.array(schemaLangue).min(1),
  sous_titres: z.record(schemaLangue, schemaSousTitres).catch({}),
  prises: z.union([z.literal(1), z.literal(2)]).catch(1),
  enchainer: z.boolean(),
  musique: z.boolean(),
  bruitages: z.boolean(),
  chapitres: z.array(schemaChapitre).catch([]),
  titres_traduits: textesParLangue,
  choix_titres: z.record(schemaLangue, z.number().int().min(0).max(2)).catch({}),
  miniature: z.object({ choix: z.number().int().min(0), chemins: z.array(z.string()) }).nullable().catch(null),
  memoire_faite: z.boolean(),
  hashtags: schemaHashtagsParReseau.default({}),
  cree_le: z.string(),
});

export const lignePlan = z.object({
  id: z.string(),
  episode_id: z.string(),
  position: nombre,
  section: z.string(),
  type: schemaTypePlan,
  texte: z.string(),
  personnage_id: z.string().nullable(),
  replique: z.string(),
  repliques_traduites: textesParLangue,
  duree_fixee: nombreNul,
  valide: z.boolean(),
  modifie: z.boolean(),
  prise_choisie: z.enum(["A", "B"]),
});

export const ligneFichier = z.object({
  id: z.string(),
  espace_id: z.string(),
  episode_id: z.string().nullable(),
  plan_id: z.string().nullable(),
  personnage_id: z.string().nullable(),
  genre: z.enum(["image", "clip", "voix", "rendu", "bande_annonce", "miniature", "fiche", "bruitage", "musique", "echantillon_voix"]),
  langue: schemaLangue.nullable(),
  prise: z.enum(["A", "B"]).nullable(),
  chemin: z.string().nullable(),
  duree_s: nombreNul,
  secondes_generation: nombreNul,
  cout: nombre,
  statut: z.enum(["pret", "echec"]),
  erreur: z.string().nullable(),
  essais: nombre,
  cree_le: z.string(),
});

/** Progression d'une tâche ; les étapes du test complet sont lues à part (voir schemaEtapesTest). */
const progressionTache = z
  .object({
    fait: z.number().optional(),
    total: z.number().optional(),
    etape: z.string().optional(),
    secondes: z.number().optional(),
  })
  .passthrough()
  .catch({});

export const ligneTache = z.object({
  id: z.string(),
  espace_id: z.string(),
  episode_id: z.string().nullable(),
  publication_id: z.string().nullable(),
  type: z.enum(["scenario", "storyboard", "clips", "rendu", "publication", "stats", "fiche_personnage", "memoire", "clone_voix", "test_complet"]),
  statut: z.enum(["en_file", "en_cours", "terminee", "echec", "en_pause", "annulee"]),
  priorite: nombre,
  donnees: objetLibre,
  progression: progressionTache,
  erreur: z.string().nullable(),
  essais: nombre,
  executer_apres: z.string(),
  verrouille_par: z.string().nullable(),
  verrouille_le: z.string().nullable(),
  cree_le: z.string(),
  modifie_le: z.string(),
});

export const lignePublication = z.object({
  id: z.string(),
  episode_id: z.string(),
  reseau_connecte_id: z.string(),
  langue: schemaLangue,
  livrable: z.enum(["court", "film", "bande_annonce"]),
  programmee_le: z.string(),
  statut: z.enum(["attend_rendu", "programmee", "envoi", "traitement", "publiee", "privee", "echec", "annulee"]),
  id_externe: z.string().nullable(),
  url: z.string().nullable(),
  erreur: z.string().nullable(),
  progression: nombre,
  stats: z
    .object({ vues: z.number().optional(), jaime: z.number().optional(), commentaires: z.number().optional(), partages: z.number().optional() })
    .catch({}),
  stats_le: z.string().nullable(),
  publiee_le: z.string().nullable(),
  cree_le: z.string(),
});

export const ligneMemoire = z.object({
  id: z.string(),
  serie_id: z.string(),
  episode_id: z.string().nullable(),
  genre: z.enum(["fait", "personnage", "lieu", "objet", "mystere"]),
  texte: z.string(),
  ouvert: z.boolean(),
  cree_le: z.string(),
});

export const ligneReglages = z.object({
  proprietaire: z.string(),
  tarifs: schemaTarifs.catch({ image: 0.07, video_seconde: 0.05, voix_1000_car: 0.3 }),
  preferences: schemaPreferences.catch({ parallele: 2, sous_titres: "aucun", prises: 1, memoire_auto: true }),
});

export const ligneVideo = z.object({
  id: z.string(),
  reseau_connecte_id: z.string(),
  id_externe: z.string(),
  publication_id: z.string().nullable(),
  titre: z.string(),
  url: z.string().nullable(),
  miniature_url: z.string().nullable(),
  publiee_le: z.string().nullable(),
  duree_s: nombreNul,
  vues: nombre,
  jaime: nombre,
  commentaires: nombre,
  partages: nombre,
  revenu_estime: nombreNul,
  devise: z.string().nullable(),
  maj_le: z.string(),
});

export const ligneStatsCompte = z.object({
  id: z.string(),
  reseau_connecte_id: z.string(),
  jour: z.string(),
  abonnes: nombreNul,
  abonnements: nombreNul,
  jaime_total: nombreNul,
  videos: nombreNul,
  vues_total: nombreNul,
  revenu_estime: nombreNul,
  devise: z.string().nullable(),
});

export const ligneRevenu = z.object({
  id: z.string(),
  reseau_connecte_id: z.string(),
  mois: z.string(),
  montant: nombre,
  devise: z.string(),
  source: z.enum(["api", "manuel"]),
  note: z.string(),
  cree_le: z.string(),
});

/** Étapes détaillées d'un test complet (progression.etapes), écrites par le worker. */
export const schemaEtapesTest = z
  .array(
    z
      .object({
        nom: z.string(),
        statut: z.string().optional(),
        ok: z.boolean().optional(),
        message: z.string().optional(),
        secondes: z.number().optional(),
      })
      .passthrough(),
  )
  .catch([]);

/** Valide un tableau de lignes ; les lignes invalides sont ignorées (et signalées en console serveur). */
export function lignes<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, donnees: unknown, table: string): T[] {
  if (!Array.isArray(donnees)) return [];
  const out: T[] = [];
  for (const brut of donnees) {
    const r = schema.safeParse(brut);
    if (r.success) out.push(r.data);
    else console.warn(`Ligne ${table} ignorée :`, r.error.issues[0]?.message);
  }
  return out;
}

/** Valide une ligne unique (null si absente ou invalide). */
export function ligne<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, donnee: unknown): T | null {
  if (donnee === null || donnee === undefined) return null;
  const r = schema.safeParse(donnee);
  return r.success ? r.data : null;
}

// Vérification à la compilation : chaque schéma produit bien le type de core.
type Verifie<A extends B, B> = A;
export type Controles = [
  Verifie<z.infer<typeof ligneEspace>, Espace>,
  Verifie<z.infer<typeof ligneReseau>, ReseauConnecte>,
  Verifie<z.infer<typeof ligneSerie>, Serie>,
  Verifie<z.infer<typeof lignePersonnage>, Personnage>,
  Verifie<z.infer<typeof ligneSaison>, Saison>,
  Verifie<z.infer<typeof ligneEpisode>, Episode>,
  Verifie<z.infer<typeof lignePlan>, Plan>,
  Verifie<z.infer<typeof ligneFichier>, Fichier>,
  Verifie<z.infer<typeof ligneTache>, Tache>,
  Verifie<z.infer<typeof lignePublication>, Publication>,
  Verifie<z.infer<typeof ligneMemoire>, FaitMemoire>,
  Verifie<z.infer<typeof ligneVideo>, VideoReseau>,
  Verifie<z.infer<typeof ligneStatsCompte>, StatsCompte>,
  Verifie<z.infer<typeof ligneRevenu>, Revenu>,
  Verifie<z.infer<typeof ligneReglages>["tarifs"], Tarifs>,
  Verifie<z.infer<typeof ligneReglages>["preferences"], Preferences>,
];
