// Paramètre « state » des connexions OAuth : valeur aléatoire gardée dans un cookie httpOnly
// signé par HMAC (clé dérivée d'ENCRYPTION_KEY), avec l'espace visé et une durée de vie courte.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { schemaReseau, type Reseau } from "@studio-video-ia/core";
import { z } from "zod";

/** Nom du cookie qui porte l'état signé. */
export const COOKIE_ETAT_OAUTH = "studio_video_ia_oauth";
/** Durée de validité d'une tentative de connexion. */
export const DUREE_ETAT_MS = 10 * 60_000;

/** Contenu signé du cookie. */
const schemaContenu = z.object({
  s: z.string().min(16),
  e: z.string().uuid(),
  r: schemaReseau,
  t: z.number().int(),
});

/** Clé HMAC dérivée de la clé maître : on n'utilise jamais la même clé pour chiffrer et pour signer. */
function cleSignature(cleMaitre: Buffer): Buffer {
  return createHmac("sha256", cleMaitre).update("studio-video-ia:oauth-state:v1").digest();
}

/** Signature base64url d'un texte. */
function signer(texte: string, cleMaitre: Buffer): string {
  return createHmac("sha256", cleSignature(cleMaitre)).update(texte).digest("base64url");
}

/** Crée un nouvel état : la valeur à envoyer au réseau et celle du cookie. */
export function creerEtat(espaceId: string, reseau: Reseau, cleMaitre: Buffer, maintenant: number = Date.now()): { state: string; cookie: string } {
  const state = randomBytes(24).toString("base64url");
  const contenu = Buffer.from(JSON.stringify({ s: state, e: espaceId, r: reseau, t: maintenant }), "utf8").toString("base64url");
  return { state, cookie: `${contenu}.${signer(contenu, cleMaitre)}` };
}

/** Résultat de la vérification au retour du réseau. */
export type VerificationEtat = { ok: true; espaceId: string } | { ok: false; raison: string };

/** Égalité en temps constant de deux textes. */
function egaux(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Vérifie la signature du cookie, l'égalité du state, le réseau et l'âge de la tentative. */
export function verifierEtat(
  cookie: string | undefined,
  stateRecu: string | null,
  reseau: Reseau,
  cleMaitre: Buffer,
  maintenant: number = Date.now(),
): VerificationEtat {
  if (!cookie || !stateRecu) return { ok: false, raison: "Tentative de connexion introuvable : recommence depuis Réglages." };
  const [contenu, signature, ...reste] = cookie.split(".");
  if (!contenu || !signature || reste.length) return { ok: false, raison: "Cookie de connexion invalide." };
  if (!egaux(signature, signer(contenu, cleMaitre))) return { ok: false, raison: "Signature du cookie de connexion invalide." };
  let brut: unknown;
  try {
    brut = JSON.parse(Buffer.from(contenu, "base64url").toString("utf8"));
  } catch {
    return { ok: false, raison: "Cookie de connexion illisible." };
  }
  const r = schemaContenu.safeParse(brut);
  if (!r.success) return { ok: false, raison: "Cookie de connexion incomplet." };
  if (!egaux(r.data.s, stateRecu)) return { ok: false, raison: "Le paramètre state ne correspond pas." };
  if (r.data.r !== reseau) return { ok: false, raison: "Le réseau ne correspond pas à la tentative en cours." };
  if (maintenant - r.data.t > DUREE_ETAT_MS || r.data.t > maintenant + 60_000) return { ok: false, raison: "Tentative expirée : recommence la connexion." };
  return { ok: true, espaceId: r.data.e };
}
