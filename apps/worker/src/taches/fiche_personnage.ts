// Tâche « fiche_personnage » : image de référence d'un personnage (face, profil, plein pied) utilisée ensuite pour chaque plan.
// À partir de ses photos (si l'utilisateur en a importé) ou de sa seule description ; 1 à 4 propositions, on choisit ensuite.
import { promptFiche, type Fichier, type Personnage, type Serie } from "@studio-video-ia/core";
import { genererImage, modifierImage, type ImageReference } from "@studio-video-ia/integrations";
import { z } from "zod";
import { lireReferences, photosDe, typeImage } from "../bibliotheque";
import { exigerCle } from "../cles";
import { avecRelance, type Contexte } from "../contexte";
import { chargerReglages, enregistrerFichier, erreurCourte, normaliserFichier } from "../donnees";
import { cheminEspace, nomUnique } from "../stockage";
import { ecrire, ligne, lignes } from "../bdd";

/** Données attendues : le personnage à dessiner et le nombre de visages proposés (1 par défaut, 4 pour un nouveau). */
export const schemaDonneesFiche = z.object({ personnage_id: z.string().min(1), propositions: z.number().int().min(1).max(4).default(1) });

/** Exécute la tâche fiche_personnage. */
export async function tacheFichePersonnage(ctx: Contexte): Promise<void> {
  const { personnage_id, propositions } = schemaDonneesFiche.parse(ctx.tache.donnees ?? {});
  const perso = await ligne<Personnage>(ctx.db.from("personnages").select("*").eq("id", personnage_id).limit(1), "personnage");
  const serie = await ligne<Serie>(ctx.db.from("series").select("*").eq("id", perso.serie_id).limit(1), "série");
  const cle = exigerCle(await ctx.cles(), "openai");
  const { tarifs } = await chargerReglages(ctx.db, await ctx.proprietaire());
  await ecrire(ctx.db.from("personnages").update({ fiche_statut: "en_cours" }).eq("id", perso.id), "fiche en cours");

  // Photos importées du personnage (accord de la personne vérifié à l'import) : la fiche les respecte.
  const refs = (await lignes<Fichier>(ctx.db.from("fichiers").select("*").eq("personnage_id", perso.id).eq("genre", "reference").eq("statut", "pret"), "photos du personnage")).map(normaliserFichier);
  const photos = photosDe(refs, { personnage_id: perso.id }).slice(0, 4);
  const references: ImageReference[] = await lireReferences(
    ctx.stockage,
    photos.map((p) => ({ chemin: p.chemin ?? "", type: typeImage(p.chemin) ?? "image/png", libelle: perso.nom })),
    ctx.journal,
  );
  const prompt = `${promptFiche(perso, serie)}${references.length ? " Les photos fournies montrent la vraie personne : garde exactement son visage, son teint et sa coiffure." : ""}`;

  let premier: string | null = null;
  let echecs = 0;
  for (let k = 0; k < propositions; k++) {
    ctx.verifierArret();
    await ctx.verifierBudget();
    await ctx.progression({ fait: k, total: propositions, etape: `Fiche de ${perso.nom}${propositions > 1 ? ` · visage ${k + 1}/${propositions}` : ""}` });
    const debut = Date.now();
    try {
      // Trois vues côte à côte : un format horizontal leur laisse la place.
      const { valeur: png, essais } = await avecRelance(() =>
        references.length
          ? modifierImage(cle, { modele: ctx.config.modeles.image, prompt, taille: "1536x1024", references, qualite: ctx.config.modeles.qualiteImage }, ctx.f)
          : genererImage(cle, { modele: ctx.config.modeles.image, prompt, taille: "1536x1024", qualite: ctx.config.modeles.qualiteImage }, ctx.f),
      );
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
        consigne: prompt,
        fournisseur: "openai",
      });
      premier ??= chemin;
    } catch (e) {
      echecs++;
      ctx.journal(`fiche de ${perso.nom} (visage ${k + 1}) : ${erreurCourte(e)}`);
    }
  }
  if (!premier) {
    await ecrire(ctx.db.from("personnages").update({ fiche_statut: "echec" }).eq("id", perso.id), "fiche en échec");
    throw new Error(`Fiche de ${perso.nom} : aucune image produite.`);
  }
  // La première proposition devient la fiche ; les autres restent au choix dans la bibliothèque.
  await ecrire(ctx.db.from("personnages").update({ fiche_chemin: premier, fiche_statut: "prete" }).eq("id", perso.id), "fiche prête");
  await ctx.progression({ fait: propositions, total: propositions, etape: echecs ? `${propositions - echecs} visage(s) prêt(s), ${echecs} en échec` : `Fiche de ${perso.nom} prête` });
}
