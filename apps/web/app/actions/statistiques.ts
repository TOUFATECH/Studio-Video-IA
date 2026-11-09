"use server";
// Actions des statistiques : synchronisation (tâche « stats ») et saisie manuelle des revenus TikTok et Instagram.
import { executer } from "@/lib/action";
import { reseauAMoi } from "@/lib/appartenance";
import { porteeCourante } from "@/lib/espace-courant";
import { ErreurUtilisateur } from "@/lib/erreurs";
import { ligne, ligneRevenu } from "@/lib/lignes";
import { formulaire, premiereErreur, schemaIdSeul, schemaRevenu, schemaSynchro } from "@/lib/schemas";
import { utilisateur } from "@/lib/session";
import { mettreEnFile } from "@/lib/taches";

/** « Synchroniser maintenant » : une tâche « stats » par espace de la portée, ou pour un seul compte. */
export async function synchroniserStats(fd: FormData): Promise<void> {
  await executer(async () => {
    const r = schemaSynchro.safeParse(formulaire(fd));
    if (!r.success) throw new ErreurUtilisateur(premiereErreur(r.error));
    if (r.data.reseau_connecte_id) {
      const compte = await reseauAMoi(r.data.reseau_connecte_id);
      const res = await mettreEnFile({ espace_id: compte.espace_id, type: "stats", donnees: { reseau_connecte_id: compte.id } });
      return res.ok ? { message: `Synchronisation de ${compte.nom_compte} en file.` } : { message: res.raison, ton: "info" };
    }
    const portee = await porteeCourante();
    let n = 0;
    for (const id of portee.ids) if ((await mettreEnFile({ espace_id: id, type: "stats" })).ok) n++;
    return n ? { message: `Synchronisation en file pour ${n} compte${n > 1 ? "s" : ""}.` } : { message: "Une synchronisation est déjà en cours.", ton: "info" };
  });
}

/** Ajoute ou modifie la saisie manuelle d'un mois (TikTok et Instagram n'ont pas d'API de revenus). */
export async function enregistrerRevenu(fd: FormData): Promise<void> {
  await executer(async () => {
    const r = schemaRevenu.safeParse(formulaire(fd));
    if (!r.success) throw new ErreurUtilisateur(premiereErreur(r.error));
    const d = r.data;
    const compte = await reseauAMoi(d.reseau_connecte_id);
    if (compte.reseau === "youtube") throw new ErreurUtilisateur("Les revenus YouTube viennent de l’API : pas de saisie manuelle.");
    const { supabase } = await utilisateur();
    const valeurs = { reseau_connecte_id: compte.id, mois: `${d.mois}-01`, montant: d.montant, devise: d.devise, note: d.note, source: "manuel" };
    if (d.id) {
      const existant = ligne(ligneRevenu, (await supabase.from("revenus").select("*").eq("id", d.id).maybeSingle()).data);
      if (!existant || existant.source !== "manuel") throw new ErreurUtilisateur("Saisie introuvable.");
      const { error } = await supabase.from("revenus").update(valeurs).eq("id", d.id);
      if (error) throw new ErreurUtilisateur(error.code === "23505" ? "Ce mois est déjà saisi pour ce compte." : "Enregistrement impossible.");
      return { message: "Revenu modifié." };
    }
    // Un seul montant manuel par compte et par mois : une nouvelle saisie remplace l'ancienne.
    const { error } = await supabase.from("revenus").upsert(valeurs, { onConflict: "reseau_connecte_id,mois,source" });
    if (error) throw new Error(`Revenu : ${error.message}`);
    return { message: "Revenu enregistré." };
  });
}

/** Supprime une saisie manuelle. */
export async function supprimerRevenu(fd: FormData): Promise<void> {
  await executer(async () => {
    const r = schemaIdSeul.safeParse(formulaire(fd));
    if (!r.success) throw new ErreurUtilisateur(premiereErreur(r.error));
    const { supabase } = await utilisateur();
    const existant = ligne(ligneRevenu, (await supabase.from("revenus").select("*").eq("id", r.data.id).maybeSingle()).data);
    if (!existant || existant.source !== "manuel") throw new ErreurUtilisateur("Saisie introuvable.");
    const { error } = await supabase.from("revenus").delete().eq("id", existant.id);
    if (error) throw new Error(`Suppression : ${error.message}`);
    return { message: "Saisie supprimée." };
  });
}
