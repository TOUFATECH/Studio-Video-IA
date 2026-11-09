// Outils communs aux routes OAuth : redirection vers les réglages avec un message, adresse de retour.
import "server-only";
import { NextResponse } from "next/server";
import type { Reseau } from "@feuilleton/core";
import { urlApp } from "./env";
import { COOKIE_FLASH, encoderFlash, type Flash } from "./flash";

/** Adresse de retour déclarée chez Google, Meta et TikTok. */
export function adresseRetour(reseau: Reseau): string {
  return `${urlApp()}/api/oauth/${reseau}/retour`;
}

/** Redirige vers une page de l'app en laissant un message éphémère. */
export function redirigerAvecMessage(base: string, chemin: string, texte: string, ton: Flash["ton"]): NextResponse {
  const reponse = NextResponse.redirect(new URL(chemin, base));
  reponse.cookies.set(COOKIE_FLASH, encoderFlash({ texte, ton }), { path: "/", maxAge: 30, sameSite: "lax" });
  return reponse;
}
