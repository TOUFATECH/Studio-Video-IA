// Montage complet d'une version à partir de fichiers locaux : segments, génériques, concaténation, mixage, sous-titres.
// Indépendant de la base : utilisé par la tâche rendu, par le test complet et par le test d'intégration ffmpeg.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { construireReperes, versSrt, type Langue, type Plan, type Repere } from "@studio-video-ia/core";
import {
  argumentsCarteFin,
  argumentsConcat,
  argumentsFinal,
  argumentsSegment,
  listeConcat,
  VOLUMES,
  type ChansonPlacee,
  type EffetMontage,
  type Orientation,
  type TransitionMontage,
  type VoixPlacee,
} from "./arguments";
import { aLibass, ErreurOutil, executerFfmpeg, MESSAGE_SANS_LIBASS, sonder } from "./executant";

/** Un plan à monter : le plan (pour les sous-titres, l'effet et la transition), son clip local, sa durée et sa voix éventuelle. */
export type PlanAMonter = { plan: Plan; clip: string; duree: number; voix: string | null };

/** Durée du rappel de l'épisode précédent et de la carte de fin (secondes). */
export const DUREE_RAPPEL = 2;
export const DUREE_CARTE_FIN = 3;

/** Paramètres d'un montage. */
export type ParamsMontage = {
  ffmpeg: string;
  ffprobe: string;
  /** Dossier de travail (déjà créé, nettoyé par l'appelant). */
  dossier: string;
  sortie: string;
  orientation: Orientation;
  /** Recadrage au centre en 9:16 (bande annonce). */
  recadrer?: boolean;
  plans: readonly PlanAMonter[];
  /** Opening (avant) et ending (après) déjà rendus, pour un film. */
  avant?: string | null;
  apres?: string | null;
  /** Rappel de l'épisode précédent : un clip dont on garde les 2 premières secondes, placé en tout premier. */
  rappel?: string | null;
  /** Logo de la marque : incrustation (logo) et carte de fin (carteFin, avec la couleur de la marque). */
  logo?: string | null;
  carteFin?: { logo: string; couleur: string | null } | null;
  musique?: string | null;
  bruitage?: string | null;
  /** Sous-titres : langue choisie et langue d'origine (null : aucun). */
  sousTitres?: { choix: Langue; langueOrigine: Langue } | null;
  /** Clip musical : la chanson remplace le son des clips, et les sous-titres sont les paroles déjà placées. */
  chanson?: ChansonPlacee | null;
  reperesParoles?: readonly Repere[] | null;
  police: string;
  surEtape?: (etape: string, fait: number, total: number) => void;
  signal?: AbortSignal;
};

/** Résultat d'un montage. */
export type ResultatMontage = { chemin: string; duree: number; avecSousTitres: boolean };

