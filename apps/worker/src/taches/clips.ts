// Tâche « clips » : traductions manquantes, puis un clip Grok Imagine Video par plan (deux si 2 prises).
// Grok part de l'image validée du plan, garde les visages et le décor grâce aux références (fiches, photo du vrai lieu),
// fait parler les personnages avec leur voix préréglée (lèvres synchronisées) et génère le son.
// Les voix ElevenLabs restent possibles pour un personnage qui en a une. Une relance automatique par unité, puis échec lisible.
import {
  coutUnite,
  dureeGenerationClip,
  dureesParPlan,
  estHorizontal,
  languesATraduire,
  LANGUES,
  promptTraduction,
  promptVideoGrok,
  VOIX_GROK_DEFAUT,
  repliqueEn,
  unitesClips,
  type Episode,
  type Langue,
  type Personnage,
  type Plan,
  type Unite,
} from "@studio-video-ia/core";
import { demanderJson, genererVideo, synthetiserVoix, type RatioVideo } from "@studio-video-ia/integrations";
import { z } from "zod";
import { exigerCle } from "../cles";
import { avecRelance, enParallele, ErreurAnnulee, ErreurArret, ErreurPlafond, type Contexte } from "../contexte";
import { chargerEpisode, chargerReglages, enregistrerFichier, erreurCourte, fichierPret, nomPlan, unitePrete, type EpisodeComplet } from "../donnees";
import { cheminMedia, nomUnique } from "../stockage";
import { ecrire, lignes } from "../bdd";
import { activiteDuPlan, decorDuPlan, personnagesDuPlan, referencesDuPlan, variantesDuPlan } from "../bibliotheque";

/** Nombre maximal de références envoyées à Grok avec un clip (la requête reste légère). */
export const MAX_REFERENCES_VIDEO = 6;

/** Voix Grok d'un personnage : sa voix préréglée, sinon la voix par défaut. */
export function voixGrokDe(p: Pick<Personnage, "voix_id">): string {
  const v = p.voix_id.trim().toLowerCase();
  return /^[a-z]{2,20}$/.test(v) ? v : VOIX_GROK_DEFAUT;
}

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
  // Un clip musical n'a pas de répliques : ses paroles sont traduites au découpage.
  const clipMusical = e.episode.genre === "clip";
  if (!clipMusical) await traduire(ctx, e);

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
        const grok = !clipMusical && audioGrok(plan, e.personnages);
        const perso = e.personnages.find((p) => p.id === plan.personnage_id);
        // Grok génère la seconde entière juste au-dessus de la durée du plan ; le clip est recoupé au montage.
        const dureeGrok = dureeGenerationClip(duree);
        // Mêmes références que pour l'image : fiche ou photo de chaque personnage, photo du vrai décor.
        const prevues = referencesDuPlan({
          personnages: personnagesDuPlan(plan, e.personnages),
          variantes: variantesDuPlan(plan, e.elements),
          decor: decorDuPlan(plan, e.scenes, e.elements),
          references: e.references,
          max: MAX_REFERENCES_VIDEO,
        });
        // Le personnage qui parle avec une voix Grok a sa voix préréglée, lèvres synchronisées.
        const voix = grok && perso ? [voixGrokDe(perso)] : [];
        const prompt = promptVideoGrok({
          plan,
          duree: dureeGrok,
          references: prevues.map((r) => ({ libelle: r.libelle })),
          parle: grok && perso ? { nom: perso.nom, voix: 0 } : null,
          activite: activiteDuPlan(plan, e.elements),
          // Clip musical : seule la chanson s'entend.
          muet: clipMusical,
        });
        const { valeur, essais } = await avecRelance(async () => {
          // Adresses recréées à chaque essai : signées (site public) ou data URI (site local).
          const urlImage = await ctx.stockage.urlPourIA(image.chemin ?? "");
          const references = await Promise.all(prevues.map((r) => ctx.stockage.urlPourIA(r.chemin)));
          return genererVideo(
            cleXai,
            {
              modele: ctx.config.modeles.video,
              prompt,
              duree: dureeGrok,
              ratio: ratioClips(e.episode.format),
              resolution: ctx.config.modeles.resolutionVideo,
              // Grok fait aussi les paroles et le son du plan ; un clip musical reste muet.
              genererAudio: !clipMusical,
              urlImage,
              references,
              voix,
            },
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
          duree_s: valeur.duree ?? dureeGrok,
          secondes_generation: Math.round((Date.now() - debut) / 100) / 10,
          cout: coutUnite(u, duree, tarifs) * essais,
          essais,
          consigne: prompt,
          fournisseur: "xai",
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
  if (!echecs && unites.length) await remonterSiDejaMonte(ctx, e);
}

/**
 * Remontage automatique : si l'épisode avait déjà été monté, la vidéo finale est refaite dès que les plans changés
 * ont leurs nouveaux clips, sans refaire le reste.
 */
export async function remonterSiDejaMonte(ctx: Contexte, e: EpisodeComplet): Promise<void> {
  // Les rendus sont effacés dès qu'un plan change : les miniatures (créées au premier rendu) prouvent qu'il a été monté.
  const dejaMonte = e.fichiers.some((f) => f.genre === "rendu") || !!e.episode.miniature?.chemins.length || e.episode.video_validee;
  if (!dejaMonte) return;
  const apres = await chargerEpisode(ctx.db, e.episode.id);
  const manque = unitesClips(apres.episode, apres.plans, apres.personnages).some((u) => !unitePrete(apres.fichiers, u.cle));
  if (manque) return;
  const actives = await lignes<{ id: string }>(ctx.db.from("taches").select("id").eq("episode_id", e.episode.id).eq("type", "rendu").in("statut", ["en_file", "en_cours", "en_pause"]), "rendu en file");
  if (actives.length) return;
  await ecrire(ctx.db.from("taches").insert({ espace_id: e.serie.espace_id, episode_id: e.episode.id, type: "rendu", donnees: {} }), "remontage automatique");
  ctx.journal("plans changés : remontage automatique en file");
}
