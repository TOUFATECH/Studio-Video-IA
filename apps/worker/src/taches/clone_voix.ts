// Tâche « clone_voix » : clonage instantané ElevenLabs à partir des échantillons d'un personnage (avec son accord).
import type { Fichier, Personnage } from "@feuilleton/core";
import { clonerVoix } from "@feuilleton/integrations";
import { z } from "zod";
import { exigerCle } from "../cles";
import type { Contexte } from "../contexte";
import { typeMime } from "../stockage";
import { ecrire, ligne, lignes } from "../supabase";

/** Données attendues : le personnage dont on clone la voix. */
export const schemaDonneesClone = z.object({ personnage_id: z.string().min(1) });

/** Exécute la tâche clone_voix. */
export async function tacheCloneVoix(ctx: Contexte): Promise<void> {
  const { personnage_id } = schemaDonneesClone.parse(ctx.tache.donnees ?? {});
  const perso = await ligne<Personnage>(ctx.db.from("personnages").select("*").eq("id", personnage_id).limit(1), "personnage");
  // Le clonage d'une voix réelle exige l'accord de la personne : la base l'impose aussi (contrainte clone_avec_accord).
  if (!perso.accord_clone) throw new Error(`Accord de clonage manquant pour ${perso.nom} : coche l'accord de la personne avant de cloner sa voix.`);
  const echantillons = await lignes<Fichier>(
    ctx.db.from("fichiers").select("*").eq("personnage_id", perso.id).eq("genre", "echantillon_voix").eq("statut", "pret").order("cree_le"),
    "échantillons de voix",
  );
  const utilisables = echantillons.filter((f) => f.chemin);
  if (utilisables.length === 0) throw new Error(`Aucun échantillon de voix pour ${perso.nom} : ajoute au moins un enregistrement d'une minute environ.`);
  const cle = exigerCle(await ctx.cles(), "elevenlabs");
  await ctx.progression({ fait: 0, total: 2, etape: `Lecture de ${utilisables.length} échantillon(s)` });
  const fichiers = [];
  for (const f of utilisables) {
    const chemin = f.chemin ?? "";
    fichiers.push({ nom: chemin.split("/").pop() ?? "echantillon.mp3", donnees: await ctx.stockage.lire(chemin), type: typeMime(chemin) });
  }
  await ctx.progression({ fait: 1, total: 2, etape: "Clonage chez ElevenLabs" });
  const voixId = await clonerVoix(cle, { nom: `${perso.nom} (Feuilleton)`, description: perso.description.slice(0, 500), echantillons: fichiers }, ctx.f);
  await ecrire(ctx.db.from("personnages").update({ voix_id: voixId, source_voix: "elevenlabs_clone" }).eq("id", perso.id), "voix clonée");
  await ctx.progression({ fait: 2, total: 2, etape: `Voix de ${perso.nom} clonée` });
}
