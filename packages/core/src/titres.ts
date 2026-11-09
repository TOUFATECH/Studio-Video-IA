// Titres, légendes et livrables d'une publication selon la langue et le réseau.
import { ACCROCHES_TITRE, DUREE_MAX_BANDE_ANNONCE, DUREE_MAX_PUBLICATION, motEpisode, type FormatEpisode, type Langue, type Livrable, type Reseau } from "./constantes";
import { hashtagsParDefaut, hashtagsPour } from "./hashtags";
import type { Episode, Serie } from "./types";

/** Trois propositions de titre pour une langue. La traduction du titre est utilisée si elle existe. */
export function propositionsTitres(episode: Pick<Episode, "titre" | "titres_traduits" | "numero" | "genre">, serie: Pick<Serie, "nom">, langue: Langue): [string, string, string] {
  const titre = episode.titres_traduits[langue] ?? episode.titre;
  if (episode.genre !== "episode") return [`${serie.nom} · ${titre}`, titre, serie.nom];
  const mot = motEpisode(langue, episode.numero);
  const base = langue === "ja" ? `${mot}「${titre}」` : `${mot} — ${titre}`;
  return [base, `${serie.nom} · ${base}`, `${ACCROCHES_TITRE[langue]} · ${serie.nom}`];
}

/** Hashtags par défaut d'une publication : ceux de la langue, puis le nom de la série en un seul mot. */
export function hashtags(serie: Pick<Serie, "nom">, langue: Langue): string {
  return hashtagsParDefaut(serie.nom, langue);
}

/** Titre retenu pour une langue (choix fait dans l'étape Montage, sinon la première proposition). */
export function titreChoisi(episode: Pick<Episode, "titre" | "titres_traduits" | "numero" | "genre" | "choix_titres">, serie: Pick<Serie, "nom">, langue: Langue): string {
  const options = propositionsTitres(episode, serie, langue);
  const i = episode.choix_titres[langue] ?? 0;
  return options[i] ?? options[0];
}

/** Ce qu'on publie sur un réseau : un épisode YouTube ou un film part en entier sur YouTube et en bande annonce ailleurs. */
export function livrablePour(episode: Pick<Episode, "format">, reseau: Reseau): Livrable {
  if (episode.format === "court") return "court";
  return reseau === "youtube" ? "film" : "bande_annonce";
}

/** Libellé lisible d'un livrable pour un réseau (`format` précise « Épisode » ou « Film » pour la version 16:9). */
export function libelleLivrable(livrable: Livrable, reseau: Reseau, format?: FormatEpisode): string {
  if (livrable === "film") return format === "moyen" ? "Épisode YouTube 16:9" : "Film 16:9";
  if (livrable === "bande_annonce") return "Bande annonce 9:16";
  if (reseau === "youtube") return "Short 9:16";
  if (reseau === "instagram") return "Reel 9:16";
  return "Vidéo 9:16";
}

/**
 * Légende complète (titre, description, hashtags) d'une publication.
 * Avec un réseau : hashtags de l'épisode, sinon de la série, sinon par défaut, nettoyés selon les limites du réseau.
 */
export function legende(
  episode: Pick<Episode, "titre" | "titres_traduits" | "numero" | "genre" | "choix_titres" | "idee"> & { hashtags?: Episode["hashtags"] },
  serie: Pick<Serie, "nom"> & { hashtags?: Serie["hashtags"] },
  langue: Langue,
  reseau?: Reseau,
): { titre: string; description: string; tags: string } {
  const titre = titreChoisi(episode, serie, langue);
  const tags = reseau
    ? hashtagsPour({ reseau, langue, nomSerie: serie.nom, serie: serie.hashtags ?? {}, episode: episode.hashtags ?? {} })
    : hashtags(serie, langue);
  return { titre, description: `${titre}\n\n${tags}`, tags };
}

/**
 * Vérifie qu'une vidéo respecte la durée maximale voulue pour le réseau.
 * Renvoie null si c'est bon, sinon un message à afficher. `duree` en secondes.
 */
export function verifierDureePublication(params: { reseau: Reseau; livrable: Livrable; format: FormatEpisode; duree: number }): string | null {
  const { reseau, livrable, format, duree } = params;
  const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  // Une seconde de tolérance : le rendu peut dépasser la cible de quelques images.
  const depasse = (max: number): boolean => duree > max + 1;
  if (livrable === "bande_annonce") {
    return depasse(DUREE_MAX_BANDE_ANNONCE) ? `La bande annonce dure ${mmss(duree)} : 1:00 maximum.` : null;
  }
  if (livrable === "court") {
    if (reseau === "youtube") return depasse(DUREE_MAX_PUBLICATION.youtube_short) ? `Short YouTube de ${mmss(duree)} : 3:00 maximum.` : null;
    return depasse(DUREE_MAX_PUBLICATION[reseau]) ? `Vidéo de ${mmss(duree)} : ${reseau === "tiktok" ? "TikTok" : "Instagram"} est limité à 2:00 dans Feuilleton.` : null;
  }
  // Version 16:9 complète, seulement sur YouTube.
  if (reseau !== "youtube") return "La version 16:9 complète ne se publie que sur YouTube.";
  if (format === "moyen" && depasse(DUREE_MAX_PUBLICATION.youtube_episode)) return `Épisode YouTube de ${mmss(duree)} : 4:00 maximum.`;
  return null;
}
