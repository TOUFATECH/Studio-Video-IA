// Calcul des dates de publication dans le fuseau horaire de l'utilisateur (sans librairie externe).
import type { Rythme } from "./types";

/** Écart (ms) entre l'heure UTC et l'heure locale du fuseau à un instant donné. */
export function decalageFuseau(instantMs: number, fuseau: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: fuseau,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const v = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const commeUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return commeUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Instant UTC correspondant à une date et une heure locales (« 2026-11-12 », « 18:30 ») dans un fuseau. */
export function instantLocal(date: string, heure: string, fuseau: string): Date {
  const [a, mo, j] = date.split("-").map(Number);
  const [h, mi] = heure.split(":").map(Number);
  const naif = Date.UTC(a ?? 1970, (mo ?? 1) - 1, j ?? 1, h ?? 0, mi ?? 0);
  // Deux passes : la seconde corrige le cas où le changement d'heure tombe entre les deux.
  let resultat = naif - decalageFuseau(naif, fuseau);
  resultat = naif - decalageFuseau(resultat, fuseau);
  return new Date(resultat);
}

/** Date locale « AAAA-MM-JJ » d'un instant dans un fuseau. */
export function dateLocale(instant: Date, fuseau: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** Ajoute des jours à une date « AAAA-MM-JJ ». */
export function ajouterJours(date: string, jours: number): string {
  const [a, m, j] = date.split("-").map(Number);
  const d = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, (j ?? 1) + jours));
  return d.toISOString().slice(0, 10);
}

/**
 * Prochain créneau du rythme d'une série.
 * Si une publication est déjà programmée dans le futur, on se place N jours après elle ;
 * sinon aujourd'hui à l'heure du rythme, ou demain si l'heure est passée.
 */
export function prochainCreneau(rythme: Pick<Rythme, "tous_les_jours" | "heure">, derniere: Date | null, maintenant: Date, fuseau: string): Date {
  if (derniere && derniere.getTime() > maintenant.getTime()) {
    return instantLocal(ajouterJours(dateLocale(derniere, fuseau), rythme.tous_les_jours), rythme.heure, fuseau);
  }
  const aujourdhui = dateLocale(maintenant, fuseau);
  const creneau = instantLocal(aujourdhui, rythme.heure, fuseau);
  if (creneau.getTime() > maintenant.getTime() + 60_000) return creneau;
  return instantLocal(ajouterJours(aujourdhui, 1), rythme.heure, fuseau);
}

/**
 * Délai minimal avant une date de publication YouTube programmée.
 * YouTube refuse un `publishAt` trop proche : en dessous de 15 minutes, on publie directement en public.
 */
export const MARGE_PROGRAMMATION_YOUTUBE_MS = 15 * 60_000;
