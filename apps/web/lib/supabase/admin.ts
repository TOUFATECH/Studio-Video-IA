// Client Supabase service_role : contourne la RLS. Serveur uniquement, et seulement APRÈS
// avoir vérifié que l'objet visé appartient à l'utilisateur (voir lib/appartenance.ts).
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { exigerEnv } from "../env";

/** Crée un client administrateur (sans session ni rafraîchissement de jeton). */
export function clientAdmin() {
  return createClient(exigerEnv("NEXT_PUBLIC_SUPABASE_URL"), exigerEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Type du client administrateur. */
export type ClientAdmin = ReturnType<typeof clientAdmin>;
