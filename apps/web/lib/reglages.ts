// Lecture des réglages de l'utilisateur (tarifs, préférences), avec valeurs par défaut si la ligne manque.
import "server-only";
import { ligne, ligneReglages } from "./lignes";
import { utilisateur } from "./session";

/** Réglages de l'utilisateur connecté. */
export async function chargerReglages() {
  const { supabase, user } = await utilisateur();
  const { data } = await supabase.from("reglages").select("proprietaire, tarifs, preferences").eq("proprietaire", user.id).maybeSingle();
  return ligne(ligneReglages, data) ?? ligneReglages.parse({ proprietaire: user.id, tarifs: null, preferences: null });
}
