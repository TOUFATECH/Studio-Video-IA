// Import de la chanson d'un clip (MP3, WAV ou M4A, 45 Mo au plus) : type réel vérifié par la signature binaire,
// enregistrement dans les médias, remplacement de l'ancienne chanson, lancement de la synchronisation des paroles.
import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { episodeAMoi } from "@/lib/appartenance";
import { clientAdmin, clientUtilisateur, sessionCourante } from "@/lib/bdd";
import { ErreurUtilisateur, messageErreur } from "@/lib/erreurs";
import { ecrireMedia, supprimerObjets } from "@/lib/medias";
import { id as schemaId } from "@/lib/schemas";
import { REGLES_IMPORT, verifierImport } from "@/lib/signature";
import { mettreEnFile } from "@/lib/taches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Réponse JSON avec un message lisible. */
function reponse(message: string, statut = 200) {
  return NextResponse.json({ message }, { status: statut });
}

/** Reçoit la chanson d'un clip. */
export async function POST(requete: NextRequest) {
  try {
    const user = await sessionCourante();
    if (!user) return reponse("Non connecté.", 401);
    const regle = REGLES_IMPORT.chanson;
    // Refus avant lecture du corps d'un envoi annoncé trop lourd.
    if (Number(requete.headers.get("content-length") ?? "0") > regle.maxOctets + 1024 * 1024) return reponse(`Fichier trop lourd : ${regle.libelle}.`, 413);
    const fd = await requete.formData();
    const cible = schemaId.safeParse(fd.get("cible"));
    const fichier = fd.get("fichier");
    if (!cible.success || !(fichier instanceof File)) return reponse("Demande d’import invalide.", 400);
    if (fichier.size > regle.maxOctets) return reponse(`Fichier trop lourd : ${regle.libelle}.`, 413);
    const { episode, serie } = await episodeAMoi(cible.data);
    if (episode.genre !== "clip") throw new ErreurUtilisateur("Une chanson ne s’ajoute qu’à un clip.");

    const octets = new Uint8Array(await fichier.arrayBuffer());
    const verif = verifierImport("chanson", octets, fichier.size);
    if (!verif.ok) return reponse(verif.erreur, 415);
    const chemin = `${serie.espace_id}/${episode.id}/chanson/${randomUUID()}.${verif.extension}`;
    await ecrireMedia(chemin, octets);

    const admin = await clientAdmin();
    const { data: anciennes } = await admin.from("fichiers").select("id, chemin").eq("episode_id", episode.id).eq("genre", "chanson");
    const { error } = await admin.from("fichiers").insert({ espace_id: serie.espace_id, episode_id: episode.id, genre: "chanson", chemin, statut: "pret", cout: 0 });
    if (error) {
      await supprimerObjets([chemin]);
      throw new Error(`Enregistrement de la chanson : ${error.message}`);
    }
    // L'ancienne chanson est remplacée ; l'alignement et l'extrait sont à refaire sur la nouvelle.
    const vieilles = ((anciennes ?? []) as { id: string; chemin: string | null }[]).filter((a) => a.chemin !== chemin);
    if (vieilles.length) {
      await admin.from("fichiers").delete().in("id", vieilles.map((v) => v.id));
      await supprimerObjets(vieilles.map((v) => v.chemin));
    }
    const db = await clientUtilisateur(user.id);
    await db.from("episodes").update({ paroles_alignees: null, paroles_traduites: {}, extrait_debut: 0, extrait_fin: null }).eq("id", episode.id);
    const r = await mettreEnFile({ espace_id: serie.espace_id, episode_id: episode.id, type: "synchro" });
    return reponse(
      r.ok
        ? episode.paroles.trim() || episode.instrumental
          ? "Chanson reçue. Synchronisation des paroles en file."
          : "Chanson reçue. Pas de paroles saisies : elles vont être reconnues dans la chanson."
        : "Chanson reçue. Une synchronisation est déjà en cours : relance-la quand elle sera finie.",
    );
  } catch (e) {
    return reponse(messageErreur(e), e instanceof ErreurUtilisateur ? 400 : 500);
  }
}
