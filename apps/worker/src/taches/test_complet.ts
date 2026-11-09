// Tâche « test_complet » : vérification de bout en bout peu coûteuse, sans publier.
// 1 image (OpenAI, qualité basse) → 1 clip de 2 s en 480p (xAI) → 1 voix courte (ElevenLabs) → rendu ffmpeg sous-titré.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { schemaLangue, type Langue, type Plan } from "@feuilleton/core";
import { genererImage, genererVideo, listerVoix, synthetiserVoix } from "@feuilleton/integrations";
import { z } from "zod";
import { exigerCle } from "../cles";
import type { Contexte } from "../contexte";
import { chargerReglages, enregistrerFichier, erreurCourte } from "../donnees";
import { monter } from "../rendu/montage";
import { cheminEspace, nomUnique } from "../stockage";

/** Données acceptées : langue des sous-titres du rendu de test. */
export const schemaDonneesTest = z.object({ sous_titres: schemaLangue.default("fr") });

/** Phrase de test dite et sous-titrée dans chaque langue. */
export const PHRASES_TEST: Record<Langue, string> = {
  fr: "Ceci est un test de Feuilleton.",
  en: "This is a Feuilleton test.",
  ja: "これはフィユトンのテストです。",
  ko: "이것은 푀유통 테스트입니다.",
  pt: "Isto é um teste do Feuilleton.",
};

/** Résultat d'une étape du test. */
export type EtapeTest = { nom: string; ok: boolean; secondes: number; message: string };

