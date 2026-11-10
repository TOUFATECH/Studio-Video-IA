// Types des lignes de la base (SQLite ou PostgreSQL) et schémas Zod des champs JSON.
// Les noms suivent exactement les colonnes de packages/base/src/schema-sqlite.ts.
import { z } from "zod";
import {
  LANGUES,
  LISTE_TYPES_PLAN,
  RESEAUX,
  type ChoixSousTitres,
  type FormatEpisode,
  type FournisseurTexte,
  type GenreEpisode,
  type GenreSerie,
  type Langue,
  type Livrable,
  type Reseau,
  type SourceVoix,
  type TypePlan,
} from "./constantes";

/** Schéma d'une langue. */
export const schemaLangue = z.enum(LANGUES);
/** Schéma d'un réseau. */
export const schemaReseau = z.enum(RESEAUX);
/** Schéma d'un type de plan. */
export const schemaTypePlan = z.enum(LISTE_TYPES_PLAN as [TypePlan, ...TypePlan[]]);
/** Schéma d'un choix de sous-titres. */
export const schemaSousTitres = z.union([schemaLangue, z.literal("aucun")]);

/** Rythme de publication d'une série : un épisode tous les N jours à HH:MM sur ces réseaux connectés. */
export const schemaRythme = z.object({
  tous_les_jours: z.number().int().min(1).max(30),
  heure: z.string().regex(/^\d{2}:\d{2}$/),
  reseaux: z.array(z.string().uuid()),
  auto: z.boolean(),
});
export type Rythme = z.infer<typeof schemaRythme>;

/** Tarifs saisis par l'utilisateur pour estimer les coûts (en euros). */
export const schemaTarifs = z.object({
  image: z.number().min(0),
  video_seconde: z.number().min(0),
  voix_1000_car: z.number().min(0),
  /** Prix d'une minute de musique générée (ElevenLabs Music). Absent des anciens réglages : valeur d'exemple. */
  musique_minute: z.number().min(0).default(0.5),
});
export type Tarifs = z.infer<typeof schemaTarifs>;

/** Préférences générales. */
export const schemaPreferences = z.object({
  parallele: z.number().int().min(1).max(4),
  sous_titres: schemaSousTitres,
  prises: z.union([z.literal(1), z.literal(2)]),
  memoire_auto: z.boolean(),
});
export type Preferences = z.infer<typeof schemaPreferences>;

/** Chapitre d'un film long. */
export const schemaChapitre = z.object({ section: z.string(), titre: z.string() });
export type Chapitre = z.infer<typeof schemaChapitre>;

/** Sous-titres choisis par version : { "fr": "en", "ja": "aucun" }. */
export const schemaSousTitresParVersion = z.record(schemaLangue, schemaSousTitres);
export type SousTitresParVersion = Partial<Record<Langue, ChoixSousTitres>>;

/** Un « compte » de l'utilisateur (espace) : ses réseaux, ses séries, son budget. */
export type Espace = {
  id: string;
  proprietaire: string;
  nom: string;
  couleur: string;
  plafond_mensuel: number;
  fuseau: string;
  cree_le: string;
};

/** Un compte de réseau social connecté à un espace. Les jetons ne sont jamais lus côté navigateur. */
export type ReseauConnecte = {
  id: string;
  espace_id: string;
  reseau: Reseau;
  nom_compte: string;
  langue: Langue;
  id_externe: string | null;
  jeton_expire_le: string | null;
  statut: "connecte" | "expire" | "deconnecte";
  audit_tiktok_valide: boolean;
  infos: Record<string, unknown>;
  cree_le: string;
};

/** Une série : son univers, sa langue, son rythme de publication. */
export type Serie = {
  id: string;
  espace_id: string;
  nom: string;
  style_visuel: string;
  langue: Langue;
  univers: string;
  fil_rouge: string;
  rythme: Rythme;
  /** Hashtags par défaut de la série, par réseau. */
  hashtags: Partial<Record<Reseau, string>>;
  /** « serie » pour une série d'histoires, « clips » pour l'espace Clips du compte. */
  genre: GenreSerie;
  cree_le: string;
};

/** Une ligne de paroles placée dans la chanson (secondes depuis le début du fichier audio). */
export const schemaLigneParole = z.object({ texte: z.string(), debut: z.number().min(0), fin: z.number().min(0) });
export type LigneParole = z.infer<typeof schemaLigneParole>;

/** Un personnage de la bible. */
export type Personnage = {
  id: string;
  serie_id: string;
  nom: string;
  description: string;
  source_voix: SourceVoix;
  voix_id: string;
  accord_clone: boolean;
  fiche_chemin: string | null;
  fiche_statut: "a_faire" | "en_cours" | "prete" | "echec";
  position: number;
};

