"use server";
// Bibliothèque d'une série : décors, activités, marque, sons, variantes de personnages, leurs photos et vidéos de
// référence, et le choix de la fiche d'un personnage parmi les visages proposés. Appartenance vérifiée avant écriture.
import { VOIX_GROK_DEFAUT } from "@studio-video-ia/core";
import { z } from "zod";
import { executer } from "@/lib/action";
import { personnageAMoi, serieAMoi } from "@/lib/appartenance";
import { ErreurUtilisateur } from "@/lib/erreurs";
import { ligne, ligneElement, ligneFichier } from "@/lib/lignes";
import { supprimerObjets } from "@/lib/medias";
import { formulaire, premiereErreur, schemaElement, schemaFichierSeul, schemaNouvelElement, schemaPersonnageDecrit, id as schemaId } from "@/lib/schemas";
import { utilisateur } from "@/lib/session";
import { clientAdmin } from "@/lib/bdd";
import { exigerMiseEnFile } from "@/lib/taches";

/** Valide un formulaire ou lève une erreur affichable. */
function valider<S extends z.ZodTypeAny>(schema: S, fd: FormData): z.infer<S> {
  const r = schema.safeParse(formulaire(fd));
  if (!r.success) throw new ErreurUtilisateur(premiereErreur(r.error));
  return r.data;
}

/** Élément de la bibliothèque de l'utilisateur (règles d'accès). */
async function elementAMoi(id: string) {
  const { db } = await utilisateur();
  const el = ligne(ligneElement, (await db.from("elements").select("*").eq("id", id).maybeSingle()).data);
  if (!el) throw new ErreurUtilisateur("Élément introuvable.");
  return el;
}

/** Ajoute un élément (décor, activité, marque, son, variante) à la bibliothèque de la série. */
export async function ajouterElement(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaNouvelElement, fd);
    const serie = await serieAMoi(d.serie_id);
    if (d.genre === "variante") {
      if (!d.personnage_id) throw new ErreurUtilisateur("Choisis le personnage de cette variante.");
      const { serie: s } = await personnageAMoi(d.personnage_id);
      if (s.id !== serie.id) throw new ErreurUtilisateur("Ce personnage n’est pas de cette série.");
    }
    const { db } = await utilisateur();
    const { count } = await db.from("elements").select("id", { count: "exact", head: true }).eq("espace_id", serie.espace_id);
    const { error } = await db.from("elements").insert({
      espace_id: serie.espace_id,
      serie_id: serie.id,
      genre: d.genre,
      nom: d.nom,
      personnage_id: d.genre === "variante" ? d.personnage_id : null,
      position: count ?? 0,
    });
    if (error) throw new Error(`Ajout à la bibliothèque : ${error.message}`);
    return { message: `${d.nom} ajouté à la bibliothèque. Ajoute ses photos.` };
  });
}

/** Modifie un élément ; « partagé » le rend visible par toutes les séries du compte. */
export async function modifierElement(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaElement.extend({ serie_id: schemaId }), fd);
    const el = await elementAMoi(d.id);
    const serie = await serieAMoi(d.serie_id);
    if (serie.espace_id !== el.espace_id) throw new ErreurUtilisateur("Élément introuvable.");
    // Une variante reste attachée à son personnage, donc à sa série.
    const serieId = d.partage && el.genre !== "variante" ? null : (el.serie_id ?? serie.id);
    const couleurs = el.genre === "marque" ? { principale: d.principale, secondaire: d.secondaire, police: d.police || undefined } : el.couleurs;
    const { db } = await utilisateur();
    const { error } = await db
      .from("elements")
      .update({ nom: d.nom, description: d.description, moment: d.moment, consigne: d.consigne, serie_id: serieId, couleurs: JSON.parse(JSON.stringify(couleurs)) as object })
      .eq("id", el.id);
    if (error) throw new Error(`Bibliothèque : ${error.message}`);
    return { message: `${d.nom} enregistré. Les plans futurs l’utiliseront ; refais les plans déjà faits si tu veux les mettre à jour.` };
  });
}

/** Retire un élément et ses photos de la bibliothèque (les plans qui l'utilisaient le perdent). */
export async function supprimerElement(fd: FormData): Promise<void> {
  await executer(async () => {
    const { id } = valider(z.object({ id: schemaId }), fd);
    const el = await elementAMoi(id);
    const admin = await clientAdmin();
    const { data } = await admin.from("fichiers").select("chemin").eq("element_id", el.id);
    const { db } = await utilisateur();
    const { error } = await db.from("elements").delete().eq("id", el.id);
    if (error) throw new Error(`Suppression : ${error.message}`);
    await supprimerObjets((data ?? []).map((l) => (typeof l.chemin === "string" ? l.chemin : null)));
    return { message: `${el.nom} retiré de la bibliothèque.` };
  });
}

/** Retire une photo ou une vidéo de référence (d'un personnage ou d'un élément). */
export async function supprimerReference(fd: FormData): Promise<void> {
  await executer(async () => {
    const { fichier_id } = valider(schemaFichierSeul, fd);
    const { db } = await utilisateur();
    const f = ligne(ligneFichier, (await db.from("fichiers").select("*").eq("id", fichier_id).maybeSingle()).data);
    if (!f || f.genre !== "reference") throw new ErreurUtilisateur("Photo introuvable.");
    await (await clientAdmin()).from("fichiers").delete().eq("id", f.id);
    await supprimerObjets([f.chemin]);
    return { message: "Photo retirée." };
  });
}

/** Choisit la fiche d'un personnage parmi les visages proposés. */
export async function choisirFiche(fd: FormData): Promise<void> {
  await executer(async () => {
    const { fichier_id } = valider(schemaFichierSeul, fd);
    const { db } = await utilisateur();
    const f = ligne(ligneFichier, (await db.from("fichiers").select("*").eq("id", fichier_id).maybeSingle()).data);
    if (!f || f.genre !== "fiche" || !f.personnage_id || !f.chemin) throw new ErreurUtilisateur("Visage introuvable.");
    const { personnage } = await personnageAMoi(f.personnage_id);
    const { error } = await db.from("personnages").update({ fiche_chemin: f.chemin, fiche_statut: "prete" }).eq("id", personnage.id);
    if (error) throw new Error(`Fiche : ${error.message}`);
    return { message: `Visage retenu pour ${personnage.nom}. Il sert de référence pour les prochains plans.` };
  });
}

/** Crée un personnage à partir d'une simple description : l'IA propose 4 visages, on choisit ensuite. */
export async function creerPersonnageDecrit(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaPersonnageDecrit, fd);
    const serie = await serieAMoi(d.serie_id);
    const { db } = await utilisateur();
    const { count } = await db.from("personnages").select("id", { count: "exact", head: true }).eq("serie_id", serie.id);
    const { data, error } = await db
      .from("personnages")
      .insert({ serie_id: serie.id, nom: d.nom, description: d.description, position: count ?? 0, source_voix: "grok", voix_id: VOIX_GROK_DEFAUT, fiche_statut: "en_cours" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Création du personnage : ${error?.message ?? "réponse vide"}`);
    await exigerMiseEnFile({ espace_id: serie.espace_id, type: "fiche_personnage", donnees: { personnage_id: String(data.id), propositions: 4 } });
    return { message: `${d.nom} créé : 4 visages en cours, choisis le tien dans la bibliothèque.` };
  });
}
