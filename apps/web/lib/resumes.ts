// Résumés calculés à partir des données de production : avancement d'une série, épisodes prêts, publications.
import type { Episode, EtatEpisode, Langue, Publication, Saison, Serie } from "@studio-video-ia/core";

/** Données nécessaires au résumé d'une série. */
type Source = { episodes: readonly Episode[]; saisons: readonly Saison[]; publications: readonly Publication[]; etats: ReadonlyMap<string, EtatEpisode> };

/** Résumé d'une série pour les cartes et l'accueil. */
export type ResumeSerie = {
  pourcentage: number;
  publies: number;
  total: number;
  saisons: number;
  vues: number;
  langues: Langue[];
  prochaine: Publication | null;
};

/** Calcule l'avancement moyen, les épisodes publiés, les vues et la prochaine sortie d'une série. */
export function resumeSerie(serie: Pick<Serie, "id">, s: Source): ResumeSerie {
  const eps = s.episodes.filter((e) => e.serie_id === serie.id && e.genre === "episode");
  const ids = new Set(eps.map((e) => e.id));
  const etats = eps.map((e) => s.etats.get(e.id)).filter((x): x is EtatEpisode => !!x);
  const pubs = s.publications.filter((p) => ids.has(p.episode_id));
  const maintenant = Date.now();
  const prochaine = pubs.filter((p) => (p.statut === "programmee" || p.statut === "attend_rendu") && Date.parse(p.programmee_le) >= maintenant - 3600_000).sort((a, b) => a.programmee_le.localeCompare(b.programmee_le))[0] ?? null;
  const langues = [...new Set(eps.flatMap((e) => e.langues))];
  return {
    pourcentage: etats.length ? Math.round(etats.reduce((a, e) => a + e.pourcentage, 0) / etats.length) : 0,
    publies: etats.filter((e) => e.publiees > 0).length,
    total: eps.length,
    saisons: s.saisons.filter((x) => x.serie_id === serie.id).length,
    vues: pubs.reduce((a, p) => a + (p.stats.vues ?? 0), 0),
    langues,
    prochaine,
  };
}

/** Vrai si l'épisode est rendu dans toutes ses langues, sans publication ni tâche en cours. */
export function estPretAPublier(e: Pick<Episode, "genre">, etat: EtatEpisode | undefined): boolean {
  return !!etat && e.genre === "episode" && !etat.tacheEnCours && etat.rendus.total > 0 && etat.rendus.fait === etat.rendus.total && etat.publiees === 0 && etat.programmees === 0;
}