/** Une saison, avec son opening et son ending (épisodes de genre opening/ending). */
export type Saison = {
  id: string;
  serie_id: string;
  numero: number;
  opening_id: string | null;
  ending_id: string | null;
};

/** Un épisode (ou un générique). */
export type Episode = {
  id: string;
  serie_id: string;
  saison_id: string;
  genre: GenreEpisode;
  numero: number;
  titre: string;
  idee: string;
  format: FormatEpisode;
  duree_cible: number;
  langue: Langue;
  langues: Langue[];
  sous_titres: SousTitresParVersion;
  prises: 1 | 2;
  enchainer: boolean;
  musique: boolean;
  bruitages: boolean;
  chapitres: Chapitre[];
  titres_traduits: Partial<Record<Langue, string>>;
  choix_titres: Partial<Record<Langue, number>>;
  miniature: { choix: number; chemins: string[] } | null;
  memoire_faite: boolean;
  /** Hashtags propres à l'épisode (remplacent ceux de la série pour ce réseau). */
  hashtags: Partial<Record<Reseau, string>>;
  // ----- Champs propres aux clips musicaux (genre « clip ») -----
  /** Style visuel du clip ; vide = celui de l'espace Clips. */
  style_visuel: string;
  /** Paroles saisies (les lignes « [Refrain] » marquent les sections). */
  paroles: string;
  /** Paroles placées dans la chanson par la synchronisation ; null tant qu'elle n'est pas faite. */
  paroles_alignees: LigneParole[] | null;
  /** Traduction de chaque ligne alignée, par langue (même ordre que `paroles_alignees`). */
  paroles_traduites: Partial<Record<Langue, string[]>>;
  /** Tempo en battements par minute, si connu : les coupes tombent alors sur le temps. */
  bpm: number | null;
  /** Début et fin de l'extrait de la chanson utilisé (secondes). Fin null = jusqu'au bout, dans la limite du format. */
  extrait_debut: number;
  extrait_fin: number | null;
  /** Style musical demandé pour générer la chanson (ElevenLabs Music). */
  musique_style: string;
  /** Vrai pour générer une musique sans chant. */
  instrumental: boolean;
  /** IA qui écrit les scènes et les paroles du clip. */
  fournisseur_texte: FournisseurTexte;
  cree_le: string;
};

/** Un plan du scénario : un clip Grok de 3 à 15 s. */
export type Plan = {
  id: string;
  episode_id: string;
  position: number;
  section: string;
  type: TypePlan;
  texte: string;
  personnage_id: string | null;
  replique: string;
  repliques_traduites: Partial<Record<Langue, string>>;
  duree_fixee: number | null;
  valide: boolean;
  modifie: boolean;
  prise_choisie: "A" | "B";
  /** Pour un clip : début et fin du plan dans la chanson (secondes). Null pour un épisode. */
  debut: number | null;
  fin: number | null;
};

/** Genre de fichier produit ou importé. */
export type GenreFichier =
  | "image"
  | "clip"
  | "voix"
  | "rendu"
  | "bande_annonce"
  | "miniature"
  | "fiche"
  | "bruitage"
  | "musique"
  | "echantillon_voix"
  | "chanson";

/** Un fichier stocké dans le dossier des médias (image, clip, voix, rendu…). */
export type Fichier = {
  id: string;
  espace_id: string;
  episode_id: string | null;
  plan_id: string | null;
  personnage_id: string | null;
  genre: GenreFichier;
  langue: Langue | null;
  prise: "A" | "B" | null;
  chemin: string | null;
  duree_s: number | null;
  secondes_generation: number | null;
  cout: number;
  statut: "pret" | "echec";
  erreur: string | null;
  essais: number;
  cree_le: string;
};

/** Types de tâches traitées par le worker. */
export type TypeTache =
  | "scenario"
  | "storyboard"
  | "clips"
  | "rendu"
  | "publication"
  | "stats"
  | "fiche_personnage"
  | "memoire"
  | "clone_voix"
  | "test_complet"
  | "paroles"
  | "musique"
  | "synchro";
/** État d'une tâche. */
export type StatutTache = "en_file" | "en_cours" | "terminee" | "echec" | "en_pause" | "annulee";

/** Une tâche de la file du worker. */
export type Tache = {
  id: string;
  espace_id: string;
  episode_id: string | null;
  publication_id: string | null;
  type: TypeTache;
  statut: StatutTache;
  priorite: number;
  donnees: Record<string, unknown>;
  progression: { fait?: number; total?: number; etape?: string; secondes?: number };
  erreur: string | null;
  essais: number;
  executer_apres: string;
  verrouille_par: string | null;
  verrouille_le: string | null;
  cree_le: string;
  modifie_le: string;
};

