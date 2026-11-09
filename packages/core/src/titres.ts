// Titres, légendes et livrables d'une publication selon la langue et le réseau.
import { ACCROCHES_TITRE, HASHTAGS, motEpisode, type Langue, type Livrable, type Reseau } from "./constantes";
import type { Episode, Serie } from "./types";

/** Trois propositions de titre pour une langue. La traduction du titre est utilisée si elle existe. */
export function propositionsTitres(episode: Pick<Episode, "titre" | "titres_traduits" | "numero" | "genre">, serie: Pick<Serie, "nom">, langue: Langue): [string, string, string] {
  const titre = episode.titres_traduits[langue] ?? episode.titre;
  if (episode.genre !== "episode") return [`${serie.nom} · ${titre}`, titre, serie.nom];
  const mot = motEpisode(langue, episode.numero);
  const base = langue === "ja" ? `${mot}「${titre}」` : `${mot} — ${titre}`;
  return [base, `${serie.nom} · ${base}`, `${ACCROCHES_TITRE[langue]} · ${serie.nom}`];
}

/** Hashtags d'une publication : ceux de la langue, puis le nom de la série en un seul mot. */
export function hashtags(serie: Pick<Serie, "nom">, langue: Langue): string {
  const mot = serie.nom.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  return mot ? `${HASHTAGS[langue]} #${mot}` : HASHTAGS[langue];
}

/** Titre retenu pour une langue (choix fait dans l'étape Montage, sinon la première proposition). */
export function titreChoisi(episode: Pick<Episode, "titre" | "titres_traduits" | "numero" | "genre" | "choix_titres">, serie: Pick<Serie, "nom">, langue: Langue): string {
  const options = propositionsTitres(episode, serie, langue);
  const i = episode.choix_titres[langue] ?? 0;
  return options[i] ?? options[0];
}

/** Ce qu'on publie sur un réseau : un film part en entier sur YouTube et en bande annonce ailleurs. */
export function livrablePour(episode: Pick<Episode, "format">, reseau: Reseau): Livrable {
  if (episode.format !== "long") return "court";
  return reseau === "youtube" ? "film" : "bande_annonce";
}

/** Libellé lisible d'un livrable pour un réseau. */
export function libelleLivrable(livrable: Livrable, reseau: Reseau): string {
  if (livrable === "film") return "Film 16:9";
  if (livrable === "bande_annonce") return "Bande annonce 9:16";
  if (reseau === "youtube") return "Short 9:16";
  if (reseau === "instagram") return "Reel 9:16";
  return "Vidéo 9:16";
}

/** Légende complète (titre, description, hashtags) d'une publication. */
export function legende(episode: Pick<Episode, "titre" | "titres_traduits" | "numero" | "genre" | "choix_titres" | "idee">, serie: Pick<Serie, "nom">, langue: Langue): { titre: string; description: string; tags: string } {
  const titre = titreChoisi(episode, serie, langue);
  const tags = hashtags(serie, langue);
  return { titre, description: `${titre}\n\n${tags}`, tags };
}
