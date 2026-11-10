// Début d'une connexion OAuth (YouTube, Instagram, TikTok) : vérifie la session et l'espace,
// pose un cookie « state » signé, puis redirige vers la page d'autorisation du réseau.
import { schemaReseau } from "@studio-video-ia/core";
import { urlAutorisation } from "@studio-video-ia/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { cleMaitre, lireAppOAuth } from "@/lib/cles";
import { messageErreur } from "@/lib/erreurs";
import { COOKIE_ETAT_OAUTH, creerEtat, DUREE_ETAT_MS } from "@/lib/etat-oauth";
import { adresseRetour, redirigerAvecMessage } from "@/lib/oauth";
import { id as schemaId } from "@/lib/schemas";
import { clientUtilisateur, sessionCourante } from "@/lib/bdd";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Redirection vers l'autorisation du réseau. */
export async function GET(requete: NextRequest, { params }: { params: Promise<{ reseau: string }> }) {
  const r = schemaReseau.safeParse((await params).reseau);
  if (!r.success) return NextResponse.json({ erreur: "Réseau inconnu." }, { status: 404 });
  const reseau = r.data;
  const espace = schemaId.safeParse(requete.nextUrl.searchParams.get("espace"));
  const retourReglages = "/reglages?onglet=comptes";
  if (!espace.success) return redirigerAvecMessage(requete.url, retourReglages, "Compte manquant pour la connexion.", "erreur");
  try {
    const user = await sessionCourante();
    if (!user) return NextResponse.redirect(new URL("/connexion", requete.url));
    const db = await clientUtilisateur(user.id);
    // L'espace doit appartenir à l'utilisateur (lecture limitée à ses données).
    const { data: e } = await db.from("espaces").select("id").eq("id", espace.data).maybeSingle();
    if (!e) return redirigerAvecMessage(requete.url, retourReglages, "Compte introuvable.", "erreur");
    const app = await lireAppOAuth(user.id, reseau);
    if (!app) return redirigerAvecMessage(requete.url, "/reglages?onglet=cles", "Enregistre d’abord l’identifiant et le secret de l’application dans Clés API.", "attention");
    const { state, cookie } = creerEtat(espace.data, reseau, cleMaitre());
    const reponse = NextResponse.redirect(urlAutorisation(reseau, app, adresseRetour(reseau), state));
    reponse.cookies.set(COOKIE_ETAT_OAUTH, cookie, {
      httpOnly: true,
      secure: requete.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: `/api/oauth/${reseau}`,
      maxAge: Math.round(DUREE_ETAT_MS / 1000),
    });
    return reponse;
  } catch (e) {
    return redirigerAvecMessage(requete.url, `${retourReglages}&espace=${espace.data}`, `Connexion impossible : ${messageErreur(e)}`, "erreur");
  }
}
