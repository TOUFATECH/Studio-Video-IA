// Tâche « clips » : traductions manquantes, puis un clip Grok par plan (deux si 2 prises) et une voix ElevenLabs
// par réplique et par langue. Une relance automatique par unité, puis échec lisible ; le coût de chaque fichier est enregistré.
import { coutUnite, dureesParPlan, languesATraduire, LANGUES, promptTraduction, promptVideo, repliqueEn, unitesClips, type Episode, type Langue, type Personnage, type Plan, type Unite, estHorizontal } from "@studio-video-ia/core";
import { demanderJson, genererVideo, synthetiserVoix, type RatioVideo } from "@studio-video-ia/integrations";
import { z } from "zod";
import { exigerCle } from "../cles";
import { avecRelance, enParallele, ErreurAnnulee, ErreurArret, ErreurPlafond, type Contexte } from "../contexte";
import { chargerEpisode, chargerReglages, enregistrerFichier, erreurCourte, fichierPret, nomPlan, unitePrete, type EpisodeComplet } from "../donnees";
import { cheminMedia, nomUnique } from "../stockage";
import { ecrire } from "../supabase";

/** Données acceptées : plans à régénérer (toutes leurs unités), sinon toutes les unités sans fichier prêt. */
export const schemaDonneesClips = z.object({ plan_ids: z.array(z.string()).optional() });

/** Réponse attendue de l'IA pour les traductions. */
export const schemaTraductionIA = z.object({
  titre: z.record(z.string()).default({}),
  repliques: z.record(z.record(z.string())).default({}),
});

/** Ratio des clips : 16:9 pour un épisode YouTube ou un film, 9:16 pour un court ou un générique. */
export function ratioClips(format: Episode["format"]): RatioVideo {
  return estHorizontal(format) ? "16:9" : "9:16";
}

/** Vrai si l'audio du clip doit être généré par Grok : dialogue d'un personnage dont la voix est « grok ». */
export function audioGrok(plan: Plan, personnages: readonly Personnage[]): boolean {
  if (plan.type !== "dialogue" || !plan.personnage_id || !plan.replique.trim()) return false;
  return personnages.find((p) => p.id === plan.personnage_id)?.source_voix === "grok";
}

/** Langues dont il manque une traduction (d'une réplique ou du titre). */
export function traductionsManquantes(episode: Episode, plans: readonly Plan[]): Langue[] {
  return languesATraduire(episode.langue, episode.langues, episode.sous_titres).filter(
    (l) => !episode.titres_traduits[l] || plans.some((p) => p.replique.trim() && !p.repliques_traduites[l]?.trim()),
  );
}

/** Traduit les répliques et le titre dans les langues manquantes, et met à jour les objets en mémoire. */
async function traduire(ctx: Contexte, e: EpisodeComplet): Promise<void> {
  const vers = traductionsManquantes(e.episode, e.plans);
  if (vers.length === 0) return;
  await ctx.progression({ fait: 0, total: 1, etape: `Traduction (${vers.join(", ")})` });
  const cle = exigerCle(await ctx.cles(), "openai");
  const repliques = e.plans.filter((p) => p.replique.trim()).map((p) => ({ id: p.id, texte: p.replique }));
  const r = await demanderJson(cle, ctx.config.modeles.texte, promptTraduction({ titre: e.episode.titre, repliques, de: e.episode.langue, vers }), schemaTraductionIA, ctx.f);
  const garder = (o: Record<string, string> | undefined): Partial<Record<Langue, string>> => {
    const out: Partial<Record<Langue, string>> = {};
    for (const l of LANGUES) if (vers.includes(l) && o?.[l]?.trim()) out[l] = o[l]?.trim();
    return out;
  };
  for (const p of e.plans) {
    const t = garder(r.repliques[p.id]);
    if (Object.keys(t).length === 0) continue;
    p.repliques_traduites = { ...p.repliques_traduites, ...t };
    await ecrire(ctx.db.from("plans").update({ repliques_traduites: p.repliques_traduites }).eq("id", p.id), "traductions des répliques");
  }
  e.episode.titres_traduits = { ...e.episode.titres_traduits, ...garder(r.titre) };
  await ecrire(ctx.db.from("episodes").update({ titres_traduits: e.episode.titres_traduits }).eq("id", e.episode.id), "titres traduits");
}