/** État d'une publication. */
export type StatutPublication =
  | "attend_rendu"
  | "programmee"
  | "envoi"
  | "traitement"
  | "publiee"
  | "privee"
  | "echec"
  | "annulee";

/** Statistiques importées d'un réseau. */
export type StatsPublication = { vues?: number; jaime?: number; commentaires?: number; partages?: number };

/** Une publication sur un réseau connecté, à une date précise. */
export type Publication = {
  id: string;
  episode_id: string;
  reseau_connecte_id: string;
  langue: Langue;
  livrable: Livrable;
  programmee_le: string;
  statut: StatutPublication;
  id_externe: string | null;
  url: string | null;
  erreur: string | null;
  progression: number;
  stats: StatsPublication;
  stats_le: string | null;
  publiee_le: string | null;
  cree_le: string;
};

/** Un fait retenu par la mémoire de la série. */
export type FaitMemoire = {
  id: string;
  serie_id: string;
  episode_id: string | null;
  genre: "fait" | "personnage" | "lieu" | "objet" | "mystere";
  texte: string;
  ouvert: boolean;
  cree_le: string;
};

/** Une vidéo présente sur un compte connecté (publiée par l'app ou non), avec ses derniers chiffres. */
export type VideoReseau = {
  id: string;
  reseau_connecte_id: string;
  id_externe: string;
  publication_id: string | null;
  titre: string;
  url: string | null;
  miniature_url: string | null;
  publiee_le: string | null;
  duree_s: number | null;
  vues: number;
  jaime: number;
  commentaires: number;
  partages: number;
  revenu_estime: number | null;
  devise: string | null;
  maj_le: string;
};

/** Chiffres d'un compte pour un jour donné (abonnés, vues totales, revenus estimés). */
export type StatsCompte = {
  id: string;
  reseau_connecte_id: string;
  jour: string;
  abonnes: number | null;
  abonnements: number | null;
  jaime_total: number | null;
  videos: number | null;
  vues_total: number | null;
  revenu_estime: number | null;
  devise: string | null;
};

/** Revenu d'un mois pour un compte : lu par l'API (YouTube) ou saisi à la main (TikTok, Instagram). */
export type Revenu = {
  id: string;
  reseau_connecte_id: string;
  mois: string;
  montant: number;
  devise: string;
  source: "api" | "manuel";
  note: string;
  cree_le: string;
};

/** Fournisseurs de clés API. google, meta et tiktok contiennent un couple identifiant/secret d'application OAuth. */
export const FOURNISSEURS = ["openai", "xai", "elevenlabs", "google", "meta", "tiktok", "anthropic"] as const;
export type Fournisseur = (typeof FOURNISSEURS)[number];

/** Contenu d'une clé d'application OAuth (Google, Meta, TikTok). */
export const schemaAppOAuth = z.object({ client_id: z.string().min(4), client_secret: z.string().min(4) });
export type AppOAuth = z.infer<typeof schemaAppOAuth>;

/** Plan renvoyé par l'IA lors de l'écriture d'un scénario (validé avant d'être enregistré). */
export const schemaPlanIA = z.object({
  type: schemaTypePlan,
  texte: z.string().min(3),
  personnage: z.string().nullable(),
  replique: z.string(),
  section: z.string().optional(),
});
/** Scénario complet renvoyé par l'IA. */
export const schemaScenarioIA = z.object({
  titre: z.string().min(1),
  plans: z.array(schemaPlanIA).min(1),
  chapitres: z.array(schemaChapitre).optional(),
});
export type ScenarioIA = z.infer<typeof schemaScenarioIA>;

/** Scènes d'un clip renvoyées par l'IA : une description par segment, dans l'ordre. */
export const schemaClipIA = z.object({
  titre: z.string().min(1),
  plans: z
    .array(
      z.object({
        index: z.number().int().min(0),
        texte: z.string().min(3),
        personnage: z.string().nullable().optional(),
      }),
    )
    .min(1),
});
export type ClipIA = z.infer<typeof schemaClipIA>;

/** Paroles écrites par l'IA à partir d'une idée. */
export const schemaParolesIA = z.object({ titre: z.string().min(1), paroles: z.string().min(10) });
export type ParolesIA = z.infer<typeof schemaParolesIA>;

/** Faits extraits par l'IA à la fin d'un épisode. */
export const schemaFaitsIA = z.object({
  faits: z.array(
    z.object({
      genre: z.enum(["fait", "personnage", "lieu", "objet", "mystere"]),
      texte: z.string().min(3),
      ouvert: z.boolean(),
    }),
  ),
  mysteres_resolus: z.array(z.string()).default([]),
});
export type FaitsIA = z.infer<typeof schemaFaitsIA>;

export type { ChoixSousTitres, FormatEpisode, FournisseurTexte, GenreEpisode, GenreSerie, Langue, Livrable, Reseau, SourceVoix, TypePlan };
