// Retour d'une connexion OAuth : vérifie le « state », échange le code contre des jetons,
// les chiffre et enregistre le compte connecté (client serveur), puis revient aux réglages.
import { schemaReseau, type Langue } from "@studio-video-ia/core";
import { chiffrer } from "@studio-video-ia/core/chiffrement";
import { echangerCode } from "@studio-video-ia/integrations";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cleMaitre, lireAppOAuth } from "@/lib/cles";
import { messageErreur } from "@/lib/erreurs";
import { COOKIE_ETAT_OAUTH, verifierEtat } from "@/lib/etat-oauth";
import { ligneSerie, lignes } from "@/lib/lignes";
import { adresseRetour, redirigerAvecMessage } from "@/lib/oauth";
import { clientAdmin } from "@/lib/bdd";
import { clientUtilisateur, sessionCourante } from "@/lib/bdd";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Traite le retour du réseau. */
export async function GET(requete: NextRequest, { params }: { params: Promise<{ reseau: string }> }) {
  const r = schemaReseau.safeParse((await params).reseau);
  if (!r.success) return NextResponse.json({ erreur: "Réseau inconnu." }, { status: 404 });
  const reseau = r.data;
  const q = requete.nextUrl.searchParams;
  let chemin = "/reglages?onglet=comptes";
  /** Réponse finale : message, et suppression du cookie d'état dans tous les cas. */
  const fin = (texte: string, ton: "succes" | "erreur") => {
    const reponse = redirigerAvecMessage(requete.url, chemin, texte, ton);
    reponse.cookies.set(COOKIE_ETAT_OAUTH, "", { path: `/api/oauth/${reseau}`, maxAge: 0 });
    return reponse;
  };
  try {
    if (q.get("error")) return fin(`Connexion refusée par ${reseau} : ${q.get("error_description") ?? q.get("error")}`, "erreur");
    const verif = verifierEtat(requete.cookies.get(COOKIE_ETAT_OAUTH)?.value, q.get("state"), reseau, cleMaitre());
    if (!verif.ok) return fin(verif.raison, "erreur");
    chemin = `/reglages?onglet=comptes&espace=${verif.espaceId}`;
    const code = z.string().min(1).max(4096).safeParse(q.get("code"));
    if (!code.success) return fin("Code d’autorisation absent.", "erreur");

    const user = await sessionCourante();
    if (!user) return NextResponse.redirect(new URL("/connexion", requete.url));
    const db = await clientUtilisateur(user.id);
    const { data: e } = await db.from("espaces").select("id").eq("id", verif.espaceId).maybeSingle();
    if (!e) return fin("Compte introuvable.", "erreur");
    const app = await lireAppOAuth(user.id, reseau);
    if (!app) return fin("Application OAuth absente : enregistre-la dans Clés API.", "erreur");

    const jetons = await echangerCode(reseau, app, adresseRetour(reseau), code.data);
    const cle = cleMaitre();
    // Langue par défaut du compte : celle de la série la plus récente de l'espace, sinon le français.
    const series = lignes(ligneSerie, (await db.from("series").select("*").eq("espace_id", verif.espaceId).order("cree_le", { ascending: false }).limit(1)).data, "series");
    const langue: Langue = series[0]?.langue ?? "fr";
    const admin = await clientAdmin();
    const commun = {
      nom_compte: jetons.nomCompte,
      jeton_acces_chiffre: chiffrer(jetons.acces, cle),
      jeton_renouvellement_chiffre: jetons.renouvellement ? chiffrer(jetons.renouvellement, cle) : null,
      jeton_expire_le: jetons.expireLe ? jetons.expireLe.toISOString() : null,
      statut: "connecte",
      infos: jetons.infos,
    };
    // Reconnexion d'un compte existant : on garde sa langue et son audit TikTok.
    const { data: existant } = await admin.from("reseaux_connectes").select("id").eq("espace_id", verif.espaceId).eq("reseau", reseau).eq("id_externe", jetons.idExterne).maybeSingle();
    const idExistant: unknown = existant?.id;
    const { error } =
      typeof idExistant === "string"
        ? await admin.from("reseaux_connectes").update(commun).eq("id", idExistant)
        : await admin.from("reseaux_connectes").insert({ ...commun, espace_id: verif.espaceId, reseau, id_externe: jetons.idExterne, langue });
    if (error) throw new Error(`Enregistrement du compte : ${error.message}`);
    return fin(`${jetons.nomCompte} connecté.`, "succes");
  } catch (err) {
    return fin(`Connexion impossible : ${messageErreur(err)}`, "erreur");
  }
}