/** Exécute la tâche clips. */
export async function tacheClips(ctx: Contexte): Promise<void> {
  const donnees = schemaDonneesClips.parse(ctx.tache.donnees ?? {});
  if (!ctx.tache.episode_id) throw new Error("Tâche clips sans épisode.");
  const e = await chargerEpisode(ctx.db, ctx.tache.episode_id);
  const valides = e.plans.filter((p) => p.valide).length;
  if (e.plans.length === 0 || valides < e.plans.length) {
    throw new Error(`Tous les plans doivent être validés avant de lancer les clips (${valides}/${e.plans.length} validés).`);
  }
  const { tarifs, preferences } = await chargerReglages(ctx.db, await ctx.proprietaire());
  await traduire(ctx, e);

  const durees = dureesParPlan(e.plans, e.episode.duree_cible, e.episode.format);
  const toutes = unitesClips(e.episode, e.plans, e.personnages);
  const unites = donnees.plan_ids?.length ? toutes.filter((u) => u.plan && donnees.plan_ids?.includes(u.plan.id)) : toutes.filter((u) => !unitePrete(e.fichiers, u.cle));
  const besoinXai = unites.some((u) => u.genre === "clip");
  const besoinVoix = unites.some((u) => u.genre === "voix");
  const cles = await ctx.cles();
  const cleXai = besoinXai ? exigerCle(cles, "xai") : "";
  const cleVoix = besoinVoix ? exigerCle(cles, "elevenlabs") : "";

  let fait = 0;
  let echecs = 0;
  const etape = async (texte: string): Promise<void> => ctx.progression({ fait, total: unites.length, etape: texte, echecs });
  await etape(unites.length ? `${unites.length} unité(s) à générer` : "Rien à générer");

  /** Produit une unité (clip ou voix) avec une relance, puis enregistre le fichier ou l'échec. */
  const produire = async (u: Unite): Promise<void> => {
    ctx.verifierArret();
    await ctx.verifierBudget();
    const plan = u.plan;
    if (!plan) return;
    const nom = nomPlan(e.plans, plan);
    const duree = durees.get(plan.id) ?? 5;
    const debut = Date.now();
    try {
      if (u.genre === "clip") {
        await etape(`Clip ${u.prise ?? "A"} du ${nom}`);
        const image = fichierPret(e.fichiers, `${plan.id}:image`);
        if (!image?.chemin) throw new Error("image du plan absente : relance le storyboard");
        const grok = audioGrok(plan, e.personnages);
        const perso = e.personnages.find((p) => p.id === plan.personnage_id);
        // Avec une voix Grok, la réplique doit figurer dans le prompt pour que le clip la prononce.
        const prompt = `${promptVideo(plan, duree, grok)}${grok && perso ? ` ${perso.nom} dit : « ${plan.replique} »` : ""}`;
        const { valeur, essais } = await avecRelance(async () => {
          // URL signée recréée à chaque essai : xAI télécharge l'image pendant la génération.
          const urlImage = await ctx.stockage.urlSignee(image.chemin ?? "");
          return genererVideo(
            cleXai,
            { modele: ctx.config.modeles.video, prompt, duree, ratio: ratioClips(e.episode.format), resolution: ctx.config.modeles.resolutionVideo, genererAudio: grok, urlImage },
            { signal: ctx.signal, surAttente: (s) => void etape(`Clip ${u.prise ?? "A"} du ${nom} : génération (${s} s)`).catch(() => undefined) },
            ctx.f,
          );
        });
        const chemin = cheminMedia(e.serie.espace_id, e.episode.id, "clip", nomUnique(`${plan.id}-${u.prise ?? "A"}`, "mp4"));
        await ctx.stockage.envoyer(chemin, valeur.video, "video/mp4");
        await enregistrerFichier(ctx.db, {
          espace_id: e.serie.espace_id,
          episode_id: e.episode.id,
          plan_id: plan.id,
          genre: "clip",
          prise: u.prise,
          chemin,
          duree_s: valeur.duree ?? duree,
          secondes_generation: Math.round((Date.now() - debut) / 100) / 10,
          cout: coutUnite(u, duree, tarifs) * essais,
          essais,
        });
      } else if (u.genre === "voix" && u.langue) {
        await etape(`Voix ${u.langue} du ${nom}`);
        const perso = e.personnages.find((p) => p.id === plan.personnage_id);
        if (!perso?.voix_id) throw new Error(`aucune voix choisie pour ${perso?.nom ?? "le personnage"}`);
        const texte = repliqueEn(plan, u.langue, e.episode.langue);
        if (!texte) throw new Error(`réplique non traduite en ${u.langue}`);
        const { valeur: mp3, essais } = await avecRelance(() => synthetiserVoix(cleVoix, { voixId: perso.voix_id, texte, modele: ctx.config.modeles.voix }, ctx.f));
        const chemin = cheminMedia(e.serie.espace_id, e.episode.id, "voix", nomUnique(`${plan.id}-${u.langue}`, "mp3"));
        await ctx.stockage.envoyer(chemin, mp3, "audio/mpeg");
        await enregistrerFichier(ctx.db, {
          espace_id: e.serie.espace_id,
          episode_id: e.episode.id,
          plan_id: plan.id,
          genre: "voix",
          langue: u.langue,
          chemin,
          secondes_generation: Math.round((Date.now() - debut) / 100) / 10,
          cout: coutUnite({ ...u, plan: { ...plan, replique: texte } }, 0, tarifs) * essais,
          essais,
        });
      }
    } catch (err) {
      if (err instanceof ErreurArret || err instanceof ErreurAnnulee || err instanceof ErreurPlafond) throw err;
      echecs++;
      const quoi = u.genre === "clip" ? `Clip ${u.prise ?? "A"} du ${nom}` : `Voix ${u.langue ?? ""} du ${nom}`;
      ctx.journal(`échec : ${quoi} : ${erreurCourte(err)}`);
      await enregistrerFichier(ctx.db, {
        espace_id: e.serie.espace_id,
        episode_id: e.episode.id,
        plan_id: plan.id,
        genre: u.genre === "clip" ? "clip" : "voix",
        prise: u.prise,
        langue: u.langue,
        chemin: null,
        statut: "echec",
        erreur: `${quoi} : ${erreurCourte(err)}`,
        essais: 2,
      });
    }
    fait++;
    await etape(`${fait}/${unites.length} unité(s) traitée(s)`);
  };

  // Les clips Grok prennent plusieurs minutes : on en lance plusieurs à la fois (préférence « parallèle »).
  await enParallele(unites, preferences.parallele, produire);
  await etape(echecs ? `${fait - echecs} unité(s) prête(s), ${echecs} en échec` : `${fait} unité(s) prête(s)`);
}
