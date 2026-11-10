// Garde d'accès : toute page demande une session, sauf la connexion et les médias signés.
// Le middleware ne lit que la présence du cookie (pas de base ici) ; chaque page vérifie ensuite la session en base.
import { NextResponse, type NextRequest } from "next/server";

/** Chemins accessibles sans être connecté. */
const PUBLICS = ["/connexion", "/api/medias/"];
/** Cookie de session (voir lib/bdd). */
const COOKIE_SESSION = "svi_session";

/** Redirige vers /connexion si personne n'est connecté. */
export function middleware(requete: NextRequest) {
  const chemin = requete.nextUrl.pathname;
  if (requete.cookies.get(COOKIE_SESSION)?.value || PUBLICS.some((p) => chemin.startsWith(p))) return NextResponse.next();
  // Les routes d'API appelées en arrière-plan répondent 401 ; les connexions OAuth sont des navigations : on redirige.
  if (chemin.startsWith("/api/") && !chemin.startsWith("/api/oauth/")) return NextResponse.json({ erreur: "Non connecté." }, { status: 401 });
  const url = new URL("/connexion", requete.url);
  if (chemin !== "/") url.searchParams.set("suite", chemin);
  return NextResponse.redirect(url);
}

export const config = {
  // Tout sauf les fichiers statiques de Next et le favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
