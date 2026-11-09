// Détection du type RÉEL d'un fichier importé par sa signature binaire (« nombres magiques »),
// sans croire l'extension ni le type MIME envoyés par le navigateur.

/** Types reconnus. Le SVG est détecté pour être refusé explicitement (il peut contenir du script). */
export type TypeDetecte = "png" | "jpeg" | "webp" | "mp3" | "wav" | "m4a" | "svg";

/** Genres d'import acceptés par /api/import. */
export type GenreImport = "echantillon_voix" | "musique" | "fiche";

/** Types et taille maximale autorisés par genre d'import. */
export const REGLES_IMPORT: Record<GenreImport, { types: readonly TypeDetecte[]; maxOctets: number; libelle: string }> = {
  echantillon_voix: { types: ["mp3", "wav", "m4a"], maxOctets: 20 * 1024 * 1024, libelle: "MP3, WAV ou M4A, 20 Mo maximum" },
  musique: { types: ["mp3", "wav", "m4a"], maxOctets: 20 * 1024 * 1024, libelle: "MP3, WAV ou M4A, 20 Mo maximum" },
  fiche: { types: ["png", "jpeg", "webp"], maxOctets: 10 * 1024 * 1024, libelle: "PNG, JPG ou WebP, 10 Mo maximum" },
};

/** Extension et type MIME enregistrés pour chaque type détecté. */
export const INFOS_TYPE: Record<Exclude<TypeDetecte, "svg">, { extension: string; mime: string }> = {
  png: { extension: "png", mime: "image/png" },
  jpeg: { extension: "jpg", mime: "image/jpeg" },
  webp: { extension: "webp", mime: "image/webp" },
  mp3: { extension: "mp3", mime: "audio/mpeg" },
  wav: { extension: "wav", mime: "audio/wav" },
  m4a: { extension: "m4a", mime: "audio/mp4" },
};

/** Compare des octets à une suite ASCII à partir d'une position. */
function ascii(octets: Uint8Array, debut: number, texte: string): boolean {
  if (octets.length < debut + texte.length) return false;
  for (let i = 0; i < texte.length; i++) if (octets[debut + i] !== texte.charCodeAt(i)) return false;
  return true;
}

/** Marques « ftyp » d'un conteneur MP4 audio acceptées comme M4A. */
const MARQUES_M4A = ["M4A ", "M4B ", "mp42", "isom", "iso2", "mp41"];

/** Type réel des premiers octets d'un fichier, ou null s'il n'est pas reconnu. */
export function detecterType(octets: Uint8Array): TypeDetecte | null {
  if (octets.length >= 8 && octets[0] === 0x89 && ascii(octets, 1, "PNG") && octets[4] === 0x0d && octets[5] === 0x0a && octets[6] === 0x1a && octets[7] === 0x0a) return "png";
  if (octets.length >= 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return "jpeg";
  if (ascii(octets, 0, "RIFF") && ascii(octets, 8, "WEBP")) return "webp";
  if (ascii(octets, 0, "RIFF") && ascii(octets, 8, "WAVE")) return "wav";
  if (ascii(octets, 0, "ID3")) return "mp3";
  // Trame MPEG sans étiquette ID3 : 11 bits de synchronisation à 1, couche III (bits 0b01).
  if (octets.length >= 2 && octets[0] === 0xff && ((octets[1] ?? 0) & 0xe0) === 0xe0 && ((octets[1] ?? 0) & 0x06) === 0x02) return "mp3";
  if (ascii(octets, 4, "ftyp") && MARQUES_M4A.some((m) => ascii(octets, 8, m))) return "m4a";
  // SVG : texte XML commençant (après BOM et espaces) par « <?xml » ou « <svg ».
  const debut = new TextDecoder("utf-8", { fatal: false }).decode(octets.slice(0, 512)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (debut.startsWith("<svg") || (debut.startsWith("<?xml") && debut.includes("<svg"))) return "svg";
  return null;
}

/** Résultat de la vérification d'un import. */
export type VerificationImport =
  | { ok: true; type: Exclude<TypeDetecte, "svg">; extension: string; mime: string }
  | { ok: false; erreur: string };

/** Vérifie la taille et le type réel d'un fichier pour un genre d'import. */
export function verifierImport(genre: GenreImport, octets: Uint8Array, taille: number): VerificationImport {
  const regle = REGLES_IMPORT[genre];
  if (taille <= 0) return { ok: false, erreur: "Le fichier est vide." };
  if (taille > regle.maxOctets) return { ok: false, erreur: `Fichier trop lourd : ${regle.libelle}.` };
  const type = detecterType(octets);
  if (type === "svg") return { ok: false, erreur: "Les images SVG sont refusées." };
  if (!type || !regle.types.includes(type)) return { ok: false, erreur: `Format non accepté : ${regle.libelle}.` };
  return { ok: true, type, ...INFOS_TYPE[type] };
}
