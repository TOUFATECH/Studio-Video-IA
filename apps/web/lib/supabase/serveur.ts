// Client Supabase lié à la session de l'utilisateur (cookies), pour les composants serveur et les Server Actions.
// Toutes les lectures passent par lui : la RLS limite les lignes à celles de l'utilisateur.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { exigerEnv } from "../env";

/** Crée le client Supabase de la requête en cours. */
export async function clientServeur() {
  const magasin = await cookies();
  return createServerClient(exigerEnv("NEXT_PUBLIC_SUPABASE_URL"), exigerEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => magasin.getAll(),
      setAll: (liste) => {
        try {
          for (const { name, value, options } of liste) magasin.set(name, value, options);
        } catch {
          // Appel depuis un composant serveur : impossible d'écrire un cookie ici, le middleware rafraîchit la session.
        }
      },
    },
  });
}

/** Type du client utilisateur. */
export type ClientSupabase = Awaited<ReturnType<typeof clientServeur>>;
