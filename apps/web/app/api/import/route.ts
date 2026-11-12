// Import de fichiers : échantillons de voix (+ tâche de clonage), musique d'un compte, image de référence d'un personnage,
// photos et vidéos de la bibliothèque (personnages et éléments), et « Remplacer par mon fichier » pour l'image ou le clip d'un plan.
// Le type est vérifié par la signature binaire, le nom est généré ici, l'appartenance est vérifiée avant toute écriture.
// Toute photo d'une vraie personne exige l'accord de la personne (case obligatoire).
import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { espaceAMoi, personnageAMoi, planAMoi } from "@/lib/appartenance";
import { ErreurUtilisateur, messageErreur } from "@/lib/erreurs";
import { imageDeVideo, preparerPhoto, sonderVideo } from "@/lib/images";
import { supprimerRendus } from "@/lib/invalidation";
import { ligne, ligneElement } from "@/lib/lignes";
import { ecrireMedia, supprimerObjets } from "@/lib/medias";
import { caseACocher, id as schemaId } from "@/lib/schemas";
import { MAX_PHOTO_REFERENCE, REGLES_IMPORT, verifierImport } from "@/lib/signature";
import { clientAdmin, clientUtilisateur, sessionCourante } from "@/lib/bdd";
import { mettreEnFile } from "@/lib/taches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Champs texte du formulaire d'import. */
const schemaImport = z.object({
  genre: z.enum(["echantillon_voix", "musique", "fiche", "reference", "remplacement_image", "remplacement_clip"]),
  cible: schemaId,
  /** Pour une référence : la cible est un personnage ou un élément de la bibliothèque. */
  cible_type: z.enum(["personnage", "element"]).default("personnage"),
  personne_reelle: caseACocher,
  accord: caseACocher,
});

/** Réponse JSON avec un message lisible. */
function reponse(message: string, statut = 200) {
  return NextResponse.json({ message }, { status: statut });
}

/** Nom d'origine nettoyé (affiché dans la bibliothèque). */
function nomOrigine(f: File): string {
  return (f.name || "fichier").replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 120);
}

