// Formatage des nombres, montants et dates pour l'interface (français, fuseau de l'espace).
import { dateLocale } from "@studio-video-ia/core";

/** Montant en euros : « 12,40 € ». */
export function euros(valeur: number): string {
  return `${valeur.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Nombre entier avec séparateur des milliers. */
export function entier(valeur: number): string {
  return Math.round(valeur).toLocaleString("fr-FR");
}

/** Nombre compact : 12 400 → « 12,4 k ». */
export function compact(valeur: number): string {
  if (valeur >= 1_000_000) return `${(valeur / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`;
  if (valeur >= 10_000) return `${(valeur / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k`;
  return entier(valeur);
}

/** Pourcentage arrondi : « 4,2 % ». */
export function pourcent(valeur: number): string {
  return `${(valeur * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

/** Durée lisible : « 45 s », « 3 min 05 », « 1 h 02 ». */
export function dureeLisible(secondes: number): string {
  const s = Math.max(0, Math.round(secondes));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** « mar. 12 nov. » dans le fuseau donné. */
export function jourCourt(instant: Date | string, fuseau: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: fuseau, weekday: "short", day: "numeric", month: "short" }).format(new Date(instant));
}

/** « 18:30 » dans le fuseau donné. */
export function heure(instant: Date | string, fuseau: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: fuseau, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
}

/** « mar. 12 nov. · 18:30 » dans le fuseau donné. */
export function jourHeure(instant: Date | string, fuseau: string): string {
  return `${jourCourt(instant, fuseau)} · ${heure(instant, fuseau)}`;
}

/** « mardi 12 novembre » dans le fuseau donné. */
export function jourLong(instant: Date | string, fuseau: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: fuseau, weekday: "long", day: "numeric", month: "long" }).format(new Date(instant));
}

/** Jour « AAAA-MM-JJ » d'un instant dans un fuseau (clé de regroupement du calendrier). */
export function cleJour(instant: Date | string, fuseau: string): string {
  return dateLocale(new Date(instant), fuseau);
}

/** Temps écoulé : « il y a 12 min ». */
export function ilYa(instant: Date | string, maintenant: Date = new Date()): string {
  const s = Math.max(0, Math.round((maintenant.getTime() - new Date(instant).getTime()) / 1000));
  if (s < 60) return "à l’instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86_400)} j`;
}
