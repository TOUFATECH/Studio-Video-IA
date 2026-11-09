// Conversion entre le champ « datetime-local » du formulaire de publication et un instant UTC,
// toujours dans le fuseau de l'espace (et non celui du navigateur ou du serveur).
import { dateLocale, instantLocal } from "@feuilleton/core";
import { z } from "zod";

/** Format produit par <input type="datetime-local"> : « 2026-11-12T18:30 » (secondes facultatives). */
export const schemaSaisieLocale = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "Date et heure invalides.");

/** Vrai si le fuseau est reconnu par Intl. */
export function fuseauValide(fuseau: string): boolean {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: fuseau });
    return true;
  } catch {
    return false;
  }
}

/**
 * Instant UTC d'une saisie « datetime-local » interprétée dans le fuseau de l'espace.
 * Lève une erreur si la saisie est mal formée ou désigne une date impossible.
 */
export function instantDepuisSaisie(saisie: string, fuseau: string): Date {
  const propre = schemaSaisieLocale.parse(saisie);
  const [date, heureMinute] = propre.split("T") as [string, string];
  const [a, m, j] = date.split("-").map(Number) as [number, number, number];
  // Refuse le 31 février : la date doit exister telle quelle dans le calendrier.
  const verif = new Date(Date.UTC(a, m - 1, j));
  if (verif.getUTCFullYear() !== a || verif.getUTCMonth() !== m - 1 || verif.getUTCDate() !== j) throw new Error("Cette date n’existe pas.");
  const [h, mi] = heureMinute.split(":").map(Number) as [number, number];
  if (h > 23 || mi > 59) throw new Error("Heure invalide.");
  return instantLocal(date, `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`, fuseau);
}

/** Valeur par défaut d'un champ « datetime-local » pour un instant, dans le fuseau de l'espace. */
export function saisieDepuisInstant(instant: Date, fuseau: string): string {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: fuseau, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
  return `${dateLocale(instant, fuseau)}T${h}`;
}
