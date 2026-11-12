// Unités de génération d'un épisode (une image, un clip, une voix, un rendu) et leur coût estimé.
import { dureeGenerationClip } from "./clip";
import { aBandeAnnonce, type Langue } from "./constantes";
import type { Episode, Fichier, Personnage, Plan, Tarifs } from "./types";

/** Genre d'unité produite par le worker. */
export type GenreUnite = "image" | "clip" | "voix" | "rendu" | "bande_annonce";

/** Une unité à produire. `cle` est stable : elle relie l'unité au fichier qui la matérialise. */
export type Unite = {
  cle: string;
  genre: GenreUnite;
  plan: Plan | null;
  langue: Langue | null;
  prise: "A" | "B" | null;
};

/** Clé d'un fichier, au même format que `Unite.cle`. */
export function cleFichier(f: Pick<Fichier, "plan_id" | "genre" | "langue" | "prise">): string {
  if (f.genre === "rendu") return `rendu:${f.langue ?? ""}`;
  if (f.genre === "bande_annonce") return "bande_annonce";
  if (f.genre === "clip") return `${f.plan_id ?? ""}:clip:${f.prise ?? "A"}`;
  if (f.genre === "voix") return `${f.plan_id ?? ""}:voix:${f.langue ?? ""}`;
  return `${f.plan_id ?? ""}:${f.genre}`;
}

/** Date qui classe les versions : le choix de l'utilisateur (actif_le) passe avant la date de création. */
export function dateVersion(f: Pick<Fichier, "cree_le"> & { actif_le?: string | null }): string {
  return f.actif_le && f.actif_le > f.cree_le ? f.actif_le : f.cree_le;
}

/** Index clé → fichier, en gardant la version retenue (la plus récente) quand il y en a plusieurs. */
export function indexerFichiers(fichiers: readonly Fichier[]): Map<string, Fichier> {
  const m = new Map<string, Fichier>();
  const tries = [...fichiers].sort((a, b) => dateVersion(a).localeCompare(dateVersion(b)));
  for (const f of tries) m.set(cleFichier(f), f);
  return m;
}

/** Toutes les versions prêtes d'une unité, de la plus récente à la plus ancienne (historique). */
export function versionsDe(fichiers: readonly Fichier[], cle: string): Fichier[] {
  return fichiers.filter((f) => f.statut === "pret" && f.chemin && cleFichier(f) === cle).sort((a, b) => b.cree_le.localeCompare(a.cree_le));
}

/** Vrai si le plan a une réplique dite par une voix ElevenLabs (et non par l'audio du clip Grok). */
export function planParleElevenLabs(plan: Plan, personnages: readonly Personnage[]): boolean {
  if (plan.type !== "dialogue" || !plan.personnage_id || !plan.replique.trim()) return false;
  const p = personnages.find((x) => x.id === plan.personnage_id);
  return !!p && p.source_voix !== "grok";
}

/** Étape 2 : une image par plan. */
export function unitesStoryboard(plans: readonly Plan[]): Unite[] {
  return plans.map((p) => ({ cle: `${p.id}:image`, genre: "image", plan: p, langue: null, prise: null }));
}

/** Étape 3 : un clip par plan (deux si 2 prises), et une voix par réplique ElevenLabs et par langue de l'épisode. */
export function unitesClips(episode: Pick<Episode, "prises" | "langues">, plans: readonly Plan[], personnages: readonly Personnage[]): Unite[] {
  const out: Unite[] = [];
  for (const p of plans) {
    out.push({ cle: `${p.id}:clip:A`, genre: "clip", plan: p, langue: null, prise: "A" });
    if (episode.prises === 2) out.push({ cle: `${p.id}:clip:B`, genre: "clip", plan: p, langue: null, prise: "B" });
    if (planParleElevenLabs(p, personnages)) {
      for (const l of episode.langues) out.push({ cle: `${p.id}:voix:${l}`, genre: "voix", plan: p, langue: l, prise: null });
    }
  }
  return out;
}

/** Étape 4 : un rendu par langue, plus la bande annonce pour un épisode YouTube ou un film. */
export function unitesRendu(episode: Pick<Episode, "langues" | "format" | "genre">): Unite[] {
  const out: Unite[] = episode.langues.map((l) => ({ cle: `rendu:${l}`, genre: "rendu" as const, plan: null, langue: l, prise: null }));
  if (aBandeAnnonce(episode.format, episode.genre)) out.push({ cle: "bande_annonce", genre: "bande_annonce", plan: null, langue: null, prise: null });
  return out;
}

/**
 * Coût estimé d'une unité selon les tarifs saisis. Les rendus sont faits par ffmpeg : gratuits.
 * Un clip est payé sur la durée demandée à Grok (palier au-dessus de la durée du plan pour un clip musical).
 */
export function coutUnite(u: Unite, dureeClip: number, tarifs: Pick<Tarifs, "image" | "video_seconde" | "voix_1000_car">, propositions = 1): number {
  if (u.genre === "image") return tarifs.image * Math.max(1, propositions);
  if (u.genre === "clip") return dureeGenerationClip(dureeClip) * tarifs.video_seconde;
  if (u.genre === "voix") {
    // Les traductions sont souvent plus longues : on compte au moins 40 caractères par réplique.
    const car = Math.max(40, u.plan?.replique.length ?? 40);
    return (car / 1000) * tarifs.voix_1000_car;
  }
  return 0;
}

/** Coût total estimé de toutes les générations payantes d'un épisode (storyboard, clips, voix). */
export function coutEstimeEpisode(
  episode: Pick<Episode, "prises" | "langues">,
  plans: readonly Plan[],
  personnages: readonly Personnage[],
  durees: Map<string, number>,
  tarifs: Pick<Tarifs, "image" | "video_seconde" | "voix_1000_car">,
  propositions = 1,
): number {
  const unites = [...unitesStoryboard(plans), ...unitesClips(episode, plans, personnages)];
  return unites.reduce((s, u) => s + coutUnite(u, u.plan ? durees.get(u.plan.id) ?? 5 : 0, tarifs, propositions), 0);
}

/**
 * Coût estimé d'un lancement : seulement les unités demandées (images ou clips), avant de les mettre en file.
 * Sert à demander confirmation au-delà du plafond par épisode.
 */
export function coutLancement(params: {
  genre: "image" | "clip";
  episode: Pick<Episode, "prises" | "langues">;
  plans: readonly Plan[];
  personnages: readonly Personnage[];
  durees: Map<string, number>;
  tarifs: Pick<Tarifs, "image" | "video_seconde" | "voix_1000_car">;
  propositions?: number;
}): number {
  const unites = params.genre === "image" ? unitesStoryboard(params.plans) : unitesClips(params.episode, params.plans, params.personnages);
  return unites.reduce((s, u) => s + coutUnite(u, u.plan ? params.durees.get(u.plan.id) ?? 5 : 0, params.tarifs, params.propositions ?? 1), 0);
}
