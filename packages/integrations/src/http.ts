// Outils HTTP communs aux clients : lecture des réponses, conversion des erreurs en ErreurApi, masquage des secrets.
// Aucun message produit ici ne contient de clé, de jeton ni d'URL signée.
import type { z } from "zod";
import { ErreurApi, type Fetch } from "./contrat";

/** Statut utilisé quand le fournisseur répond 200 mais avec un contenu inexploitable. */
export const STATUT_REPONSE_INVALIDE = 502;
/** Statut utilisé quand la requête n'a pas pu partir (réseau, DNS, délai). */
export const STATUT_RESEAU = 0;

/** Longueur maximale d'un message d'erreur de fournisseur conservé. */
const LONGUEUR_MAX_MESSAGE = 400;

/**
 * Masque tout ce qui ressemble à un secret dans un texte : clés OpenAI / xAI, jetons Google, Meta, TikTok,
 * en-têtes Bearer, paramètres access_token d'URL, et les secrets explicitement fournis.
 */
export function masquerSecrets(texte: string, secrets: readonly (string | null | undefined)[] = []): string {
  let t = texte;
  for (const s of secrets) {
    // On ne masque que des valeurs assez longues pour ne pas abîmer le message avec des mots courants.
    if (s && s.length >= 6) t = t.split(s).join("••••");
  }
  return t
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ••••")
    .replace(/(access_token|refresh_token|client_secret|code|key)=([^&\s"']+)/gi, "$1=••••")
    .replace(/\b(sk|xai|sk-proj|sk_)[-_][A-Za-z0-9_*-]{6,}/g, "••••")
    .replace(/\b(ya29\.|1\/\/|EAA|IGQ|IGA|act\.|rft\.)[A-Za-z0-9._-]{8,}/g, "••••")
    // Toute suite de 40 caractères ou plus sans espace ressemble davantage à un jeton qu'à du texte.
    .replace(/[A-Za-z0-9._~+/=-]{40,}/g, "••••");
}

/** Lit un champ texte d'un objet inconnu. */
function champTexte(o: unknown, cle: string): string | undefined {
  if (o && typeof o === "object" && cle in o) {
    const v = (o as Record<string, unknown>)[cle];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

/** Lit un sous-objet d'un objet inconnu. */
function champObjet(o: unknown, cle: string): unknown {
  if (o && typeof o === "object" && cle in o) return (o as Record<string, unknown>)[cle];
  return undefined;
}

/**
 * Extrait un message et un code lisibles d'un corps d'erreur, quel que soit le fournisseur :
 * OpenAI / Google / Instagram `{error: {message, code}}`, OAuth `{error, error_description}`,
 * ElevenLabs `{detail: {status, message}}`, TikTok `{error: {code, message}}`, xAI `{error: "…", code}`.
 */
export function extraireErreur(corps: unknown, brut: string): { message: string; code?: string } {
  const erreur = champObjet(corps, "error");
  const detail = champObjet(corps, "detail");
  if (erreur && typeof erreur === "object") {
    const message = champTexte(erreur, "message") ?? champTexte(erreur, "error_user_msg") ?? champTexte(corps, "error_description");
    const code = champTexte(erreur, "code") ?? champTexte(erreur, "status") ?? champTexte(erreur, "type");
    if (message) return { message, code };
  }
  if (typeof erreur === "string") {
    return { message: champTexte(corps, "error_description") ?? erreur, code: champTexte(corps, "code") ?? erreur };
  }
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const message = champTexte(detail, "message");
    if (message) return { message, code: champTexte(detail, "status") ?? champTexte(detail, "code") };
  }
  if (Array.isArray(detail)) {
    const premier: unknown = detail[0];
    const message = champTexte(premier, "msg") ?? champTexte(premier, "message");
    if (message) return { message, code: "validation" };
  }
  if (typeof detail === "string") return { message: detail };
  const message = champTexte(corps, "error_message") ?? champTexte(corps, "message");
  if (message) return { message, code: champTexte(corps, "error_type") ?? champTexte(corps, "code") };
  return { message: brut.trim() ? brut.trim() : "réponse vide" };
}

/** Transforme une réponse HTTP en échec en ErreurApi (message du fournisseur, sans secret). */
export async function erreurDepuisReponse(fournisseur: string, rep: Response, secrets: readonly (string | null | undefined)[] = []): Promise<ErreurApi> {
  let brut = "";
  try {
    brut = await rep.text();
  } catch {
    brut = "";
  }
  let corps: unknown = null;
  try {
    corps = brut ? (JSON.parse(brut) as unknown) : null;
  } catch {
    corps = null;
  }
  const { message, code } = extraireErreur(corps, brut.slice(0, LONGUEUR_MAX_MESSAGE));
  return new ErreurApi(fournisseur, rep.status, masquerSecrets(message, secrets).slice(0, LONGUEUR_MAX_MESSAGE), code);
}

/** Erreur « réponse inattendue » : le JSON reçu ne correspond pas au schéma attendu. */
export function erreurReponseInvalide(fournisseur: string, detail: string): ErreurApi {
  return new ErreurApi(fournisseur, STATUT_REPONSE_INVALIDE, `réponse inattendue (${detail.slice(0, 200)})`, "reponse_invalide");
}

/** Lance une requête et convertit une panne réseau en ErreurApi lisible (sans l'URL, qui peut contenir un jeton). */
export async function requete(f: Fetch, fournisseur: string, url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await f(url, init);
  } catch (e) {
    if (e instanceof ErreurApi) throw e;
    if (e instanceof Error && e.name === "AbortError") throw e;
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : e instanceof Error ? e.message : String(e);
    throw new ErreurApi(fournisseur, STATUT_RESEAU, `connexion impossible (${masquerSecrets(cause).slice(0, 120)})`, "reseau");
  }
}

/**
 * Appel JSON complet : requête, contrôle du statut HTTP, lecture et validation Zod du corps.
 * Toute réponse non 2xx devient une ErreurApi ; un corps invalide devient une ErreurApi « reponse_invalide ».
 */
export async function appelJson<S extends z.ZodTypeAny>(
  f: Fetch,
  fournisseur: string,
  url: string,
  init: RequestInit,
  schema: S,
  secrets: readonly (string | null | undefined)[] = [],
): Promise<z.output<S>> {
  const rep = await requete(f, fournisseur, url, init);
  if (!rep.ok) throw await erreurDepuisReponse(fournisseur, rep, secrets);
  return lireJson(fournisseur, rep, schema);
}

/** Lit et valide le corps JSON d'une réponse déjà contrôlée. */
export async function lireJson<S extends z.ZodTypeAny>(fournisseur: string, rep: Response, schema: S): Promise<z.output<S>> {
  let corps: unknown;
  try {
    corps = (await rep.json()) as unknown;
  } catch {
    throw erreurReponseInvalide(fournisseur, "JSON illisible");
  }
  const r = schema.safeParse(corps);
  if (!r.success) throw erreurReponseInvalide(fournisseur, r.error.issues.map((i) => `${i.path.join(".") || "racine"} : ${i.message}`).join(" ; "));
  return r.data as z.output<S>;
}

/** Lit un corps binaire (audio, vidéo) en refusant une réponse JSON d'erreur déguisée en succès. */
export async function lireOctets(fournisseur: string, rep: Response, secrets: readonly (string | null | undefined)[] = []): Promise<Buffer> {
  if (!rep.ok) throw await erreurDepuisReponse(fournisseur, rep, secrets);
  const type = rep.headers.get("content-type") ?? "";
  if (type.includes("application/json")) throw erreurReponseInvalide(fournisseur, "JSON reçu au lieu d'un fichier");
  const octets = Buffer.from(await rep.arrayBuffer());
  if (octets.length === 0) throw erreurReponseInvalide(fournisseur, "fichier vide");
  return octets;
}

/** Attente interruptible (utilisée pour le suivi des générations et des envois). */
export type Attendre = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Attente réelle, interrompue proprement si le signal est déclenché. */
export const attendre: Attendre = (ms, signal) =>
  new Promise<void>((resoudre, rejeter) => {
    if (signal?.aborted) {
      rejeter(signal.reason instanceof Error ? signal.reason : new Error("Interrompu"));
      return;
    }
    const minuteur = setTimeout(() => {
      signal?.removeEventListener("abort", surAbandon);
      resoudre();
    }, ms);
    function surAbandon(): void {
      clearTimeout(minuteur);
      rejeter(signal?.reason instanceof Error ? signal.reason : new Error("Interrompu"));
    }
    signal?.addEventListener("abort", surAbandon, { once: true });
  });

/** Copie un Buffer dans un Uint8Array autonome (accepté partout comme corps de requête ou partie de Blob). */
export function versOctets(b: Uint8Array): Uint8Array<ArrayBuffer> {
  const copie = new Uint8Array(new ArrayBuffer(b.byteLength));
  copie.set(b);
  return copie;
}

/** Source de données à envoyer par morceaux : un fichier sur disque ou un Buffer en mémoire. */
export type SourceEnvoi = {
  /** Taille totale en octets. */
  taille: number;
  /** Lit les octets [debut, fin] inclus. */
  lire: (debut: number, fin: number) => Promise<Uint8Array<ArrayBuffer>>;
};

/** Source d'envoi à partir d'un Buffer déjà en mémoire. */
export function sourceBuffer(b: Uint8Array): SourceEnvoi {
  return { taille: b.byteLength, lire: async (debut, fin) => versOctets(b.subarray(debut, fin + 1)) };
}

/** Source d'envoi qui lit un fichier par morceaux, sans le charger entièrement en mémoire. */
export async function sourceFichier(chemin: string): Promise<SourceEnvoi> {
  const { open, stat } = await import("node:fs/promises");
  const { size } = await stat(chemin);
  return {
    taille: size,
    lire: async (debut, fin) => {
      const fd = await open(chemin, "r");
      try {
        const morceau = new Uint8Array(new ArrayBuffer(fin - debut + 1));
        const { bytesRead } = await fd.read(morceau, 0, morceau.length, debut);
        return bytesRead === morceau.length ? morceau : morceau.slice(0, bytesRead);
      } finally {
        await fd.close();
      }
    },
  };
}
