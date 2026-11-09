"use server";
// Actions des réglages : espaces, réseaux connectés, clés API chiffrées, tarifs, plafonds et préférences.
import { schemaAppOAuth, type Fournisseur } from "@feuilleton/core";
import { apercu, chiffrer, dechiffrer } from "@feuilleton/core/chiffrement";
import { testerElevenLabs, testerOpenAI, testerXai } from "@feuilleton/integrations";
import { cookies } from "next/headers";
import { z } from "zod";
import { executer } from "@/lib/action";
import { espaceAMoi, reseauAMoi } from "@/lib/appartenance";
import { cleMaitre } from "@/lib/cles";
import { COOKIE_ESPACE } from "@/lib/espace-courant";
import { ErreurUtilisateur, messageErreur } from "@/lib/erreurs";
import {
  formulaire,
  premiereErreur,
  schemaAudit,
  schemaCle,
  schemaFournisseur,
  schemaIdSeul,
  schemaModifEspace,
  schemaModifReseau,
  schemaNouvelEspace,
  schemaPlafond,
  schemaPreferencesFormulaire,
  schemaTarifsFormulaire,
} from "@/lib/schemas";
import { utilisateur } from "@/lib/session";
import { clientAdmin } from "@/lib/supabase/admin";

/** Valide un formulaire ou lève une erreur affichable. */
function valider<S extends z.ZodTypeAny>(schema: S, fd: FormData): z.infer<S> {
  const r = schema.safeParse(formulaire(fd));
  if (!r.success) throw new ErreurUtilisateur(premiereErreur(r.error));
  return r.data;
}

/** Lève une erreur si une écriture Supabase a échoué. */
function verifier(erreur: { message: string } | null, quoi: string): void {
  if (erreur) throw new Error(`${quoi} : ${erreur.message}`);
}

// ---------------------------------------------------------------- Espaces

/** Crée un espace (« compte ») et l'affiche. */
export async function creerEspace(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaNouvelEspace, fd);
    const { supabase, user } = await utilisateur();
    const { data, error } = await supabase.from("espaces").insert({ nom: d.nom, proprietaire: user.id }).select("id").single();
    verifier(error, "Création du compte");
    const id = z.object({ id: z.string() }).parse(data).id;
    (await cookies()).set(COOKIE_ESPACE, id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
    return { message: `Compte « ${d.nom} » créé. Connecte ses réseaux.` };
  });
}

/** Renomme un espace et change sa couleur, son fuseau et son plafond. */
export async function modifierEspace(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaModifEspace, fd);
    await espaceAMoi(d.id);
    const { supabase } = await utilisateur();
    verifier((await supabase.from("espaces").update({ nom: d.nom, couleur: d.couleur.toUpperCase(), fuseau: d.fuseau, plafond_mensuel: d.plafond_mensuel }).eq("id", d.id)).error, "Enregistrement du compte");
    return { message: "Compte enregistré." };
  });
}

/** Plafond mensuel d'un espace. */
export async function modifierPlafond(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaPlafond, fd);
    await espaceAMoi(d.id);
    const { supabase } = await utilisateur();
    verifier((await supabase.from("espaces").update({ plafond_mensuel: d.plafond_mensuel }).eq("id", d.id)).error, "Plafond");
    return { message: "Plafond enregistré." };
  });
}

// ---------------------------------------------------------------- Réseaux connectés

/** Langue d'un compte connecté (version publiée par défaut sur ce compte). */
export async function modifierLangueReseau(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaModifReseau, fd);
    await reseauAMoi(d.id);
    const { supabase } = await utilisateur();
    verifier((await supabase.from("reseaux_connectes").update({ langue: d.langue }).eq("id", d.id)).error, "Langue du compte");
    return { message: "Langue enregistrée." };
  });
}

/** Déconnecte un compte : efface ses jetons (service_role), garde l'historique. */
export async function deconnecterReseau(fd: FormData): Promise<void> {
  await executer(async () => {
    const { id } = valider(schemaIdSeul, fd);
    const compte = await reseauAMoi(id);
    const { error } = await clientAdmin().from("reseaux_connectes").update({ statut: "deconnecte", jeton_acces_chiffre: null, jeton_renouvellement_chiffre: null, jeton_expire_le: null }).eq("id", compte.id);
    verifier(error, "Déconnexion");
    return { message: `${compte.nom_compte} déconnecté.` };
  });
}

/** Retire un compte connecté (ses publications et statistiques partent avec lui). */
export async function retirerReseau(fd: FormData): Promise<void> {
  await executer(async () => {
    const { id } = valider(schemaIdSeul, fd);
    const compte = await reseauAMoi(id);
    const { supabase } = await utilisateur();
    verifier((await supabase.from("reseaux_connectes").delete().eq("id", compte.id)).error, "Suppression");
    return { message: `${compte.nom_compte} retiré.` };
  });
}

