// Rafraîchit la session Supabase à chaque requête et renvoie l'utilisateur connecté (ou null).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { exigerEnv } from "../env";

/** Met à jour les cookies de session et indique si un utilisateur est connecté. */
export async function majSession(requete: NextRequest): Promise<{ reponse: NextResponse; connecte: boolean }> {
  let reponse = NextResponse.next({ request: requete });
  const supabase = createServerClient(exigerEnv("NEXT_PUBLIC_SUPABASE_URL"), exigerEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => requete.cookies.getAll(),
      setAll: (liste) => {
        for (const { name, value } of liste) requete.cookies.set(name, value);
        reponse = NextResponse.next({ request: requete });
        for (const { name, value, options } of liste) reponse.cookies.set(name, value, options);
      },
    },
  });
  // getUser() valide le jeton auprès de Supabase (getSession() se contenterait du cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { reponse, connecte: !!user };
}
