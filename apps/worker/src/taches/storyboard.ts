// Tâche « storyboard » : l'image de chaque plan par ChatGPT (OpenAI Images), à partir des mêmes références à chaque fois
// (fiche ou photo de chaque personnage, photo du vrai décor, plan précédent), en 1 à 4 propositions, avec contrôle
// qualité automatique. Sert aussi à « Refaire avec une consigne » et à « Retoucher » une image existante.
import {
  coutUnite,
  estHorizontal,
  promptControle,
  promptImage,
  promptRetouche,
  schemaControle,
  styleVisuelClip,
  type Controle,
  type Element,
  type FormatEpisode,
  type Personnage,
  type Plan,
} from "@studio-video-ia/core";
import { genererImage, modifierImage, type ImageReference, type TailleImage } from "@studio-video-ia/integrations";
import { z } from "zod";
import { activiteDuPlan, decorDuPlan, lireReferences, personnagesDuPlan, referencesDuPlan, variantesDuPlan } from "../bibliotheque";
import { exigerCle } from "../cles";
import { avecRelance, ErreurAnnulee, ErreurArret, ErreurPlafond, type Contexte } from "../contexte";
import { chargerEpisode, chargerReglages, enregistrerFichier, erreurCourte, fichierPret, nomPlan, unitePrete, type EpisodeComplet } from "../donnees";
import { fournisseurDisponible, demanderTexteIA } from "../ia";
import { cheminMedia, nomUnique } from "../stockage";
import { ecrire } from "../bdd";

/**
 * Données acceptées : plans à (re)générer (sinon tous ceux sans image prête), nombre de propositions,
 * consigne corrigée (« la capuche doit cacher tous les cheveux ») ou retouche d'une image existante.
 */
export const schemaDonneesStoryboard = z.object({
  plan_ids: z.array(z.string()).optional(),
  propositions: z.number().int().min(1).max(4).optional(),
  consigne: z.string().max(1000).optional(),
  retouche: z.object({ consigne: z.string().min(2).max(1000) }).optional(),
});

/** Nombre maximal de références envoyées à l'édition d'image (personnages, décor, plan précédent). */
export const MAX_REFERENCES_IMAGE = 8;

/** Taille d'image selon le format : verticale pour un court ou un générique, horizontale pour un épisode YouTube ou un film. */
export function tailleImage(format: FormatEpisode): TailleImage {
  return estHorizontal(format) ? "1536x1024" : "1024x1536";
}

/** Personnages présents dans un plan (ancien nom gardé pour les autres tâches et les tests). */
export function personnagesPresents(plan: Pick<Plan, "personnage_id" | "texte"> & Partial<Pick<Plan, "personnages">>, personnages: readonly Personnage[]): Personnage[] {
  return personnagesDuPlan(plan, personnages);
}

/**
 * Contrôle qualité d'une image par la vision de ChatGPT (ou de Claude) : bon nombre de personnages, visages conformes
 * aux fiches, décor conforme, pas de texte parasite. Ne bloque jamais : en cas d'erreur, pas de contrôle.
 */
async function controler(
  ctx: Contexte,
  e: EpisodeComplet,
  plan: Plan,
  image: Uint8Array,
  references: readonly ImageReference[],
  presents: readonly Personnage[],
  decor: Element | null,
): Promise<Controle | null> {
  const fournisseur = await fournisseurDisponible(ctx, e.episode.fournisseur_texte);
  if (!fournisseur) return null;
  try {
    const refs = references.slice(0, 4);
    return await demanderTexteIA(ctx, fournisseur, promptControle({ plan, personnages: presents, decor, references: refs.length }), schemaControle, [
      { type: "image/png", donnees: image },
      ...refs.map((r) => ({ type: r.type ?? "image/png", donnees: r.donnees })),
    ]);
  } catch (err) {
    ctx.journal(`contrôle qualité impossible pour le ${nomPlan(e.plans, plan)} : ${erreurCourte(err)}`);
    return null;
  }
}

