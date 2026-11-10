// Session de l'utilisateur côté serveur, et préparation de son compte au premier passage.
import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { clientUtilisateur, sessionCourante, type ClientBase } from "./bdd";

/** Utilisateur connecté et son client de base de données ; redirige vers /connexion sinon. Mis en cache pour la requête. */
export const utilisateur = cache(async () => {
  const user = await sessionCourante();
  if (!user) redirect("/connexion");
  return { db: await clientUtilisateur(user.id), user };
});

/**
 * Premier passage : crée la ligne « reglages » (valeurs par défaut de la base)
 * et un premier espace « Mon compte » si l'utilisateur n'en a aucun.
 */
export async function initialiserCompte(db: ClientBase): Promise<void> {
  // ignoreDuplicates : une ligne déjà présente n'est jamais écrasée.
  await db.from("reglages").upsert({}, { onConflict: "proprietaire", ignoreDuplicates: true });
  const { count } = await db.from("espaces").select("id", { count: "exact", head: true });
  if (!count) await db.from("espaces").insert({ nom: "Mon compte" });
}
