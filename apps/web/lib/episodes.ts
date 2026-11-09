// Petits calculs d'affichage communs aux épisodes : code « S1E2 », nom, ordre de lecture.
import type { Episode, Saison } from "@studio-video-ia/core";

/** Code court d'un épisode : « S1E2 », « S1·OP » ou « S1·ED ». */
export function codeEpisode(episode: Pick<Episode, "genre" | "numero">, saison: Pick<Saison, "numero"> | undefined): string {
  const s = `S${saison?.numero ?? "?"}`;
  if (episode.genre === "opening") return `${s}·OP`;
  if (episode.genre === "ending") return `${s}·ED`;
  return `${s}E${episode.numero}`;
}

/** Nom affiché : le titre, ou « Opening saison 1 » pour un générique. */
export function nomEpisode(episode: Pick<Episode, "genre" | "titre" | "numero">, saison: Pick<Saison, "numero"> | undefined): string {
  if (episode.genre === "opening") return `Opening saison ${saison?.numero ?? "?"}`;
  if (episode.genre === "ending") return `Ending saison ${saison?.numero ?? "?"}`;
  return episode.titre.trim() || `Épisode ${episode.numero}`;
}

/** Épisodes (genre « episode ») dans l'ordre de lecture : saison puis numéro. */
export function ordreLecture<E extends Pick<Episode, "id" | "genre" | "numero" | "saison_id">>(episodes: readonly E[], saisons: readonly Pick<Saison, "id" | "numero">[]): E[] {
  const num = new Map(saisons.map((s) => [s.id, s.numero]));
  return episodes
    .filter((e) => e.genre === "episode")
    .sort((a, b) => (num.get(a.saison_id) ?? 0) - (num.get(b.saison_id) ?? 0) || a.numero - b.numero);
}
