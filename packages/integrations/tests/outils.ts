// Faux fetch pour les tests : enregistre chaque appel (URL, méthode, en-têtes, corps) et renvoie des réponses programmées.
import type { Fetch } from "../src/contrat";

/** Un appel enregistré par le faux fetch. */
export type AppelEnregistre = { url: string; methode: string; entetes: Record<string, string>; corps: unknown };

/** Fabrique une réponse JSON. */
export function json(corps: unknown, statut = 200, entetes: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json", ...entetes } });
}

/** Fabrique une réponse binaire. */
export function octets(donnees: Uint8Array, type = "audio/mpeg", statut = 200): Response {
  const copie = new Uint8Array(new ArrayBuffer(donnees.byteLength));
  copie.set(donnees);
  return new Response(copie, { status: statut, headers: { "content-type": type } });
}

/** Réponse vide avec un statut et des en-têtes (308 de YouTube, par exemple). */
export function vide(statut: number, entetes: Record<string, string> = {}): Response {
  return new Response(null, { status: statut, headers: entetes });
}

/**
 * Crée un faux fetch. `repondre` reçoit l'appel et son rang, et renvoie la réponse à donner.
 * Les en-têtes sont normalisés en minuscules pour simplifier les vérifications.
 */
export function fauxFetch(repondre: (appel: AppelEnregistre, rang: number) => Response | Promise<Response>): { f: Fetch; appels: AppelEnregistre[] } {
  const appels: AppelEnregistre[] = [];
  const f = (async (entree: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.toString() : entree.url;
    const entetes: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      entetes[k] = v;
    });
    let corps: unknown = init?.body ?? null;
    if (typeof corps === "string") {
      try {
        corps = JSON.parse(corps) as unknown;
      } catch {
        // Corps de formulaire ou texte brut : gardé tel quel.
      }
    }
    const appel = { url, methode: init?.method ?? "GET", entetes, corps };
    appels.push(appel);
    return repondre(appel, appels.length - 1);
  }) as Fetch;
  return { f, appels };
}

/** Vrai si aucun appel ne laisse fuiter le secret ailleurs que dans les en-têtes d'authentification attendus. */
export function texteAppels(appels: readonly AppelEnregistre[]): string {
  return appels.map((a) => `${a.url} ${JSON.stringify(a.corps)}`).join("\n");
}

/** Attente instantanée pour les suivis (les tests ne dorment jamais). */
export const sansAttente = async (): Promise<void> => {};

/** Attend l'échec d'une promesse et renvoie l'erreur (échoue si la promesse réussit). */
export async function echec(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Error) return e;
    throw new Error(`Rejet qui n'est pas une Error : ${String(e)}`);
  }
  throw new Error("La promesse aurait dû échouer.");
}
