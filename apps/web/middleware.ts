// Garde d'accès : toute page demande une session, sauf la connexion, le retour d'authentification et le diagnostic.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfigure } from "./lib/env";
import { majSession } from "./lib/supabase/middleware";

/** Chemins accessibles sans être connecté. */
const PUBLICS = ["/connexion", "/auth/callback"];

/** Redirige vers /connexion si personne n'est connecté. */
export async function middleware(requete: NextRequest) {
  const chemin = requete.nextUrl.pathname;
  // Sans configuration Supabase, seule la page Diagnostic peut expliquer quoi faire.
  if (!supabaseConfigure()) {
    if (chemin === "/diagnostic") return NextResponse.next();
    return NextResponse.redirect(new URL("/diagnostic", requete.url));
  }
  const { reponse, connecte } = await majSession(requete);
  if (connecte || PUBLICS.some((p) => chemin.startsWith(p))) return reponse;
  // Les routes d'API appelées en arrière-plan répondent 401 ; les connexions OAuth sont des navigations : on redirige.
  if (chemin.startsWith("/api/") && !chemin.startsWith("/api/oauth/")) return NextResponse.json({ erreur: "Non connecté." }, { status: 401 });
  const url = new URL("/connexion", requete.url);
  if (chemin !== "/") url.searchParams.set("suite", chemin);
  return NextResponse.redirect(url);
}

export const config = {
  // Tout sauf les fichiers statiques de Next et les icônes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