/** Monte une version complète et renvoie le chemin et la durée du MP4 produit. */
export async function monter(p: ParamsMontage): Promise<ResultatMontage> {
  if (p.plans.length === 0) throw new Error("Aucun plan à monter.");
  const durees = new Map(p.plans.map((x) => [x.plan.id, x.duree]));
  const total = p.plans.length + (p.avant ? 1 : 0) + (p.apres ? 1 : 0) + (p.rappel ? 1 : 0) + (p.carteFin ? 1 : 0) + 2;
  let fait = 0;
  const etape = (texte: string): void => p.surEtape?.(texte, fait, total);

  // Vérifie libass AVANT de travailler : inutile de découper vingt clips pour échouer à la fin.
  const avecVoix = p.plans.some((x) => x.voix);
  let srt: string | null = null;
  let dureeAvant = 0;
  if (p.avant) dureeAvant = (await sonder(p.ffprobe, p.avant, p.signal)).duree;
  // Le rappel passe avant tout : voix et sous-titres sont décalés d'autant.
  const dureeRappel = p.rappel ? DUREE_RAPPEL : 0;
  dureeAvant += dureeRappel;
  if (p.sousTitres || p.reperesParoles?.length) {
    const reperes = p.reperesParoles?.length
      ? p.reperesParoles
      : p.sousTitres
        ? construireReperes({ plans: p.plans.map((x) => x.plan), durees, choix: p.sousTitres.choix, langueOrigine: p.sousTitres.langueOrigine, decalage: dureeAvant })
        : [];
    if (reperes.length > 0) {
      if (!(await aLibass(p.ffmpeg))) throw new ErreurOutil("ffmpeg", MESSAGE_SANS_LIBASS);
      srt = join(p.dossier, "sous-titres.srt");
      await writeFile(srt, versSrt(reperes), "utf8");
    }
  }

  const videos: string[] = [];
  const audios: string[] = [];
  /** Découpe un fichier en segment vidéo + audio aux paramètres communs. */
  const segment = async (nom: string, entree: string, duree: number, volume: number, recadrer: boolean, effet?: EffetMontage, transition?: TransitionMontage): Promise<void> => {
    const infos = await sonder(p.ffprobe, entree, p.signal);
    if (!infos.aVideo) throw new Error(`Le fichier ${nom} n'a pas de piste vidéo.`);
    const sortieVideo = join(p.dossier, `${nom}.mp4`);
    const sortieAudio = join(p.dossier, `${nom}.wav`);
    await executerFfmpeg(p.ffmpeg, argumentsSegment({ entree, sortieVideo, sortieAudio, duree, orientation: p.orientation, aAudio: infos.aAudio, volume, recadrer, effet, transition }), p.signal);
    videos.push(sortieVideo);
    audios.push(sortieAudio);
    fait++;
  };

  if (p.rappel) {
    etape("Rappel de l'épisode précédent");
    await segment("seg-rappel", p.rappel, DUREE_RAPPEL, VOLUMES.clipsAvecVoix, false, "aucun", "coupe");
  }
  if (p.avant) {
    etape("Opening");
    await segment("seg-avant", p.avant, dureeAvant - dureeRappel, 1, false);
  }
  const volumeClips = p.chanson ? VOLUMES.clipsMusicaux : avecVoix ? VOLUMES.clipsAvecVoix : VOLUMES.clipsSansVoix;
  for (const [i, x] of p.plans.entries()) {
    etape(`Découpe du plan ${i + 1}/${p.plans.length}`);
    // Un rappel est suivi d'un flash : la transition d'entrée du premier plan le marque.
    const transition = i === 0 && p.rappel && x.plan.transition === "coupe" ? "flash" : x.plan.transition;
    await segment(`seg-${String(i).padStart(4, "0")}`, x.clip, x.duree, volumeClips, p.recadrer ?? false, x.plan.effet, transition);
  }
  if (p.apres) {
    etape("Ending");
    const dureeApres = (await sonder(p.ffprobe, p.apres, p.signal)).duree;
    await segment("seg-apres", p.apres, dureeApres, 1, false);
  }
  if (p.carteFin) {
    etape("Carte de fin");
    const carte = join(p.dossier, "carte-fin.mp4");
    await executerFfmpeg(p.ffmpeg, argumentsCarteFin({ logo: p.carteFin.logo, couleur: p.carteFin.couleur, orientation: p.orientation, duree: DUREE_CARTE_FIN, sortie: carte }), p.signal);
    await segment("seg-carte", carte, DUREE_CARTE_FIN, 1, false, "aucun", "fondu");
  }

  etape("Assemblage");
  const listeVideo = join(p.dossier, "liste-video.txt");
  const listeAudio = join(p.dossier, "liste-audio.txt");
  await writeFile(listeVideo, listeConcat(videos), "utf8");
  await writeFile(listeAudio, listeConcat(audios), "utf8");
  const video = join(p.dossier, "assemblage.mp4");
  const audio = join(p.dossier, "assemblage.wav");
  await executerFfmpeg(p.ffmpeg, argumentsConcat(listeVideo, video), p.signal);
  await executerFfmpeg(p.ffmpeg, argumentsConcat(listeAudio, audio), p.signal);
  fait++;

  // Les voix démarrent au début de leur plan, en tenant compte de l'opening éventuel.
  const voix: VoixPlacee[] = [];
  let t = dureeAvant;
  for (const x of p.plans) {
    if (x.voix) voix.push({ chemin: x.voix, debut: t + 0.15, duree: Math.max(0.5, x.duree - 0.15) });
    t += x.duree;
  }
  const dureeTotale = (await sonder(p.ffprobe, audio, p.signal)).duree;

  etape(srt ? "Mixage et sous-titres" : "Mixage");
  await executerFfmpeg(
    p.ffmpeg,
    argumentsFinal({
      video,
      audio,
      voix,
      musique: p.musique ?? null,
      bruitage: p.bruitage ?? null,
      sousTitres: srt,
      police: p.police,
      orientation: p.orientation,
      dureeTotale,
      sortie: p.sortie,
      chanson: p.chanson ?? null,
      logo: p.logo ?? null,
    }),
    p.signal,
  );
  fait++;
  const infos = await sonder(p.ffprobe, p.sortie, p.signal);
  etape("Terminé");
  return { chemin: p.sortie, duree: infos.duree, avecSousTitres: srt !== null };
}
