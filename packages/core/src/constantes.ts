// Constantes métier partagées : langues, réseaux, types de plans, durées autorisées par Grok.

/** Langues gérées pour les voix, les sous-titres et les titres. */
export const LANGUES = ["fr", "en", "ja", "ko", "pt"] as const;
export type Langue = (typeof LANGUES)[number];

/** Nom affiché de chaque langue. */
export const NOMS_LANGUES: Record<Langue, string> = {
  fr: "Français",
  en: "Anglais",
  ja: "Japonais",
  ko: "Coréen",
  pt: "Portugais",
};

/** Choix des sous-titres d'une version : une langue précise, ou aucun. */
export type ChoixSousTitres = Langue | "aucun";

/** Réseaux de publication. Snapchat et Facebook sont volontairement exclus. */
export const RESEAUX = ["tiktok", "instagram", "youtube"] as const;
export type Reseau = (typeof RESEAUX)[number];

/** Nom affiché de chaque réseau. */
export const NOMS_RESEAUX: Record<Reseau, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

/** Types de plans et leur durée de base en secondes. Le rang sert à choisir quel plan allonger en premier (0 = d'abord). */
export const TYPES_PLAN = {
  accroche: { libelle: "Accroche", base: 3, rang: 5 },
  action: { libelle: "Action", base: 5, rang: 3 },
  dialogue: { libelle: "Dialogue", base: 8, rang: 2 },
  decor: { libelle: "Décor", base: 10, rang: 0 },
  climax: { libelle: "Climax", base: 8, rang: 1 },
  final: { libelle: "Final", base: 5, rang: 4 },
} as const;
export type TypePlan = keyof typeof TYPES_PLAN;
export const LISTE_TYPES_PLAN = Object.keys(TYPES_PLAN) as TypePlan[];

/** Durées de clip proposées. Grok accepte 1 à 15 s ; on se limite à ces paliers pour un montage régulier. */
export const DUREES_AUTORISEES = [3, 5, 8, 10, 15] as const;
export type DureeAutorisee = (typeof DUREES_AUTORISEES)[number];

/** Durée réservée dans un film long à l'opening (30 s) et à l'ending (30 s) de la saison. */
export const DUREE_GENERIQUES = 60;

/** Bornes de durée cible par format, en secondes. */
export const BORNES_DUREE = {
  court: { min: 60, max: 90, pas: 5, defaut: 75 },
  long: { min: 300, max: 1200, pas: 60, defaut: 1200 },
  generique: { min: 15, max: 45, pas: 5, defaut: 30 },
} as const;

/** Formats d'épisode. */
export type FormatEpisode = "court" | "long";
/** Genres d'épisode : un vrai épisode, ou le générique de début ou de fin d'une saison. */
export type GenreEpisode = "episode" | "opening" | "ending";

/** Origine de la voix d'un personnage. */
export type SourceVoix = "elevenlabs" | "elevenlabs_clone" | "grok";

/** Ce qui est publié : l'épisode court, le film complet (16:9) ou sa bande annonce (9:16). */
export type Livrable = "court" | "film" | "bande_annonce";

/** Hashtags de départ par langue (le nom de la série est ajouté ensuite). */
export const HASHTAGS: Record<Langue, string> = {
  fr: "#histoire #animation #série",
  en: "#story #animation #series",
  ja: "#アニメ #物語 #ショート",
  ko: "#애니메이션 #이야기 #쇼츠",
  pt: "#história #animação #série",
};

/** Accroche courte par langue, utilisée dans la troisième proposition de titre. */
export const ACCROCHES_TITRE: Record<Langue, string> = {
  fr: "La suite que personne n’attendait",
  en: "Nobody saw this coming",
  ja: "誰も予想しなかった続き",
  ko: "아무도 예상 못 한 이야기",
  pt: "Ninguém esperava por isso",
};

/** Mot « Épisode n » dans chaque langue. */
export function motEpisode(langue: Langue, n: number): string {
  switch (langue) {
    case "fr":
      return `Ép. ${n}`;
    case "en":
    case "pt":
      return `Ep. ${n}`;
    case "ja":
      return `第${n}話`;
    case "ko":
      return `${n}화`;
  }
}