/** Exécute la tâche test_complet. N'échoue pas : le résultat détaillé est dans la progression. */
export async function tacheTestComplet(ctx: Contexte): Promise<void> {
  const { sous_titres: langue } = schemaDonneesTest.parse(ctx.tache.donnees ?? {});
  const { tarifs } = await chargerReglages(ctx.db, await ctx.proprietaire());
  const cles = await ctx.cles();
  const espace = ctx.tache.espace_id;
  const dossier = await ctx.dossier();
  const etapes: EtapeTest[] = [];
  const total = 4;

  /** Lance une étape, mesure son temps et enregistre son résultat sans interrompre le test. */
  const etape = async <T>(nom: string, fn: () => Promise<{ valeur: T; message: string }>): Promise<T | null> => {
    await ctx.progression({ fait: etapes.length, total, etape: `${nom}…`, etapes });
    const debut = Date.now();
    try {
      const r = await fn();
      etapes.push({ nom, ok: true, secondes: Math.round((Date.now() - debut) / 100) / 10, message: r.message });
      return r.valeur;
    } catch (e) {
      etapes.push({ nom, ok: false, secondes: Math.round((Date.now() - debut) / 100) / 10, message: erreurCourte(e) });
      return null;
    }
  };
  const sauter = (nom: string, raison: string): void => {
    etapes.push({ nom, ok: false, secondes: 0, message: `Non lancé : ${raison}` });
  };

  const image = await etape("Image (OpenAI)", async () => {
    const png = await genererImage(exigerCle(cles, "openai"), { modele: ctx.config.modeles.image, prompt: "Un petit renard roux assis dans une clairière au lever du soleil, illustration simple, cadrage vertical.", taille: "1024x1536", qualite: "low" }, ctx.f);
    const chemin = cheminEspace(espace, "test", nomUnique("image", "png"));
    await ctx.stockage.envoyer(chemin, png, "image/png");
    await enregistrerFichier(ctx.db, { espace_id: espace, episode_id: null, genre: "image", chemin, cout: tarifs.image });
    return { valeur: chemin, message: `${Math.round(png.length / 1024)} Ko` };
  });

  const clip = image
    ? await etape("Clip 2 s en 480p (xAI)", async () => {
        const r = await genererVideo(
          exigerCle(cles, "xai"),
          { modele: ctx.config.modeles.video, prompt: "Le renard tourne lentement la tête vers la caméra.", duree: 2, ratio: "9:16", resolution: "480p", genererAudio: false, urlImage: await ctx.stockage.urlSignee(image) },
          { signal: ctx.signal, surAttente: (s) => void ctx.progression({ fait: etapes.length, total, etape: `Clip 2 s en 480p (xAI) : génération (${s} s)`, etapes }).catch(() => undefined) },
          ctx.f,
        );
        const chemin = cheminEspace(espace, "test", nomUnique("clip", "mp4"));
        await ctx.stockage.envoyer(chemin, r.video, "video/mp4");
        await enregistrerFichier(ctx.db, { espace_id: espace, episode_id: null, genre: "clip", chemin, duree_s: 2, cout: 2 * tarifs.video_seconde });
        const local = join(dossier, "clip.mp4");
        await writeFile(local, r.video);
        return { valeur: local, message: `${Math.round(r.video.length / 1024)} Ko` };
      })
    : (sauter("Clip 2 s en 480p (xAI)", "l'image a échoué"), null);

  const voix = await etape("Voix (ElevenLabs)", async () => {
    const cle = exigerCle(cles, "elevenlabs");
    const liste = await listerVoix(cle, ctx.f);
    const choisie = liste.find((v) => v.categorie === "premade") ?? liste[0];
    if (!choisie) throw new Error("aucune voix disponible sur ce compte ElevenLabs");
    const mp3 = await synthetiserVoix(cle, { voixId: choisie.id, texte: PHRASES_TEST[langue], modele: ctx.config.modeles.voix }, ctx.f);
    const chemin = cheminEspace(espace, "test", nomUnique(`voix-${langue}`, "mp3"));
    await ctx.stockage.envoyer(chemin, mp3, "audio/mpeg");
    await enregistrerFichier(ctx.db, { espace_id: espace, episode_id: null, genre: "voix", langue, chemin, cout: (Math.max(40, PHRASES_TEST[langue].length) / 1000) * tarifs.voix_1000_car });
    const local = join(dossier, "voix.mp3");
    await writeFile(local, mp3);
    return { valeur: local, message: `voix « ${choisie.nom} »` };
  });

  // Chemin du rendu de test, transmis à la page Diagnostic pour qu'elle puisse le lire.
  let cheminRendu: string | null = null;
  if (clip) {
    await etape(`Rendu ffmpeg sous-titré (${langue})`, async () => {
      const plan: Plan = { id: "test", episode_id: "test", position: 0, section: "principal", type: "dialogue", texte: "", personnage_id: "test", replique: PHRASES_TEST[langue], repliques_traduites: {}, duree_fixee: null, valide: true, modifie: false, prise_choisie: "A" };
      const r = await monter({
        ffmpeg: ctx.config.ffmpeg,
        ffprobe: ctx.config.ffprobe,
        dossier,
        sortie: join(dossier, "rendu.mp4"),
        orientation: "vertical",
        plans: [{ plan, clip, duree: 3, voix }],
        sousTitres: { choix: langue, langueOrigine: langue },
        police: ctx.config.police,
        signal: ctx.signal,
      });
      const chemin = cheminEspace(espace, "test", nomUnique(`rendu-${langue}`, "mp4"));
      cheminRendu = chemin;
      await ctx.stockage.envoyerFichier(chemin, r.chemin, "video/mp4");
      await enregistrerFichier(ctx.db, { espace_id: espace, episode_id: null, genre: "rendu", langue, chemin, duree_s: Math.round(r.duree * 100) / 100 });
      return { valeur: chemin, message: `${r.duree.toFixed(1)} s, 1080x1920${r.avecSousTitres ? ", sous-titres incrustés" : ""}` };
    });
  } else sauter(`Rendu ffmpeg sous-titré (${langue})`, "pas de clip");

  const ok = etapes.every((x) => x.ok);
  await ctx.progression({ fait: total, total, etape: ok ? "Test complet réussi" : `Test terminé : ${etapes.filter((x) => !x.ok).length} étape(s) en échec`, ok, etapes, langue, rendu: cheminRendu });
}
