// Double authentification : connexion en deux temps. Après le mot de passe, un cookie signé de 5 minutes
// retient l'utilisateur ; la session n'est ouverte qu'après le code à 6 chiffres.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cleMaitre } from "./cles";

/** Cookie de l'étape « code » et sa durée. */
export const COOKIE_DEUX_FACTEURS = "svi_2fa";
export const DUREE_DEUX_FACTEURS_S = 300;

/** Signature HMAC-SHA256 (clé dérivée de la clé de chiffrement, usage séparé). */
function signer(texte: string): string {
  const cle = createHmac("sha256", cleMaitre()).update("deux-facteurs").digest();
  return createHmac("sha256", cle).update(texte).digest("base64url");
}

/** Jeton « utilisateur.expiration.signature » de l'étape code. */
export function jetonDeuxFacteurs(utilisateurId: string, maintenant = Date.now()): string {
  const corps = `${utilisateurId}.${Math.floor(maintenant / 1000) + DUREE_DEUX_FACTEURS_S}`;
  return `${corps}.${signer(corps)}`;
}

/** Utilisateur du jeton s'il est intact et pas expiré, sinon null. */
export function lireJetonDeuxFacteurs(jeton: string | undefined, maintenant = Date.now()): string | null {
  if (!jeton) return null;
  const morceaux = jeton.split(".");
  if (morceaux.length !== 3) return null;
  const [id, exp, sig] = morceaux as [string, string, string];
  const attendu = Buffer.from(signer(`${id}.${exp}`));
  const recu = Buffer.from(sig);
  if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) return null;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < maintenant) return null;
  return id;
}
