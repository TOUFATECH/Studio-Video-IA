// Accès à la base côté serveur : base partagée (SQLite local ou PostgreSQL externe), client du serveur,
// client de l'utilisateur connecté (lié à son cookie de session), et dépôt des médias.
import "server-only";
import { baseGlobale, utilisateurDeSession, type Base, type Client, type Utilisateur } from "@studio-video-ia/base";
import { cookies } from "next/headers";

/** Nom du cookie de session (jeton aléatoire ; seule son empreinte est en base). */
export const COOKIE_SESSION = "svi_session";

/** Base ouverte (schéma créé ou mis à jour au premier appel). */
export function base(): Promise<Base> {
  return baseGlobale();
}

/** Client du serveur : accès complet. À n'utiliser qu'APRÈS avoir vérifié l'appartenance (lib/appartenance.ts). */
export async function clientAdmin(): Promise<Client> {
  return (await base()).admin;
}

/** Type d'un client (serveur ou utilisateur). */
export type ClientBase = Client;

/** Utilisateur du cookie de session, ou null. */
export async function sessionCourante(): Promise<Utilisateur | null> {
  const jeton = (await cookies()).get(COOKIE_SESSION)?.value;
  if (!jeton) return null;
  return utilisateurDeSession((await base()).moteur, jeton);
}

/** Client de l'utilisateur : chaque requête est limitée à ses données. */
export async function clientUtilisateur(id: string): Promise<Client> {
  return (await base()).pour(id);
}
