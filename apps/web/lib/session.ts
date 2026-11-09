// Session de l'utilisateur côté serveur, et préparation de son compte au premier passage.
import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { clientServeur, type ClientSupabase } from "./supabase/serveur";

/** Utilisateur connecté et son client Supabase ; redirige vers /connexion sinon. Mis en cache pour la requête. */
export const utilisateur = cache(async () => {
  const supabase = await clientServeur();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/connexion");
  return { supabase, user: data.user };
});

/**
 * Premier passage : crée la ligne « reglages » (valeurs par défaut de la base)
 * et un premier espace « Mon compte » si l'utilisateur n'en a aucun.
 */
export async function initialiserCompte(supabase: ClientSupabase, userId: string): Promise<void> {
  // ignoreDuplicates : une ligne déjà présente n'est jamais écrasée.
  await supabase.from("reglages").upsert({ proprietaire: userId }, { onConflict: "proprietaire", ignoreDuplicates: true });
  const { count } = await supabase.from("espaces").select("id", { count: "exact", head: true });
  if (!count) await supabase.from("espaces").insert({ nom: "Mon compte", proprietaire: userId });
}
