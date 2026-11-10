// Petits calculs d'affichage communs aux épisodes : code « S1E2 », nom, ordre de lecture.
import type { Episode, Saison } from "@studio-video-ia/core";

/** Adresse de la page d'un épisode, ou d'un clip dans l'espace Clips, à une étape donnée. */
export function lienEpisode(episode: Pick<Episode, "id" | "genre">, etape?: string): string {
  return `${episode.genre === "clip" ? "/clips" : "/episodes"}/${episode.id}${etape ? `?etape=${etape}` : ""}`;
}

/** Code court d'un épisode : « S1E2 », « S1·OP », « S1·ED », ou « Clip 3 ». */
export function codeEpisode(episode: Pick<Episode, "genre" | "numero">, saison: Pick<Saison, "numero"> | undefined): string {
  if (episode.genre === "clip") return `Clip ${episode.numero}`;
  const s = `S${saison?.numero ?? "?"}`;
  if (episode.genre === "opening") return `${s}·OP`;
  if (episode.genre === "ending") return `${s}·ED`;
  return `${s}E${episode.numero}`;
}

/** Nom affiché : le titre, ou « Opening saison 1 » pour un générique. */
export function nomEpisode(episode: Pick<Episode, "genre" | "titre" | "numero">, saison: Pick<Saison, "numero"> | undefined): string {
  if (episode.genre === "opening") return `Opening saison ${saison?.numero ?? "?"}`;
  if (episode.genre === "ending") return `Ending saison ${saison?.numero ?? "?"}`;
  if (episode.genre === "clip") return episode.titre.trim() || `Clip ${episode.numero}`;
  return episode.titre.trim() || `Épisode ${episode.numero}`;
}

/** Épisodes (genre « episode ») dans l'ordre de lecture : saison puis numéro. */
export function ordreLecture<E extends Pick<Episode, "id" | "genre" | "numero" | "saison_id">>(episodes: readonly E[], saisons: readonly Pick<Saison, "id" | "numero">[]): E[] {
  const num = new Map(saisons.map((s) => [s.id, s.numero]));
  return episodes
    .filter((e) => e.genre === "episode")
    .sort((a, b) => (num.get(a.saison_id) ?? 0) - (num.get(b.saison_id) ?? 0) || a.numero - b.numero);
}
