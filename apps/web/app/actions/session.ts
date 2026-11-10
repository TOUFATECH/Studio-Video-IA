"use server";
// Actions de connexion : compte par e-mail et mot de passe (géré par l'application), déconnexion,
// choix de l'espace affiché. Le premier compte se crée toujours ; les suivants si INSCRIPTIONS n'est pas « fermees ».
import { creerUtilisateur, ErreurSql, fermerSession, nombreUtilisateurs, ouvrirSession, verifierIdentifiants } from "@studio-video-ia/base";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { executer } from "@/lib/action";
import { base, clientUtilisateur, COOKIE_SESSION } from "@/lib/bdd";
import { COOKIE_ESPACE } from "@/lib/espace-courant";
import { cheminSur, formulaire, premiereErreur, schemaChoixEspace, schemaConnexion, schemaInscription } from "@/lib/schemas";
import { initialiserCompte, utilisateur } from "@/lib/session";

/** État renvoyé au formulaire de connexion. */
export type EtatConnexion = { erreur?: string; info?: string };

/** Pose le cookie de session (httpOnly, sécurisé en https). */
async function poserSession(id: string): Promise<void> {
  const { jeton, expire } = await ouvrirSession((await base()).moteur, id);
  const h = await headers();
  const https = (h.get("x-forwarded-proto") ?? "").includes("https") || (process.env.APP_URL ?? "").startsWith("https://");
  (await cookies()).set(COOKIE_SESSION, jeton, { path: "/", httpOnly: true, sameSite: "lax", secure: https, expires: expire });
}

/** Petite pause après un échec : ralentit les essais de mots de passe en série. */
function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Connexion par e-mail et mot de passe. */
export async function connexionMotDePasse(_etat: EtatConnexion, fd: FormData): Promise<EtatConnexion> {
  const r = schemaConnexion.safeParse(formulaire(fd));
  if (!r.success) return { erreur: premiereErreur(r.error) };
  const user = await verifierIdentifiants((await base()).moteur, r.data.email, r.data.mot_de_passe);
  if (!user) {
    await pause(600);
    return { erreur: "E-mail ou mot de passe incorrect." };
  }
  await poserSession(user.id);
  await initialiserCompte(await clientUtilisateur(user.id));
  redirect(cheminSur(r.data.suite));
}

/** Vrai si un nouveau compte peut être créé (toujours pour le premier). */
export async function inscriptionOuverte(): Promise<boolean> {
  if ((process.env.INSCRIPTIONS ?? "").trim().toLowerCase() !== "fermees") return true;
  return (await nombreUtilisateurs((await base()).moteur)) === 0;
}

/** Création d'un compte, puis connexion directe. */
export async function inscription(_etat: EtatConnexion, fd: FormData): Promise<EtatConnexion> {
  const r = schemaInscription.safeParse(formulaire(fd));
  if (!r.success) return { erreur: premiereErreur(r.error) };
  if (!(await inscriptionOuverte())) return { erreur: "Les inscriptions sont fermées sur ce studio. Demande à son administrateur de te créer un compte." };
  let id: string;
  try {
    id = (await creerUtilisateur((await base()).moteur, r.data.email, r.data.mot_de_passe)).id;
  } catch (e) {
    return { erreur: e instanceof ErreurSql ? e.message : "Création du compte impossible pour le moment." };
  }
  await poserSession(id);
  await initialiserCompte(await clientUtilisateur(id));
  redirect(cheminSur(r.data.suite));
}

/** Déconnexion puis retour à la page de connexion. */
export async function deconnexion(): Promise<void> {
  const magasin = await cookies();
  await fermerSession((await base()).moteur, magasin.get(COOKIE_SESSION)?.value);
  magasin.delete(COOKIE_SESSION);
  redirect("/connexion");
}

/** Change l'espace affiché (cookie « espace » : un id de l'utilisateur ou « tous »). */
export async function choisirEspace(fd: FormData): Promise<void> {
  await executer(async () => {
    const { db } = await utilisateur();
    const r = schemaChoixEspace.safeParse(formulaire(fd));
    if (!r.success) return { message: premiereErreur(r.error), ton: "erreur" };
    if (r.data.espace !== "tous") {
      // Vérifie que l'espace appartient bien à l'utilisateur avant de le mémoriser.
      const { data } = await db.from("espaces").select("id").eq("id", r.data.espace).maybeSingle();
      if (!data) return { message: "Compte introuvable.", ton: "erreur" };
    }
    (await cookies()).set(COOKIE_ESPACE, r.data.espace, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  });
}
