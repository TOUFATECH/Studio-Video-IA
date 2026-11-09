// Message éphémère affiché après une action (« Série créée », « Clé enregistrée »…).
// Écrit par les Server Actions dans un cookie de 30 s, lu par la coquille, effacé par le navigateur.
import { z } from "zod";

/** Nom du cookie du message éphémère. */
export const COOKIE_FLASH = "flash";

/** Contenu d'un message. */
export const schemaFlash = z.object({ texte: z.string().max(500), ton: z.enum(["succes", "erreur", "info", "attention"]) });
export type Flash = z.infer<typeof schemaFlash>;

/** Encode un message pour le cookie (base64url : pas d'accents ni de virgules dans la valeur). */
export function encoderFlash(f: Flash): string {
  return Buffer.from(JSON.stringify(f), "utf8").toString("base64url");
}

/** Décode la valeur du cookie ; null si elle est absente ou invalide. */
export function decoderFlash(valeur: string | undefined): Flash | null {
  if (!valeur) return null;
  try {
    const r = schemaFlash.safeParse(JSON.parse(Buffer.from(valeur, "base64url").toString("utf8")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