/** Reçoit un fichier et l'enregistre dans les médias. */
export async function POST(requete: NextRequest) {
  try {
    const user = await sessionCourante();
    if (!user) return reponse("Non connecté.", 401);
    const db = await clientUtilisateur(user.id);
    // Refus avant lecture du corps : un envoi annoncé au-delà du plus gros fichier permis n'est pas lu.
    const annonce = Number(requete.headers.get("content-length") ?? "0");
    // (La chanson d'un clip a sa propre route : /api/import/chanson.)
    const plusGros = Math.max(...schemaImport.shape.genre.options.map((g) => REGLES_IMPORT[g].maxOctets));
    if (annonce > plusGros + 1024 * 1024) return reponse("Fichier trop lourd.", 413);
    const fd = await requete.formData();
    const champs = schemaImport.safeParse({ genre: fd.get("genre"), cible: fd.get("cible"), cible_type: fd.get("cible_type") ?? undefined, personne_reelle: fd.get("personne_reelle"), accord: fd.get("accord") });
    if (!champs.success) return reponse("Demande d’import invalide.", 400);
    const { genre, cible, cible_type } = champs.data;
    const fichier = fd.get("fichier");
    if (!(fichier instanceof File)) return reponse("Aucun fichier reçu.", 400);
    // Taille contrôlée avant de lire le contenu en mémoire.
    if (fichier.size > REGLES_IMPORT[genre].maxOctets) return reponse(`Fichier trop lourd : ${REGLES_IMPORT[genre].libelle}.`, 413);
    const octets = new Uint8Array(await fichier.arrayBuffer());
    const verif = verifierImport(genre, octets, fichier.size);
    if (!verif.ok) return reponse(verif.erreur, 415);
    const admin = await clientAdmin();

    // ----- Bibliothèque : photos et vidéos de référence -----
    if (genre === "reference") {
      if (champs.data.personne_reelle && !champs.data.accord) throw new ErreurUtilisateur("Photo d’une vraie personne : coche l’accord de la personne (droit à l’image) avant d’importer.");
      let espaceId: string;
      let personnageId: string | null = null;
      let elementId: string | null = null;
      let logo = false;
      if (cible_type === "element") {
        const el = ligne(ligneElement, (await db.from("elements").select("*").eq("id", cible).maybeSingle()).data);
        if (!el) throw new ErreurUtilisateur("Élément introuvable.");
        espaceId = el.espace_id;
        elementId = el.id;
        logo = el.genre === "marque";
      } else {
        const { personnage, serie } = await personnageAMoi(cible);
        espaceId = serie.espace_id;
        personnageId = personnage.id;
      }
      const video = verif.type === "mp4" || verif.type === "mov" || verif.type === "m4a";
      const dossier = elementId ? `bibliotheque/${elementId}` : `personnages/${personnageId}`;
      const commun = { espace_id: espaceId, personnage_id: personnageId, element_id: elementId, genre: "reference", statut: "pret", cout: 0, personne_reelle: champs.data.personne_reelle, accord_image: champs.data.accord, nom_origine: nomOrigine(fichier), fournisseur: "import" };
      const chemins: string[] = [];
      try {
        if (video) {
          const infos = await sonderVideo(octets, verif.extension === "m4a" ? "mp4" : verif.extension);
          if (infos && !infos.video) throw new ErreurUtilisateur("Ce fichier n’a pas d’image : importe une photo ou une vidéo.");
          const ext = verif.type === "mov" ? "mov" : "mp4";
          const chemin = `${espaceId}/${dossier}/${randomUUID()}.${ext}`;
          await ecrireMedia(chemin, octets);
          chemins.push(chemin);
          const { error } = await admin.from("fichiers").insert({ ...commun, chemin, duree_s: infos?.duree ?? null });
          if (error) throw new Error(`Enregistrement : ${error.message}`);
          // Une image tirée de la vidéo sert de référence aux IA d'images et de vidéos.
          const image = await imageDeVideo(octets, ext);
          if (image) {
            const cheminImage = `${espaceId}/${dossier}/${randomUUID()}.jpg`;
            await ecrireMedia(cheminImage, image);
            chemins.push(cheminImage);
            await admin.from("fichiers").insert({ ...commun, chemin: cheminImage, nom_origine: `${commun.nom_origine} (image)` });
          }
          return reponse(image ? "Vidéo ajoutée, avec une image de référence tirée de la vidéo." : "Vidéo ajoutée. Ajoute aussi une photo : les IA partent d’images fixes.");
        }
        if (fichier.size > MAX_PHOTO_REFERENCE) throw new ErreurUtilisateur("Photo trop lourde : 15 Mo maximum.");
        const photo = await preparerPhoto(octets, { logo });
        const chemin = `${espaceId}/${dossier}/${randomUUID()}.${photo.extension}`;
        await ecrireMedia(chemin, photo.donnees);
        chemins.push(chemin);
        const { error } = await admin.from("fichiers").insert({ ...commun, chemin });
        if (error) throw new Error(`Enregistrement : ${error.message}`);
        return reponse(`Photo ajoutée (redressée${logo ? "" : ", bords recadrés"}, ${photo.largeur}×${photo.hauteur}).`);
      } catch (e) {
        await supprimerObjets(chemins);
        throw e;
      }
    }

    // ----- « Remplacer par mon fichier » : image ou clip d'un plan -----
    if (genre === "remplacement_image" || genre === "remplacement_clip") {
      const { plan, episode, serie } = await planAMoi(cible);
      const image = genre === "remplacement_image";
      let donnees: Uint8Array = octets;
      let extension: string = verif.extension;
      let duree: number | null = null;
      if (image) {
        const photo = await preparerPhoto(octets);
        donnees = photo.donnees;
        extension = photo.extension;
      } else {
        extension = verif.type === "mov" ? "mov" : "mp4";
        const infos = await sonderVideo(octets, extension);
        if (infos && !infos.video) throw new ErreurUtilisateur("Ce fichier n’a pas d’image : importe une vidéo.");
        duree = infos?.duree ?? null;
      }
      const chemin = `${serie.espace_id}/${episode.id}/${image ? "image" : "clip"}/${plan.id}-import-${randomUUID().slice(0, 8)}.${extension}`;
      await ecrireMedia(chemin, donnees);
      const { error } = await admin.from("fichiers").insert({
        espace_id: serie.espace_id,
        episode_id: episode.id,
        plan_id: plan.id,
        genre: image ? "image" : "clip",
        prise: image ? null : plan.prise_choisie,
        chemin,
        duree_s: duree,
        statut: "pret",
        cout: 0,
        fournisseur: "import",
        consigne: "Remplacé par ton fichier",
        nom_origine: nomOrigine(fichier),
      });
      if (error) {
        await supprimerObjets([chemin]);
        throw new Error(`Enregistrement : ${error.message}`);
      }
      // Ton image est validée d'office ; son ancien clip est périmé et sera refait au prochain lancement.
      if (image) await db.from("plans").update({ valide: true }).eq("id", plan.id);
      await supprimerRendus(episode.id);
      return reponse(image ? "Ton image remplace celle du plan (l’ancienne reste dans les versions). Relance le clip de ce plan." : "Ton clip remplace celui du plan. Relance le rendu.");
    }

    // ----- Voix, musique, fiche -----
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

    const dossier = genre === "musique" ? "musique" : genre === "fiche" ? `fiches/${personnageId}` : `voix/${personnageId}`;
    // Une fiche importée est redressée comme les autres photos.
    const fiche = genre === "fiche" ? await preparerPhoto(octets) : null;
    const chemin = `${espaceId}/${dossier}/${randomUUID()}.${fiche ? fiche.extension : verif.extension}`;
    await ecrireMedia(chemin, fiche ? fiche.donnees : octets);
    const { error: eLigne } = await admin.from("fichiers").insert({ espace_id: espaceId, personnage_id: personnageId, genre, chemin, statut: "pret", cout: 0, fournisseur: "import", nom_origine: nomOrigine(fichier) });
    if (eLigne) {
      await supprimerObjets([chemin]);
      throw new Error(`Enregistrement du fichier : ${eLigne.message}`);
    }

    if (genre === "fiche" && personnageId) {
      // L'image importée remplace la fiche actuelle : l'ancienne est supprimée.
      await db.from("personnages").update({ fiche_chemin: chemin, fiche_statut: "prete" }).eq("id", personnageId);
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
