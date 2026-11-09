// Chiffrement AES-256-GCM des clés API et des jetons OAuth avant leur stockage en base.
// Côté serveur uniquement (web et worker) : la clé maître vient de la variable ENCRYPTION_KEY.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Préfixe de version du format, pour pouvoir changer d'algorithme plus tard sans casser l'existant. */
const VERSION = "v1";

/** Lit la clé maître (32 octets en base64) et vérifie sa taille. */
export function lireCleMaitre(base64: string | undefined): Buffer {
  if (!base64) throw new Error("ENCRYPTION_KEY manquante : génère-la avec « openssl rand -base64 32 ».");
  const cle = Buffer.from(base64, "base64");
  if (cle.length !== 32) throw new Error("ENCRYPTION_KEY doit faire 32 octets encodés en base64.");
  return cle;
}

/** Chiffre un texte. Résultat : « v1.<iv>.<tag>.<données> », chaque partie en base64. */
export function chiffrer(texte: string, cle: Buffer): string {
  // IV de 12 octets aléatoires : la taille recommandée pour GCM, jamais réutilisée.
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cle, iv);
  const donnees = Buffer.concat([c.update(texte, "utf8"), c.final()]);
  return [VERSION, iv.toString("base64"), c.getAuthTag().toString("base64"), donnees.toString("base64")].join(".");
}

/** Déchiffre un texte produit par `chiffrer`. Lève une erreur si la clé est mauvaise ou le contenu modifié. */
export function dechiffrer(chiffre: string, cle: Buffer): string {
  const [version, iv, tag, donnees] = chiffre.split(".");
  if (version !== VERSION || !iv || !tag || donnees === undefined) throw new Error("Format de valeur chiffrée inconnu.");
  const d = createDecipheriv("aes-256-gcm", cle, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(donnees, "base64")), d.final()]).toString("utf8");
}

/** Les 4 derniers caractères d'une clé, seuls affichés dans l'interface. */
export function apercu(valeur: string): string {
  const v = valeur.trim();
  return v.length <= 4 ? "••••" : v.slice(-4);
}