/** Coche « Audit TikTok validé » (colonne non modifiable par le navigateur : écrite en service_role). */
export async function definirAuditTiktok(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaAudit, fd);
    const compte = await reseauAMoi(d.id);
    if (compte.reseau !== "tiktok") throw new ErreurUtilisateur("L’audit ne concerne que TikTok.");
    verifier((await clientAdmin().from("reseaux_connectes").update({ audit_tiktok_valide: d.valide }).eq("id", compte.id)).error, "Audit TikTok");
    return { message: d.valide ? "Audit TikTok noté comme validé : les vidéos partiront en public." : "Audit TikTok non validé : les vidéos restent privées." };
  });
}

// ---------------------------------------------------------------- Clés API

/** Chiffre et enregistre une clé (ou une application OAuth en JSON). La valeur n'est jamais renvoyée au navigateur. */
export async function enregistrerCle(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaCle, fd);
    const { user } = await utilisateur();
    const valeur = "valeur" in d ? d.valeur : JSON.stringify({ client_id: d.client_id, client_secret: d.client_secret });
    // L'aperçu d'une application montre la fin de l'identifiant, jamais celle du secret.
    const visible = "valeur" in d ? apercu(d.valeur) : apercu(d.client_id);
    const { error } = await clientAdmin()
      .from("cles_api")
      .upsert({ proprietaire: user.id, fournisseur: d.fournisseur, valeur_chiffree: chiffrer(valeur, cleMaitre()), apercu: visible, modifie_le: new Date().toISOString() }, { onConflict: "proprietaire,fournisseur" });
    verifier(error, "Enregistrement de la clé");
    return { message: "Clé chiffrée et enregistrée." };
  });
}

/** Résultat d'un test de clé affiché à côté du bouton. */
export type ResultatTestCle = { ok?: boolean; message?: string };

/** Teste une clé : appel réel pour OpenAI, xAI et ElevenLabs ; présence et format pour les applications OAuth. */
export async function testerCle(_etat: ResultatTestCle, fd: FormData): Promise<ResultatTestCle> {
  try {
    const r = schemaFournisseur.safeParse(formulaire(fd));
    if (!r.success) return { ok: false, message: premiereErreur(r.error) };
    const fournisseur: Fournisseur = r.data.fournisseur;
    const { user } = await utilisateur();
    const { data } = await clientAdmin().from("cles_api").select("valeur_chiffree").eq("proprietaire", user.id).eq("fournisseur", fournisseur).maybeSingle();
    const chiffre: unknown = data?.valeur_chiffree;
    if (typeof chiffre !== "string") return { ok: false, message: "Aucune clé enregistrée." };
    const valeur = dechiffrer(chiffre, cleMaitre());
    const testeur = fournisseur === "openai" ? testerOpenAI : fournisseur === "xai" ? testerXai : fournisseur === "elevenlabs" ? testerElevenLabs : null;
    if (testeur) {
      // On ne renvoie au navigateur que le verdict et le message, jamais les détails bruts du fournisseur.
      const res = await testeur(valeur);
      return { ok: res.ok, message: res.message };
    }
    const app = schemaAppOAuth.safeParse(JSON.parse(valeur));
    return app.success ? { ok: true, message: "Identifiant et secret présents. Le vrai test se fait en connectant un compte." } : { ok: false, message: "Application incomplète : enregistre l’identifiant et le secret." };
  } catch (e) {
    return { ok: false, message: messageErreur(e) };
  }
}

// ---------------------------------------------------------------- Budget et préférences

/** Tarifs servant à estimer les coûts. */
export async function enregistrerTarifs(fd: FormData): Promise<void> {
  await executer(async () => {
    const tarifs = valider(schemaTarifsFormulaire, fd);
    const { supabase, user } = await utilisateur();
    verifier((await supabase.from("reglages").upsert({ proprietaire: user.id, tarifs, modifie_le: new Date().toISOString() }, { onConflict: "proprietaire" })).error, "Tarifs");
    return { message: "Tarifs enregistrés." };
  });
}

/** Préférences générales et thème de l'interface. */
export async function enregistrerPreferences(fd: FormData): Promise<void> {
  await executer(async () => {
    const { theme, ...preferences } = valider(schemaPreferencesFormulaire, fd);
    const { supabase, user } = await utilisateur();
    verifier((await supabase.from("reglages").upsert({ proprietaire: user.id, preferences, modifie_le: new Date().toISOString() }, { onConflict: "proprietaire" })).error, "Préférences");
    (await cookies()).set("theme", theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return { message: "Préférences enregistrées." };
  });
}
