// Répartition automatique des durées de clips pour tomber sur la durée cible d'un épisode.
import { DUREES_AUTORISEES, DUREE_GENERIQUES, TYPES_PLAN, type FormatEpisode, type TypePlan } from "./constantes";

/** Ce dont la répartition a besoin d'un plan. */
export type PlanDuree = { id: string; type: TypePlan; duree_fixee: number | null; section?: string };

/**
 * Choisit une durée autorisée (3, 5, 8, 10 ou 15 s) pour chaque plan afin d'approcher `cible`.
 * Part de la durée de base de chaque type, puis allonge ou raccourcit pas à pas le plan le plus adapté.
 * Les durées fixées à la main ne bougent jamais. Renvoie les durées dans l'ordre des plans.
 */
export function repartirDurees(plans: readonly PlanDuree[], cible: number): number[] {
  const autorisees: readonly number[] = DUREES_AUTORISEES;
  const d = plans.map((p) => p.duree_fixee ?? TYPES_PLAN[p.type].base);
  // 400 itérations suffisent largement : chaque pas rapproche strictement de la cible.
  for (let k = 0; k < 400; k++) {
    const somme = d.reduce((a, b) => a + b, 0);
    const ecart = cible - somme;
    if (ecart === 0) break;
    let meilleur = -1;
    let meilleurScore = Number.POSITIVE_INFINITY;
    let meilleureValeur = 0;
    plans.forEach((p, i) => {
      // Une accroche ne raccourcit pas : les 3 premières secondes doivent rester percutantes.
      if (p.duree_fixee !== null || (ecart < 0 && p.type === "accroche")) return;
      const actuelle = d[i] ?? 0;
      const idx = autorisees.indexOf(actuelle);
      const suivante = ecart > 0 ? autorisees[idx + 1] : autorisees[idx - 1];
      if (suivante === undefined) return;
      const distance = Math.abs(cible - (somme - actuelle + suivante));
      if (distance >= Math.abs(ecart)) return;
      const rang = TYPES_PLAN[p.type].rang;
      // À distance égale : on allonge d'abord les décors, on raccourcit d'abord les finals.
      const score = distance + (ecart > 0 ? rang : 5 - rang) * 0.01;
      if (score < meilleurScore) {
        meilleurScore = score;
        meilleur = i;
        meilleureValeur = suivante;
      }
    });
    if (meilleur < 0) break;
    d[meilleur] = meilleureValeur;
  }
  return d;
}

/** Sections d'un épisode dans leur ordre d'apparition (« principal » pour un court, « ch1 », « ch2 »… pour un film). */
export function sectionsDe(plans: readonly PlanDuree[]): string[] {
  const out: string[] = [];
  for (const p of plans) {
    const s = p.section ?? "principal";
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Durée de chaque plan (id → secondes). Pour un film, la cible moins les génériques est partagée
 * à parts égales entre les chapitres, puis répartie dans chaque chapitre.
 */
export function dureesParPlan(plans: readonly PlanDuree[], cible: number, format: FormatEpisode): Map<string, number> {
  const m = new Map<string, number>();
  if (format !== "long") {
    const d = repartirDurees(plans, cible);
    plans.forEach((p, i) => m.set(p.id, d[i] ?? 0));
    return m;
  }
  const sections = sectionsDe(plans);
  const parSection = Math.round((cible - DUREE_GENERIQUES) / Math.max(1, sections.length));
  for (const s of sections) {
    const liste = plans.filter((p) => (p.section ?? "principal") === s);
    const d = repartirDurees(liste, parSection);
    liste.forEach((p, i) => m.set(p.id, d[i] ?? 0));
  }
  return m;
}

/** Durée totale de l'épisode, génériques compris pour un film. */
export function dureeTotale(plans: readonly PlanDuree[], cible: number, format: FormatEpisode, avecGeneriques: boolean): number {
  const m = dureesParPlan(plans, cible, format);
  let total = 0;
  for (const v of m.values()) total += v;
  return total + (format === "long" && avecGeneriques ? DUREE_GENERIQUES : 0);
}

/** Nombre de plans à demander à l'IA pour une durée cible (environ 7 s par plan). */
export function nombrePlansCible(format: FormatEpisode, cible: number): number {
  if (format === "long") return Math.max(12, Math.round((cible - DUREE_GENERIQUES) / 7));
  return Math.min(16, Math.max(4, Math.round(cible / 7)));
}

/** Nombre de chapitres d'un film : un toutes les 2 minutes environ. */
export function nombreChapitres(cible: number): number {
  return Math.max(2, Math.round((cible - DUREE_GENERIQUES) / 120));
}

/** Formate des secondes en « m:ss ». */
export function formaterDuree(secondes: number): string {
  const t = Math.round(secondes);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
