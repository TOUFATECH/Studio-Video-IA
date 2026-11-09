// Tâche « fiche_personnage » : image de référence d'un personnage (face, profil, dos) utilisée ensuite pour chaque plan.
import { promptFiche, type Personnage, type Serie } from "@studio-video-ia/core";
import { genererImage } from "@studio-video-ia/integrations";
import { z } from "zod";
import { exigerCle } from "../cles";
import { avecRelance, type Contexte } from "../contexte";
import { chargerReglages, enregistrerFichier, erreurCourte } from "../donnees";
import { cheminEspace, nomUnique } from "../stockage";
import { ecrire, ligne } from "../supabase";

/** Données attendues : le personnage à dessiner. */
export const schemaDonneesFiche = z.object({ personnage_id: z.string().min(1) });

/** Exécute la tâche fiche_personnage. */
export async function tacheFichePersonnage(ctx: Contexte): Promise<void> {
  const { personnage_id } = schemaDonneesFiche.parse(ctx.tache.donnees ?? {});
  const perso = await ligne<Personnage>(ctx.db.from("personnages").select("*").eq("id", personnage_id).limit(1), "personnage");
  const serie = await ligne<Serie>(ctx.db.from("series").select("*").eq("id", perso.serie_id).limit(1), "série");
  const cle = exigerCle(await ctx.cles(), "openai");
  const { tarifs } = await chargerReglages(ctx.db, await ctx.proprietaire());
  await ecrire(ctx.db.from("personnages").update({ fiche_statut: "en_cours" }).eq("id", perso.id), "fiche en cours");
  await ctx.progression({ fait: 0, total: 1, etape: `Fiche de ${perso.nom}` });
  const debut = Date.now();
  try {
    // Trois vues côte à côte : un format horizontal leur laisse la place.
    const { valeur: png, essais } = await avecRelance(() => genererImage(cle, { modele: ctx.config.modeles.image, prompt: promptFiche(perso, serie), taille: "1536x1024", qualite: ctx.config.modeles.qualiteImage }, ctx.f));
    const chemin = cheminEspace(serie.espace_id, "personnages", nomUnique(`fiche-${perso.id}`, "png"));
    await ctx.stockage.envoyer(chemin, png, "image/png");
    await enregistrerFichier(ctx.db, {
      espace_id: serie.espace_id,
      episode_id: null,
      personnage_id: perso.id,
      genre: "fiche",
      chemin,
      secondes_generation: Math.round((Date.now() - debut) / 100) / 10,
      cout: tarifs.image * essais,
      essais,
    });
    await ecrire(ctx.db.from("personnages").update({ fiche_chemin: chemin, fiche_statut: "prete" }).eq("id", perso.id), "fiche prête");
    await ctx.progression({ fait: 1, total: 1, etape: `Fiche de ${perso.nom} prête` });
  } catch (e) {
    await ecrire(ctx.db.from("personnages").update({ fiche_statut: "echec" }).eq("id", perso.id), "fiche en échec");
    throw new Error(`Fiche de ${perso.nom} : ${erreurCourte(e)}`);
  }
}
