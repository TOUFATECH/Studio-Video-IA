// Hashtags par réseau : nettoyage, limites de chaque réseau, choix entre l'épisode, la série et les valeurs par défaut.
import { HASHTAGS, HASHTAGS_CLIP, type Langue, type Reseau } from "./constantes";

/** Hashtags par réseau, tels qu'enregistrés dans `series.hashtags` et `episodes.hashtags`. */
export type HashtagsParReseau = Partial<Record<Reseau, string>>;

/** Nombre maximal de hashtags accepté par réseau (Instagram en refuse au-delà de 30). */
export const MAX_HASHTAGS: Record<Reseau, number> = { tiktok: 30, instagram: 30, youtube: 15 };

/**
 * Nettoie une saisie libre : « histoire, #Anime  série » → « #histoire #anime #série ».
 * Ajoute le #, retire la ponctuation, met en minuscules, supprime les doublons, applique la limite du réseau.
 */
export function normaliserHashtags(saisie: string, reseau: Reseau): string {
  const vus = new Set<string>();
  const out: string[] = [];
  for (const brut of saisie.split(/[\s,;]+/)) {
    // Les hashtags acceptent lettres et chiffres de toutes les langues (japonais, coréen…), pas d'espaces ni de ponctuation.
    const mot = brut.replace(/^#+/, "").normalize("NFKC").replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase();
    if (!mot || vus.has(mot)) continue;
    vus.add(mot);
    out.push(`#${mot}`);
    if (out.length >= MAX_HASHTAGS[reseau]) break;
  }
  return out.join(" ");
}

/**
 * Hashtags par défaut pour une série et une langue : ceux de la langue, puis le nom de la série en un mot.
 * Pour un clip musical, les hashtags musique remplacent ceux des séries.
 */
export function hashtagsParDefaut(nomSerie: string, langue: Langue, clip = false): string {
  const base = (clip ? HASHTAGS_CLIP : HASHTAGS)[langue];
  const mot = nomSerie.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  return mot ? `${base} #${mot}` : base;
}

/** Hashtags retenus pour une publication : ceux de l'épisode, sinon ceux de la série, sinon les valeurs par défaut. */
export function hashtagsPour(params: {
  reseau: Reseau;
  langue: Langue;
  nomSerie: string;
  serie: HashtagsParReseau;
  episode: HashtagsParReseau;
  clip?: boolean;
}): string {
  const brut = params.episode[params.reseau]?.trim() || params.serie[params.reseau]?.trim() || hashtagsParDefaut(params.nomSerie, params.langue, params.clip ?? false);
  return normaliserHashtags(brut, params.reseau);
}

/** Longueur maximale de la légende par réseau (titre + description + hashtags). */
export const MAX_LEGENDE: Record<Reseau, number> = { tiktok: 2200, instagram: 2200, youtube: 5000 };
