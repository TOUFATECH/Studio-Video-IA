// Calculs des statistiques : engagement, tri du tableau des vidéos, abonnés, revenus par mois, tracé des courbes.
// Fonctions pures, testées dans tests/statistiques.test.ts.
import type { Reseau, ReseauConnecte, Revenu, StatsCompte, VideoReseau } from "@feuilleton/core";
import { z } from "zod";

/** Compteurs d'interactions d'une vidéo ou d'une publication. */
export type Interactions = { vues?: number | null; jaime?: number | null; commentaires?: number | null; partages?: number | null };

/** Taux d'engagement : (j'aime + commentaires + partages) / vues ; 0 sans vue. */
export function engagement(i: Interactions): number {
  const vues = i.vues ?? 0;
  if (vues <= 0) return 0;
  return ((i.jaime ?? 0) + (i.commentaires ?? 0) + (i.partages ?? 0)) / vues;
}

/** Colonnes de tri du tableau des vidéos. */
export const schemaTriVideos = z.enum(["date", "vues", "jaime", "engagement", "revenu"]).catch("date");
export type TriVideos = z.infer<typeof schemaTriVideos>;
/** Sens du tri. */
export const schemaSens = z.enum(["desc", "asc"]).catch("desc");
export type Sens = z.infer<typeof schemaSens>;

/** Valeur de tri d'une vidéo pour une colonne (les valeurs absentes passent en dernier). */
function valeurTri(v: VideoReseau, tri: TriVideos): number | null {
  switch (tri) {
    case "date":
      return v.publiee_le ? Date.parse(v.publiee_le) : null;
    case "vues":
      return v.vues;
    case "jaime":
      return v.jaime;
    case "engagement":
      return engagement(v);
    case "revenu":
      return v.revenu_estime;
  }
}

/** Trie les vidéos sans modifier la liste d'origine ; à égalité, la plus récente d'abord. Les valeurs inconnues restent en bas. */
export function trierVideos(videos: readonly VideoReseau[], tri: TriVideos, sens: Sens): VideoReseau[] {
  const signe = sens === "asc" ? 1 : -1;
  return [...videos].sort((a, b) => {
    const x = valeurTri(a, tri);
    const y = valeurTri(b, tri);
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    if (x !== null && y !== null && x !== y) return (x - y) * signe;
    return (b.publiee_le ?? "").localeCompare(a.publiee_le ?? "");
  });
}

/** Dernière valeur connue d'abonnés et variation sur `jours` jours (null si l'historique ne remonte pas assez). */
export function abonnesEtVariation(historique: readonly StatsCompte[], jours = 7): { abonnes: number | null; variation: number | null } {
  const tries = historique.filter((s) => s.abonnes !== null).sort((a, b) => a.jour.localeCompare(b.jour));
  const dernier = tries.at(-1);
  if (!dernier || dernier.abonnes === null) return { abonnes: null, variation: null };
  const limite = decalerJour(dernier.jour, -jours);
  // Valeur la plus récente à J-n ou avant : c'est la base de comparaison.
  const base = [...tries].reverse().find((s) => s.jour <= limite);
  return { abonnes: dernier.abonnes, variation: base && base.abonnes !== null ? dernier.abonnes - base.abonnes : null };
}

/** Vues gagnées sur la période à partir des vues totales quotidiennes (null si inconnu). */
export function vuesSurPeriode(historique: readonly StatsCompte[], jours: number): number | null {
  const tries = historique.filter((s) => s.vues_total !== null).sort((a, b) => a.jour.localeCompare(b.jour));
  const dernier = tries.at(-1);
  if (!dernier || dernier.vues_total === null) return null;
  const limite = decalerJour(dernier.jour, -jours);
  const base = [...tries].reverse().find((s) => s.jour <= limite) ?? tries[0];
  if (!base || base.vues_total === null || base === dernier) return null;
  return Math.max(0, dernier.vues_total - base.vues_total);
}

/** Décale une date « AAAA-MM-JJ » de n jours. */
export function decalerJour(jour: string, n: number): string {
  const [a, m, j] = jour.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, (j ?? 1) + n)).toISOString().slice(0, 10);
}

/** Mois « AAAA-MM » d'une date « AAAA-MM-JJ ». */
export function moisDe(date: string): string {
  return date.slice(0, 7);
}

