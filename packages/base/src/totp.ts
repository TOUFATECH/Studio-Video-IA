// Double authentification par code à 6 chiffres (TOTP, RFC 6238) : Google Authenticator, Microsoft Authenticator,
// 1Password… Le secret est chiffré en base avec la clé de chiffrement du studio.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Alphabet base32 (RFC 4648), celui qu'attendent les applis d'authentification. */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode des octets en base32 sans remplissage. */
export function versBase32(octets: Uint8Array): string {
  let bits = 0;
  let valeur = 0;
  let out = "";
  for (const o of octets) {
    valeur = (valeur << 8) | o;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(valeur << (5 - bits)) & 31];
  return out;
}

/** Décode du base32 (espaces et casse ignorés). */
export function depuisBase32(texte: string): Buffer {
  const propre = texte.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let valeur = 0;
  const out: number[] = [];
  for (const c of propre) {
    const i = BASE32.indexOf(c);
    if (i < 0) throw new Error("Secret TOTP invalide.");
    valeur = (valeur << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((valeur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Nouveau secret aléatoire de 20 octets, en base32. */
export function genererSecretTotp(): string {
  return versBase32(randomBytes(20));
}

/** Code à 6 chiffres pour un instant donné (pas de 30 s, HMAC-SHA1). */
export function codeTotp(secret: string, instantMs: number = Date.now()): string {
  const compteur = Math.floor(instantMs / 1000 / 30);
  const tampon = Buffer.alloc(8);
  tampon.writeBigUInt64BE(BigInt(compteur));
  const h = createHmac("sha1", depuisBase32(secret)).update(tampon).digest();
  const decalage = (h[h.length - 1] ?? 0) & 0x0f;
  const nombre = (((h[decalage] ?? 0) & 0x7f) << 24) | ((h[decalage + 1] ?? 0) << 16) | ((h[decalage + 2] ?? 0) << 8) | (h[decalage + 3] ?? 0);
  return String(nombre % 1_000_000).padStart(6, "0");
}

/** Vérifie un code en acceptant une période d'avance ou de retard (horloge du téléphone décalée). */
export function verifierTotp(secret: string, code: string, instantMs: number = Date.now()): boolean {
  const saisi = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(saisi)) return false;
  for (const ecart of [-1, 0, 1]) {
    const attendu = Buffer.from(codeTotp(secret, instantMs + ecart * 30_000));
    if (timingSafeEqual(attendu, Buffer.from(saisi))) return true;
  }
  return false;
}

/** Adresse otpauth:// à scanner ou à ouvrir dans l'appli d'authentification. */
export function adresseTotp(secret: string, compte: string, emetteur = "Studio Vidéo IA"): string {
  return `otpauth://totp/${encodeURIComponent(`${emetteur}:${compte}`)}?secret=${secret}&issuer=${encodeURIComponent(emetteur)}&algorithm=SHA1&digits=6&period=30`;
}
