// Import de la chanson d'un clip, en deux temps pour passer les gros fichiers (jusqu'à 45 Mo) :
// 1. « adresse » : après vérification du clip, le serveur crée une adresse d'envoi signée vers le stockage ;
//    le navigateur y envoie le fichier directement (rien ne transite par le serveur web, ni par sa limite de taille).
// 2. « valider » : le serveur relit le fichier, vérifie son type réel par sa signature binaire, l'enregistre comme
//    chanson du clip (l'ancienne est supprimée) et lance la synchronisation des paroles.
import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { episodeAMoi } from "@/lib/appartenance";
import { ErreurUtilisateur, messageErreur } from "@/lib/erreurs";
import { BUCKET, supprimerObjets } from "@/lib/medias";
import { schemaImportChanson } from "@/lib/schemas";
import { REGLES_IMPORT, verifierImport } from "@/lib/signature";
import { clientAdmin } from "@/lib/supabase/admin";
import { clientServeur } from "@/lib/supabase/serveur";
import { mettreEnFile } from "@/lib/taches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Réponse JSON avec un message lisible (et des champs en plus au besoin). */
function reponse(corps: { message: string } & Record<string, unknown>, statut = 200) {
  return NextResponse.json(corps, { status: statut });
}

/** Dossier des chansons d'un clip : <espace>/<clip>/chanson/. */
function dossierChanson(espaceId: string, episodeId: string): string {
  return `${espaceId}/${episodeId}/chanson/`;
}

/** Clip de l'utilisateur (refus si l'épisode n'est pas un clip). */
async function clipAMoi(cible: string) {
  const { episode, serie } = await episodeAMoi(cible);
  if (episode.genre !== "clip") throw new ErreurUtilisateur("Une chanson ne s’ajoute qu’à un clip.");
  return { episode, serie };
}

/** Prépare l'envoi ou valide la chanson envoyée. */
export async function POST(requete: NextRequest) {
  try {
    const supabase = await clientServeur();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return reponse({ message: "Non connecté." }, 401);
    const brut: unknown = await requete.json().catch(() => null);
    const d = schemaImportChanson.safeParse(brut);
    if (!d.success) return reponse({ message: "Demande d’import invalide." }, 400);
    const { episode, serie } = await clipAMoi(d.data.cible);
    const admin = clientAdmin();
    const regle = REGLES_IMPORT.chanson;

    if (d.data.etape === "adresse") {
      if (d.data.taille > regle.maxOctets) return reponse({ message: `Fichier trop lourd : ${regle.libelle}.` }, 413);
      const chemin = `${dossierChanson(serie.espace_id, episode.id)}${randomUUID()}.${d.data.extension}`;
      const { data: signe, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(chemin);
      if (error || !signe) throw new Error(`Adresse d’envoi impossible : ${error?.message ?? "réponse vide"}`);
      // L'adresse signée ne sert qu'à envoyer CE fichier, une seule fois, à ce chemin.
      return reponse({ message: "Adresse prête.", adresse: signe.signedUrl, chemin });
    }

    // Validation : le chemin doit être dans le dossier des chansons de CE clip.
    const chemin = d.data.chemin;
    if (!chemin.startsWith(dossierChanson(serie.espace_id, episode.id)) || chemin.includes("..")) return reponse({ message: "Chemin refusé." }, 400);
    const { data: blob, error: eLecture } = await admin.storage.from(BUCKET).download(chemin);
    if (eLecture || !blob) return reponse({ message: "Fichier introuvable : l’envoi n’est pas allé au bout, recommence." }, 400);
    const octets = new Uint8Array(await blob.arrayBuffer());
    const verif = verifierImport("chanson", octets, octets.byteLength);
    if (!verif.ok) {
      await supprimerObjets([chemin]);
      return reponse({ message: verif.erreur }, 415);
    }
    const { data: anciennes } = await admin.from("fichiers").select("id, chemin").eq("episode_id", episode.id).eq("genre", "chanson");
    const { error: eLigne } = await admin.from("fichiers").insert({ espace_id: serie.espace_id, episode_id: episode.id, genre: "chanson", chemin, statut: "pret", cout: 0 });
    if (eLigne) {
      await supprimerObjets([chemin]);
      throw new Error(`Enregistrement de la chanson : ${eLigne.message}`);
    }
    // L'ancienne chanson est remplacée ; l'alignement et l'extrait sont à refaire sur la nouvelle.
    const vieilles = (anciennes ?? []).map((a) => ({ id: String(a.id), chemin: typeof a.chemin === "string" ? a.chemin : null }));
    if (vieilles.length) {
      await admin.from("fichiers").delete().in("id", vieilles.map((v) => v.id));
      await supprimerObjets(vieilles.map((v) => v.chemin));
    }
    await supabase.from("episodes").update({ paroles_alignees: null, paroles_traduites: {}, extrait_debut: 0, extrait_fin: null }).eq("id", episode.id);
    const r = await mettreEnFile({ espace_id: serie.espace_id, episode_id: episode.id, type: "synchro" });
    return reponse({
      message: r.ok
        ? episode.paroles.trim() || episode.instrumental
          ? "Chanson reçue. Synchronisation des paroles en file."
          : "Chanson reçue. Pas de paroles saisies : elles vont être reconnues dans la chanson."
        : "Chanson reçue. Une synchronisation est déjà en cours : relance-la quand elle sera finie.",
    });
  } catch (e) {
    return reponse({ message: messageErreur(e) }, e instanceof ErreurUtilisateur ? 400 : 500);
  }
}
