// Journal du worker : lignes horodatées sur la sortie standard, secrets masqués.
import { masquerSecrets } from "@feuilleton/integrations";

/** Niveau d'un message. */
export type Niveau = "info" | "attention" | "erreur";

/** Écrit une ligne de journal. Les URL signées et jetons éventuels sont masqués avant l'écriture. */
export function journal(niveau: Niveau, message: string, contexte?: string): void {
  const heure = new Date().toISOString();
  const prefixe = niveau === "erreur" ? "ERREUR" : niveau === "attention" ? "ATTENTION" : "info";
  const ligne = `${heure} [${prefixe}]${contexte ? ` [${contexte}]` : ""} ${masquerSecrets(message).replace(/\?token=[^\s"']+/g, "?token=••••")}`;
  if (niveau === "erreur") console.error(ligne);
  else console.log(ligne);
}

/** Message lisible d'une erreur quelconque. */
export function messageErreur(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
