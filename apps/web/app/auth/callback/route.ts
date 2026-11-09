// Retour du lien magique Supabase : échange le code contre une session, prépare le compte, redirige.
import { NextResponse, type NextRequest } from "next/server";
import { cheminSur } from "@/lib/schemas";
import { initialiserCompte } from "@/lib/session";
import { clientServeur } from "@/lib/supabase/serveur";

export const runtime = "nodejs";

/** Échange `code` (PKCE) ou `token_hash` contre une session. */
export async function GET(requete: NextRequest) {
  const url = requete.nextUrl;
  const suite = cheminSur(url.searchParams.get("suite"));
  const supabase = await clientServeur();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && (type === "magiclink" || type === "email" || type === "signup")) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  if (!ok) return NextResponse.redirect(new URL("/connexion?erreur=lien", requete.url));
  const { data } = await supabase.auth.getUser();
  if (data.user) await initialiserCompte(supabase, data.user.id);
  return NextResponse.redirect(new URL(suite, requete.url));
}