/** Les 12 derniers mois « AAAA-MM », du plus ancien au mois courant compris. */
export function douzeDerniersMois(moisCourant: string): string[] {
  const [a, m] = moisCourant.split("-").map(Number);
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** Montants par devise : { EUR: 12.5, USD: 3 }. */
export type ParDevise = Record<string, number>;

/** Ajoute un montant à un total par devise. */
function ajouter(total: ParDevise, devise: string, montant: number): void {
  total[devise] = Math.round(((total[devise] ?? 0) + montant) * 100) / 100;
}

/** Revenus agrégés. */
export type AgregatRevenus = {
  moisCourant: ParDevise;
  douzeMois: ParDevise;
  parReseau: Partial<Record<Reseau, { mois: ParDevise; douzeMois: ParDevise }>>;
  parCompte: Record<string, { mois: ParDevise; douzeMois: ParDevise }>;
  /** Total de chaque mois des 12 derniers, du plus ancien au plus récent. */
  parMois: { mois: string; total: ParDevise }[];
};

/**
 * Agrège les revenus par mois, par réseau et par compte, devise par devise (aucune conversion).
 * Si un mois d'un compte a une ligne « api » et une ligne « manuel », seule la ligne « api » compte.
 */
export function agregerRevenus(revenus: readonly Revenu[], comptes: readonly Pick<ReseauConnecte, "id" | "reseau">[], moisCourant: string): AgregatRevenus {
  const reseauDe = new Map(comptes.map((c) => [c.id, c.reseau]));
  const mois12 = douzeDerniersMois(moisCourant);
  const fenetre = new Set(mois12);
  const avecApi = new Set(revenus.filter((r) => r.source === "api").map((r) => `${r.reseau_connecte_id}:${moisDe(r.mois)}`));
  const out: AgregatRevenus = { moisCourant: {}, douzeMois: {}, parReseau: {}, parCompte: {}, parMois: mois12.map((m) => ({ mois: m, total: {} })) };
  for (const r of revenus) {
    const mois = moisDe(r.mois);
    const reseau = reseauDe.get(r.reseau_connecte_id);
    if (!reseau || !fenetre.has(mois)) continue;
    if (r.source === "manuel" && avecApi.has(`${r.reseau_connecte_id}:${mois}`)) continue;
    const parR = (out.parReseau[reseau] ??= { mois: {}, douzeMois: {} });
    const parC = (out.parCompte[r.reseau_connecte_id] ??= { mois: {}, douzeMois: {} });
    ajouter(out.douzeMois, r.devise, r.montant);
    ajouter(parR.douzeMois, r.devise, r.montant);
    ajouter(parC.douzeMois, r.devise, r.montant);
    const ligneMois = out.parMois.find((x) => x.mois === mois);
    if (ligneMois) ajouter(ligneMois.total, r.devise, r.montant);
    if (mois === moisCourant) {
      ajouter(out.moisCourant, r.devise, r.montant);
      ajouter(parR.mois, r.devise, r.montant);
      ajouter(parC.mois, r.devise, r.montant);
    }
  }
  return out;
}

/** Texte d'un total par devise : « 12,40 € · 3,00 USD », ou « — » s'il est vide. */
export function texteParDevise(total: ParDevise): string {
  const parts = Object.entries(total)
    .filter(([, v]) => v > 0)
    .map(([devise, v]) => {
      try {
        return v.toLocaleString("fr-FR", { style: "currency", currency: devise });
      } catch {
        return `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
      }
    });
  return parts.length ? parts.join(" · ") : "—";
}

/** Tracé SVG (attribut « d ») d'une courbe dans un cadre largeur × hauteur, avec une marge de 2 px. */
export function traceCourbe(valeurs: readonly number[], largeur: number, hauteur: number): string {
  if (valeurs.length === 0) return "";
  const min = Math.min(...valeurs);
  const max = Math.max(...valeurs);
  const ecart = max - min || 1;
  const pasX = valeurs.length > 1 ? (largeur - 4) / (valeurs.length - 1) : 0;
  return valeurs
    .map((v, i) => {
      const x = 2 + i * pasX;
      // Une courbe plate se dessine au milieu du cadre.
      const y = max === min ? hauteur / 2 : 2 + (hauteur - 4) * (1 - (v - min) / ecart);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}
