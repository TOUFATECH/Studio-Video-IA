"use server";
// Actions de connexion : mot de passe, lien magique, déconnexion, choix de l'espace affiché.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_ESPACE } from "@/lib/espace-courant";
import { lireEnv } from "@/lib/env";
import { executer } from "@/lib/action";
import { cheminSur, formulaire, premiereErreur, schemaChoixEspace, schemaConnexion, schemaLienMagique } from "@/lib/schemas";
import { initialiserCompte, utilisateur } from "@/lib/session";
import { clientServeur } from "@/lib/supabase/serveur";

/** État renvoyé au formulaire de connexion. */
export type EtatConnexion = { erreur?: string; info?: string };

/** Connexion par e-mail et mot de passe. */
export async function connexionMotDePasse(_etat: EtatConnexion, fd: FormData): Promise<EtatConnexion> {
  const r = schemaConnexion.safeParse(formulaire(fd));
  if (!r.success) return { erreur: premiereErreur(r.error) };
  const supabase = await clientServeur();
  const { data, error } = await supabase.auth.signInWithPassword({ email: r.data.email, password: r.data.mot_de_passe });
  if (error || !data.user) return { erreur: "E-mail ou mot de passe incorrect." };
  await initialiserCompte(supabase, data.user.id);
  redirect(cheminSur(r.data.suite));
}

/** Adresse de l'app pour le retour du lien magique : APP_URL, sinon l'hôte de la requête. */
async function origine(): Promise<string> {
  const app = lireEnv("APP_URL");
  if (app) return app.replace(/\/+$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
}

/** Envoi d'un lien de connexion par e-mail. */
export async function lienMagique(_etat: EtatConnexion, fd: FormData): Promise<EtatConnexion> {
  const r = schemaLienMagique.safeParse(formulaire(fd));
  if (!r.success) return { erreur: premiereErreur(r.error) };
  const supabase = await clientServeur();
  const suite = encodeURIComponent(cheminSur(r.data.suite));
  const { error } = await supabase.auth.signInWithOtp({ email: r.data.email, options: { emailRedirectTo: `${await origine()}/auth/callback?suite=${suite}` } });
  if (error) return { erreur: "Envoi impossible pour le moment. Réessaie dans une minute." };
  return { info: "Lien envoyé. Ouvre l’e-mail sur cet appareil pour te connecter." };
}

/** Déconnexion puis retour à la page de connexion. */
export async function deconnexion(): Promise<void> {
  const supabase = await clientServeur();
  await supabase.auth.signOut();
  redirect("/connexion");
}

/** Change l'espace affiché (cookie « espace » : un id de l'utilisateur ou « tous »). */
export async function choisirEspace(fd: FormData): Promise<void> {
  await executer(async () => {
    const { supabase } = await utilisateur();
    const r = schemaChoixEspace.safeParse(formulaire(fd));
    if (!r.success) return { message: premiereErreur(r.error), ton: "erreur" };
    if (r.data.espace !== "tous") {
      // Vérifie que l'espace appartient bien à l'utilisateur avant de le mémoriser.
      const { data } = await supabase.from("espaces").select("id").eq("id", r.data.espace).maybeSingle();
      if (!data) return { message: "Compte introuvable.", ton: "erreur" };
    }
    (await cookies()).set(COOKIE_ESPACE, r.data.espace, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  });
}