/** Exécute la tâche storyboard. */
export async function tacheStoryboard(ctx: Contexte): Promise<void> {
  const donnees = schemaDonneesStoryboard.parse(ctx.tache.donnees ?? {});
  if (!ctx.tache.episode_id) throw new Error("Tâche storyboard sans épisode.");
  const e = await chargerEpisode(ctx.db, ctx.tache.episode_id);
  if (e.plans.length === 0) throw new Error("L'épisode n'a pas encore de scénario.");
  const cle = exigerCle(await ctx.cles(), "openai");
  const { tarifs, preferences } = await chargerReglages(ctx.db, await ctx.proprietaire());
  const cibles = donnees.plan_ids?.length ? e.plans.filter((p) => donnees.plan_ids?.includes(p.id)) : e.plans.filter((p) => !unitePrete(e.fichiers, `${p.id}:image`));
  const propositions = donnees.retouche ? 1 : (donnees.propositions ?? preferences.propositions);
  const fichiers = [...e.fichiers];
  const vertical = !estHorizontal(e.episode.format);
  const taille = tailleImage(e.episode.format);
  const total = cibles.length * propositions;

  let fait = 0;
  let echecs = 0;
  for (const plan of cibles) {
    ctx.verifierArret();
    await ctx.verifierBudget();
    const nom = nomPlan(e.plans, plan);
    const presents = personnagesDuPlan(plan, e.personnages);
    const decor = decorDuPlan(plan, e.scenes, e.elements);
    const activite = activiteDuPlan(plan, e.elements);
    const variantes = variantesDuPlan(plan, e.elements);
    const prevues = referencesDuPlan({ personnages: presents, variantes, decor, references: e.references, max: MAX_REFERENCES_IMAGE - 1 });
    const references: ImageReference[] = await lireReferences(ctx.stockage, prevues, ctx.journal);
    const avecFiches = references.some((r) => presents.some((p) => (r as { libelle?: string }).libelle?.startsWith(p.nom)));
    const avecPhotoDecor = !!decor && references.some((r) => (r as { libelle?: string }).libelle?.includes(decor.nom));
    const precedent = e.episode.enchainer ? e.plans[e.plans.findIndex((p) => p.id === plan.id) - 1] : undefined;
    if (precedent && !donnees.retouche) {
      const img = fichierPret(fichiers, `${precedent.id}:image`);
      if (img?.chemin) references.push({ nom: "plan-precedent.png", donnees: await ctx.stockage.lire(img.chemin) });
    }

    // Retouche : on part de l'image actuelle du plan et on ne change que ce qui est demandé.
    let prompt: string;
    let sources: ImageReference[];
    if (donnees.retouche) {
      const actuelle = fichierPret(fichiers, `${plan.id}:image`);
      if (!actuelle?.chemin) throw new Error(`Le ${nom} n'a pas encore d'image à retoucher.`);
      prompt = promptRetouche(donnees.retouche.consigne, vertical);
      sources = [{ nom: "image-actuelle.png", donnees: await ctx.stockage.lire(actuelle.chemin) }];
    } else {
      prompt = promptImage({
        // Un clip peut avoir son propre style visuel, différent de celui de l'espace Clips.
        serie: e.episode.genre === "clip" ? { ...e.serie, style_visuel: styleVisuelClip(e.serie, e.episode) } : e.serie,
        personnagesPresents: presents,
        plan,
        vertical,
        planPrecedent: precedent ? precedent.texte : null,
        avecFiches,
        decor: decor ? { ...decor, avecPhoto: avecPhotoDecor } : null,
        activite,
        variantes,
        consigne: donnees.consigne,
      });
      sources = references;
    }

    for (let k = 0; k < propositions; k++) {
      ctx.verifierArret();
      await ctx.verifierBudget();
      await ctx.progression({ fait, total, etape: `Image du ${nom}${propositions > 1 ? ` · proposition ${k + 1}/${propositions}` : ""} (${fait + 1}/${total})`, echecs });
      const debut = Date.now();
      try {
        const { valeur: png, essais } = await avecRelance(() =>
          sources.length
            ? modifierImage(cle, { modele: ctx.config.modeles.image, prompt, taille, references: sources, qualite: ctx.config.modeles.qualiteImage }, ctx.f)
            : genererImage(cle, { modele: ctx.config.modeles.image, prompt, taille, qualite: ctx.config.modeles.qualiteImage }, ctx.f),
        );
        const chemin = cheminMedia(e.serie.espace_id, e.episode.id, "image", nomUnique(plan.id, "png"));
        await ctx.stockage.envoyer(chemin, png, "image/png");
        const controle = preferences.controle_qualite && !donnees.retouche ? await controler(ctx, e, plan, png, references, presents, decor) : null;
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
          consigne: donnees.retouche ? `Retouche : ${donnees.retouche.consigne}` : prompt,
          fournisseur: "openai",
          controle,
        });
        fichiers.push(f);
        if (controle?.statut === "douteux") ctx.journal(`${nom} douteux : ${controle.raisons.join(" ; ")}`);
      } catch (err) {
        if (err instanceof ErreurArret || err instanceof ErreurAnnulee || err instanceof ErreurPlafond) throw err;
        echecs++;
        ctx.journal(`échec de l'image du ${nom} : ${erreurCourte(err)}`);
        await enregistrerFichier(ctx.db, {
          espace_id: ctx.tache.espace_id,
          episode_id: e.episode.id,
          plan_id: plan.id,
          genre: "image",
          chemin: null,
          statut: "echec",
          erreur: `Image du ${nom} : ${erreurCourte(err)}`,
          essais: 2,
          fournisseur: "openai",
        });
      }
      fait++;
    }
    // Les commentaires du plan ont servi : ils ne seront plus repris à la prochaine génération.
    if (!donnees.retouche && plan.commentaires.some((c) => !c.pris)) {
      await ecrire(ctx.db.from("plans").update({ commentaires: plan.commentaires.map((c) => ({ ...c, pris: true })) }).eq("id", plan.id), "commentaires pris en compte");
    }
  }
  await ctx.progression({ fait, total, etape: echecs ? `${fait - echecs} image(s) prête(s), ${echecs} en échec` : `${fait} image(s) prête(s)`, echecs });
}
