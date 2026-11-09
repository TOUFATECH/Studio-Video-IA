// Tâche « storyboard » : une image par plan (fiches personnages et plan précédent en références), une relance par plan.
import { coutUnite, promptImage, type Personnage, type Plan } from "@feuilleton/core";
import { genererImage, modifierImage, type ImageReference, type TailleImage } from "@feuilleton/integrations";
import { z } from "zod";
import { exigerCle } from "../cles";
import { avecRelance, ErreurAnnulee, ErreurArret, ErreurPlafond, type Contexte } from "../contexte";
import { chargerEpisode, chargerReglages, enregistrerFichier, erreurCourte, fichierPret, nomPlan, unitePrete } from "../donnees";
import { cheminMedia, nomUnique } from "../stockage";

/** Données acceptées : liste de plans à (re)générer, sinon tous les plans sans image prête. */
export const schemaDonneesStoryboard = z.object({ plan_ids: z.array(z.string()).optional() });

/** Taille d'image selon le format : verticale pour un court ou un générique, horizontale pour un film. */
export function tailleImage(format: "court" | "long"): TailleImage {
  return format === "long" ? "1536x1024" : "1024x1536";
}

/** Personnages présents dans un plan : celui qui parle, et ceux dont le nom apparaît dans la description. */
export function personnagesPresents(plan: Pick<Plan, "personnage_id" | "texte">, personnages: readonly Personnage[]): Personnage[] {
  const texte = plan.texte.toLowerCase();
  return personnages.filter((p) => p.id === plan.personnage_id || (p.nom.trim().length > 1 && texte.includes(p.nom.trim().toLowerCase())));
}

/** Exécute la tâche storyboard. */
export async function tacheStoryboard(ctx: Contexte): Promise<void> {
  const donnees = schemaDonneesStoryboard.parse(ctx.tache.donnees ?? {});
  if (!ctx.tache.episode_id) throw new Error("Tâche storyboard sans épisode.");
  const e = await chargerEpisode(ctx.db, ctx.tache.episode_id);
  if (e.plans.length === 0) throw new Error("L'épisode n'a pas encore de scénario.");
  const cle = exigerCle(await ctx.cles(), "openai");
  const { tarifs } = await chargerReglages(ctx.db, await ctx.proprietaire());
  const cibles = donnees.plan_ids?.length ? e.plans.filter((p) => donnees.plan_ids?.includes(p.id)) : e.plans.filter((p) => !unitePrete(e.fichiers, `${p.id}:image`));
  const fichiers = [...e.fichiers];

  // Fiches de référence prêtes, lues une seule fois pour tout l'épisode.
  const fiches = new Map<string, ImageReference>();
  for (const p of e.personnages) {
    if (p.fiche_statut !== "prete" || !p.fiche_chemin) continue;
    try {
      fiches.set(p.id, { nom: `fiche-${p.id}.png`, donnees: await ctx.stockage.lire(p.fiche_chemin) });
    } catch (err) {
      ctx.journal(`fiche de ${p.nom} illisible, ignorée : ${erreurCourte(err)}`);
    }
  }

  let fait = 0;
  let echecs = 0;
  for (const plan of cibles) {
    ctx.verifierArret();
    await ctx.verifierBudget();
    await ctx.progression({ fait, total: cibles.length, etape: `Image du ${nomPlan(e.plans, plan)} (${fait + 1}/${cibles.length})`, echecs });
    const presents = personnagesPresents(plan, e.personnages);
    const references: ImageReference[] = presents.map((p) => fiches.get(p.id)).filter((x): x is ImageReference => !!x);
    const avecFiches = references.length > 0;
    const precedent = e.episode.enchainer ? e.plans[e.plans.findIndex((p) => p.id === plan.id) - 1] : undefined;
    if (precedent) {
      const img = fichierPret(fichiers, `${precedent.id}:image`);
      if (img?.chemin) references.push({ nom: "plan-precedent.png", donnees: await ctx.stockage.lire(img.chemin) });
    }
    const prompt = promptImage({
      serie: e.serie,
      personnagesPresents: presents,
      plan,
      vertical: e.episode.format !== "long",
      planPrecedent: precedent ? precedent.texte : null,
      avecFiches,
    });
    const debut = Date.now();
    const taille = tailleImage(e.episode.format);
    try {
      const { valeur: png, essais } = await avecRelance(() =>
        references.length
          ? modifierImage(cle, { modele: ctx.config.modeles.image, prompt, taille, references }, ctx.f)
          : genererImage(cle, { modele: ctx.config.modeles.image, prompt, taille }, ctx.f),
      );
      const chemin = cheminMedia(e.serie.espace_id, e.episode.id, "image", nomUnique(plan.id, "png"));
      await ctx.stockage.envoyer(chemin, png, "image/png");
      const f = await enregistrerFichier(ctx.db, {
        espace_id: ctx.tache.espace_id,
        episode_id: e.episode.id,
        plan_id: plan.id,
        genre: "image",
        chemin,
        secondes_generation: Math.round((Date.now() - debut) / 100) / 10,
        // Une relance a aussi été facturée : le coût compte chaque essai.
        cout: coutUnite({ cle: `${plan.id}:image`, genre: "image", plan, langue: null, prise: null }, 0, tarifs) * essais,
        essais,
      });
      fichiers.push(f);
    } catch (err) {
      if (err instanceof ErreurArret || err instanceof ErreurAnnulee || err instanceof ErreurPlafond) throw err;
      echecs++;
      ctx.journal(`échec de l'image du ${nomPlan(e.plans, plan)} : ${erreurCourte(err)}`);
      await enregistrerFichier(ctx.db, {
        espace_id: ctx.tache.espace_id,
        episode_id: e.episode.id,
        plan_id: plan.id,
        genre: "image",
        chemin: null,
        statut: "echec",
        erreur: `Image du ${nomPlan(e.plans, plan)} : ${erreurCourte(err)}`,
        essais: 2,
      });
    }
    fait++;
  }
  await ctx.progression({ fait, total: cibles.length, etape: echecs ? `${fait - echecs} image(s) prête(s), ${echecs} en échec` : `${fait} image(s) prête(s)`, echecs });
}
