// Import de fichiers : échantillons de voix (+ tâche de clonage), musique d'un compte, image de référence d'un personnage.
// Le type est vérifié par la signature binaire, le nom est généré ici, l'appartenance est vérifiée avant toute écriture.
import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { espaceAMoi, personnageAMoi } from "@/lib/appartenance";
import { ErreurUtilisateur, messageErreur } from "@/lib/erreurs";
import { BUCKET, supprimerObjets } from "@/lib/medias";
import { id as schemaId } from "@/lib/schemas";
import { REGLES_IMPORT, verifierImport } from "@/lib/signature";
import { clientAdmin } from "@/lib/supabase/admin";
import { clientServeur } from "@/lib/supabase/serveur";
import { mettreEnFile } from "@/lib/taches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Champs texte du formulaire d'import. */
const schemaImport = z.object({ genre: z.enum(["echantillon_voix", "musique", "fiche"]), cible: schemaId });

/** Réponse JSON avec un message lisible. */
function reponse(message: string, statut = 200) {
  return NextResponse.json({ message }, { status: statut });
}

/** Reçoit un fichier et l'enregistre dans le bucket « medias ». */
export async function POST(requete: NextRequest) {
  try {
    const supabase = await clientServeur();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return reponse("Non connecté.", 401);
    // Refus avant lecture du corps : un envoi annoncé au-delà du plus gros fichier permis (20 Mo + marge du formulaire) n'est pas lu.
    const annonce = Number(requete.headers.get("content-length") ?? "0");
    const plusGros = Math.max(...Object.values(REGLES_IMPORT).map((r) => r.maxOctets));
    if (annonce > plusGros + 1024 * 1024) return reponse("Fichier trop lourd.", 413);
    const fd = await requete.formData();
    const champs = schemaImport.safeParse({ genre: fd.get("genre"), cible: fd.get("cible") });
    if (!champs.success) return reponse("Demande d’import invalide.", 400);
    const { genre, cible } = champs.data;
    const fichier = fd.get("fichier");
    if (!(fichier instanceof File)) return reponse("Aucun fichier reçu.", 400);
    // Taille contrôlée avant de lire le contenu en mémoire.
    if (fichier.size > REGLES_IMPORT[genre].maxOctets) return reponse(`Fichier trop lourd : ${REGLES_IMPORT[genre].libelle}.`, 413);

    // Appartenance : le personnage (voix, fiche) ou l'espace (musique) doit être à l'utilisateur.
    let espaceId: string;
    let personnageId: string | null = null;
    let anciennesFiches: string[] = [];
    if (genre === "musique") {
      espaceId = (await espaceAMoi(cible)).id;
    } else {
      const { personnage, serie } = await personnageAMoi(cible);
      espaceId = serie.espace_id;
      personnageId = personnage.id;
      if (genre === "echantillon_voix" && (personnage.source_voix !== "elevenlabs_clone" || !personnage.accord_clone)) {
        throw new ErreurUtilisateur("Choisis « voix clonée », coche l’accord de la personne et enregistre avant d’importer un échantillon.");
      }
      if (genre === "fiche" && personnage.fiche_chemin) anciennesFiches = [personnage.fiche_chemin];
    }

    const octets = new Uint8Array(await fichier.arrayBuffer());
    const verif = verifierImport(genre, octets, fichier.size);
    if (!verif.ok) return reponse(verif.erreur, 415);

    const dossier = genre === "musique" ? "musique" : genre === "fiche" ? `fiches/${personnageId}` : `voix/${personnageId}`;
    const chemin = `${espaceId}/${dossier}/${randomUUID()}.${verif.extension}`;
    const admin = clientAdmin();
    const { error: eUpload } = await admin.storage.from(BUCKET).upload(chemin, octets, { contentType: verif.mime, upsert: false });
    if (eUpload) throw new Error(`Envoi vers le stockage : ${eUpload.message}`);
    const { error: eLigne } = await admin.from("fichiers").insert({ espace_id: espaceId, personnage_id: personnageId, genre, chemin, statut: "pret", cout: 0 });
    if (eLigne) {
      await supprimerObjets([chemin]);
      throw new Error(`Enregistrement du fichier : ${eLigne.message}`);
    }

    if (genre === "fiche" && personnageId) {
      // L'image importée remplace la fiche actuelle : l'ancienne est supprimée.
      await supabase.from("personnages").update({ fiche_chemin: chemin, fiche_statut: "prete" }).eq("id", personnageId);
      if (anciennesFiches.length) {
        await admin.from("fichiers").delete().eq("personnage_id", personnageId).eq("genre", "fiche").in("chemin", anciennesFiches);
        await supprimerObjets(anciennesFiches);
      }
      return reponse("Image de référence enregistrée.");
    }
    if (genre === "echantillon_voix" && personnageId) {
      const r = await mettreEnFile({ espace_id: espaceId, type: "clone_voix", donnees: { personnage_id: personnageId } });
      return reponse(r.ok ? "Échantillon reçu. Clonage de la voix en file." : "Échantillon ajouté. Un clonage est déjà en cours : il le prendra en compte au prochain essai.");
    }
    return reponse("Musique ajoutée au compte.");
  } catch (e) {
    return reponse(messageErreur(e), e instanceof ErreurUtilisateur ? 400 : 500);
  }
}
