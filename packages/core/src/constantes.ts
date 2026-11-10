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

/** Genres d'épisode : un vrai épisode, le générique de début ou de fin d'une saison, ou un clip musical. */
export type GenreEpisode = "episode" | "opening" | "ending" | "clip";

/** Genre d'une série : une série d'histoires, ou l'espace Clips du compte (un seul par compte). */
export type GenreSerie = "serie" | "clips";

/** Durées de clip proposées. Grok accepte 1 à 15 s ; on se limite à ces paliers pour un montage régulier. */
export const DUREES_AUTORISEES = [3, 5, 8, 10, 15] as const;
export type DureeAutorisee = (typeof DUREES_AUTORISEES)[number];

/** Durée réservée dans un film long à l'opening (30 s) et à l'ending (30 s) de la saison. */
export const DUREE_GENERIQUES = 60;

/**
 * Bornes de durée cible par format, en secondes.
 * court : épisode vertical pour TikTok, Instagram et Short YouTube (1:00 à 2:00).
 * moyen : épisode YouTube 16:9 (2:00 à 4:00), avec bande annonce verticale pour TikTok et Instagram.
 * long : film 16:9 (5 à 20 min) avec opening, ending et bande annonce.
 */
export const BORNES_DUREE = {
  court: { min: 60, max: 120, pas: 15, defaut: 75 },
  moyen: { min: 120, max: 240, pas: 30, defaut: 180 },
  long: { min: 300, max: 1200, pas: 60, defaut: 1200 },
  generique: { min: 15, max: 45, pas: 5, defaut: 30 },
} as const;

/** Formats d'épisode (voir BORNES_DUREE). */
export type FormatEpisode = "court" | "moyen" | "long";

/** Libellé de chaque format dans l'interface. */
export const NOMS_FORMATS: Record<FormatEpisode, string> = {
  court: "Court · 1:00 à 2:00 · vertical · TikTok, Instagram, Short YouTube",
  moyen: "YouTube · 2:00 à 4:00 · 16:9 · bande annonce verticale pour TikTok et Instagram",
  long: "Film · 5 à 20 min · 16:9 · opening, ending et bande annonce",
};

/** Vrai si le format est tourné en 16:9 (épisode YouTube et film). */
export function estHorizontal(format: FormatEpisode): boolean {
  return format !== "court";
}

/**
 * Durée maximale d'un clip musical par format, en secondes :
 * court (vertical, TikTok, Instagram, Short) 2:00, moyen (YouTube 16:9) 4:00, long (chanson entière en 16:9) 10:00.
 */
export const DUREE_MAX_CLIP: Record<FormatEpisode, number> = { court: 120, moyen: 240, long: 600 };

/** Libellé de chaque format pour un clip. */
export const NOMS_FORMATS_CLIP: Record<FormatEpisode, string> = {
  court: "Vertical · 2:00 max · TikTok, Instagram, Short YouTube",
  moyen: "YouTube · 4:00 max · 16:9",
  long: "Chanson entière · 10:00 max · 16:9 · YouTube",
};

/** Fournisseur du texte d'un clip (scènes et paroles) : ChatGPT (OpenAI) ou Claude (Anthropic). */
export type FournisseurTexte = "openai" | "anthropic";
export const NOMS_FOURNISSEURS_TEXTE: Record<FournisseurTexte, string> = { openai: "ChatGPT", anthropic: "Claude" };

/** Vrai si l'épisode a une bande annonce verticale (épisode YouTube et film). */
export function aBandeAnnonce(format: FormatEpisode, genre: GenreEpisode): boolean {
  return genre === "episode" && format !== "court";
}

/** Vrai si l'épisode est encadré par l'opening et l'ending de la saison (film seulement). */
export function aGeneriques(format: FormatEpisode, genre: GenreEpisode): boolean {
  return genre === "episode" && format === "long";
}

/** Durée maximale d'une bande annonce, en secondes. */
export const DUREE_MAX_BANDE_ANNONCE = 60;

/**
 * Durées maximales de publication, en secondes, voulues pour la série :
 * TikTok et Instagram 2 min, Short YouTube 3 min, épisode YouTube 4 min. Le film long n'a pas de limite ici
 * (YouTube exige seulement un compte validé au-delà de 15 min).
 */
export const DUREE_MAX_PUBLICATION = { tiktok: 120, instagram: 120, youtube_short: 180, youtube_episode: 240 } as const;

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

/** Hashtags de départ d'un clip musical, par langue. */
export const HASHTAGS_CLIP: Record<Langue, string> = {
  fr: "#clip #musique #music",
  en: "#musicvideo #music #newmusic",
  ja: "#MV #音楽 #music",
  ko: "#뮤직비디오 #음악 #music",
  pt: "#clipe #música #music",
};

/** Mention « clip officiel » par langue, utilisée dans les titres de clips. */
export const MOT_CLIP: Record<Langue, string> = {
  fr: "Clip officiel",
  en: "Official Music Video",
  ja: "公式MV",
  ko: "공식 뮤직비디오",
  pt: "Videoclipe oficial",
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
