// Tâches du son d'un clip musical :
// « paroles » écrit des paroles avec ChatGPT ou Claude, « musique » compose la chanson avec ElevenLabs Music,
// « synchro » place les paroles dans la chanson (alignement forcé) ou les transcrit quand elles manquent.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  analyserParoles,
  DUREE_MAX_CLIP,
  dureeComposition,
  extraitParDefaut,
  lignesDepuisTranscription,
  planComposition,
  promptParoles,
  regrouperEnLignes,
  schemaParolesIA,
  type Fichier,
  type LigneParole,
} from "@studio-video-ia/core";
import { alignerParoles, composerMusique, ErreurApi, transcrireAudio, transcrireXai } from "@studio-video-ia/integrations";
import { z } from "zod";
import { exigerCle } from "../cles";
import type { Contexte } from "../contexte";
import { chansonDuClip, chargerEpisode, chargerReglages, enregistrerFichier, supprimerFichiers, type EpisodeComplet } from "../donnees";
import { demanderTexteIA } from "../ia";
import { sonder } from "../rendu/executant";
import { cheminMedia, nomUnique, typeMime } from "../stockage";
import { ecrire } from "../bdd";

/** Durée proposée par défaut pour une chanson générée, selon le format du clip. */
export function dureeChansonParDefaut(format: EpisodeComplet["episode"]["format"]): number {
  return format === "court" ? 90 : Math.min(DUREE_MAX_CLIP[format], 180);
}

/** Données de la tâche « paroles » : durée visée (secondes). */
export const schemaDonneesParoles = z.object({ duree: z.number().min(15).max(600).optional() });
/** Données de la tâche « musique » : durée voulue et enchaînement de la synchronisation. */
export const schemaDonneesMusique = z.object({ duree: z.number().min(10).max(600).optional(), synchroniser: z.boolean().default(true) });

/** Charge l'épisode et vérifie que c'est bien un clip. */
async function chargerClip(ctx: Contexte): Promise<EpisodeComplet> {
  if (!ctx.tache.episode_id) throw new Error("Tâche sans clip.");
  const e = await chargerEpisode(ctx.db, ctx.tache.episode_id);
  if (e.episode.genre !== "clip") throw new Error("Cette tâche ne concerne que les clips musicaux.");
  return e;
}

/** Tâche « paroles » : l'IA écrit des paroles à partir de l'idée, du style et de la langue du clip. */
export async function tacheParoles(ctx: Contexte): Promise<void> {
  const donnees = schemaDonneesParoles.parse(ctx.tache.donnees ?? {});
  const e = await chargerClip(ctx);
  await ctx.progression({ fait: 0, total: 1, etape: "Écriture des paroles" });
  const r = await demanderTexteIA(
    ctx,
    e.episode.fournisseur_texte,
    promptParoles({ idee: e.episode.idee, style: e.episode.musique_style, langue: e.episode.langue, dureeCible: donnees.duree ?? dureeChansonParDefaut(e.episode.format), titre: e.episode.titre }),
    schemaParolesIA,
  );
  const maj: Record<string, unknown> = { paroles: r.paroles.slice(0, 20000), paroles_alignees: null, paroles_traduites: {} };
  if (!e.episode.titre.trim()) maj.titre = r.titre.slice(0, 200);
  await ecrire(ctx.db.from("episodes").update(maj).eq("id", e.episode.id), "paroles");
  await ctx.progression({ fait: 1, total: 1, etape: `${analyserParoles(r.paroles).lignes.length} lignes écrites` });
}

/** Message plus clair quand ElevenLabs refuse un style (nom d'artiste, paroles existantes). */
function messageMusique(err: unknown): Error {
  if (err instanceof ErreurApi && err.statut >= 400 && err.statut < 500 && /prompt|artist|copyright|lyrics/i.test(err.message)) {
    return new Error(`${err.message} — retire les noms d'artistes ou de chansons existantes du style et des paroles, puis relance.`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Tâche « musique » : compose la chanson du clip (paroles chantées, ou instrumentale) et la garde comme chanson du clip. */
export async function tacheMusique(ctx: Contexte): Promise<void> {
  const donnees = schemaDonneesMusique.parse(ctx.tache.donnees ?? {});
  const e = await chargerClip(ctx);
  const chante = !e.episode.instrumental && analyserParoles(e.episode.paroles).lignes.length > 0;
  if (!e.episode.instrumental && !chante) throw new Error("Pas de paroles : écris-les (ou demande-les à l'IA), ou coche « Instrumental ».");
  const cle = exigerCle(await ctx.cles(), "elevenlabs");
  const { tarifs } = await chargerReglages(ctx.db, await ctx.proprietaire());
  const plan = planComposition({ paroles: e.episode.paroles, style: e.episode.musique_style, dureeCible: donnees.duree ?? dureeChansonParDefaut(e.episode.format), instrumental: e.episode.instrumental });
  await ctx.verifierBudget();
  await ctx.progression({ fait: 0, total: 2, etape: `Composition de la musique (${Math.round(dureeComposition(plan))} s, ${plan.sections.length} sections)` });
  const debut = Date.now();
  let mp3: Buffer;
  try {
    mp3 = await composerMusique(cle, { plan, modele: ctx.config.modeles.musique }, ctx.f);
  } catch (err) {
    throw messageMusique(err);
  }
  ctx.verifierArret();
  await ctx.progression({ fait: 1, total: 2, etape: "Enregistrement de la chanson" });
  const local = join(await ctx.dossier(), "chanson.mp3");
  await writeFile(local, mp3);
  const duree = (await sonder(ctx.config.ffprobe, local, ctx.signal)).duree;
  const anciennes = e.fichiers.filter((f) => f.genre === "chanson");
  const chemin = cheminMedia(e.serie.espace_id, e.episode.id, "chanson", nomUnique("chanson", "mp3"));
  await ctx.stockage.envoyer(chemin, mp3, "audio/mpeg");
  await enregistrerFichier(ctx.db, {
    espace_id: e.serie.espace_id,
    episode_id: e.episode.id,
    genre: "chanson",
    chemin,
    duree_s: Math.round(duree * 100) / 100,
    secondes_generation: Math.round((Date.now() - debut) / 100) / 10,
    cout: (duree / 60) * tarifs.musique_minute,
  });
  // L'ancienne chanson est remplacée (sa dépense reste dans le journal) ; l'alignement est à refaire.
  await supprimerFichiers(ctx.db, ctx.stockage, anciennes);
  await ecrire(ctx.db.from("episodes").update({ paroles_alignees: null, extrait_debut: 0, extrait_fin: null }).eq("id", e.episode.id), "chanson du clip");
  if (donnees.synchroniser) {
    // Une synchronisation déjà en file (double clic) suffit : le doublon refusé par la base n'est pas une erreur.
    const { error } = await ctx.db.from("taches").insert({ espace_id: e.serie.espace_id, episode_id: e.episode.id, type: "synchro", donnees: {} });
    if (error && error.code !== "23505") ctx.journal(`synchronisation non lancée : ${error.message}`);
  }
  await ctx.progression({ fait: 2, total: 2, etape: `Chanson prête (${Math.round(duree)} s)` });
}

/** Tâche « synchro » : place chaque ligne de paroles dans la chanson, ou transcrit la chanson si les paroles manquent. */
export async function tacheSynchro(ctx: Contexte): Promise<void> {
  const e = await chargerClip(ctx);
  const f: Fichier | null = chansonDuClip(e.fichiers);
  if (!f?.chemin) throw new Error("Pas de chanson : importe-la ou génère-la d'abord.");
  const local = await ctx.stockage.telechargerVers(f.chemin, join(await ctx.dossier(), `chanson.${f.chemin.split(".").pop() ?? "mp3"}`));
  const dureeChanson = f.duree_s ? Number(f.duree_s) : (await sonder(ctx.config.ffprobe, local, ctx.signal)).duree;
  // Une chanson importée n'a pas encore de durée : on l'enregistre (elle sert à l'extrait et à l'affichage).
  if (!f.duree_s) await ecrire(ctx.db.from("fichiers").update({ duree_s: Math.round(dureeChanson * 100) / 100 }).eq("id", f.id), "durée de la chanson");
  const audio = { nom: f.chemin.split("/").pop() ?? "chanson.mp3", donnees: await readFile(local), type: typeMime(f.chemin) };
  const { lignes: texteLignes } = analyserParoles(e.episode.paroles);

  let alignees: LigneParole[];
  const maj: Record<string, unknown> = {};
  const cles = await ctx.cles();
  if (e.episode.instrumental) {
    alignees = [];
    await ctx.progression({ fait: 1, total: 1, etape: "Musique instrumentale : rien à synchroniser" });
  } else if (cles.xai) {
    // Grok Speech to Text : chaque mot chanté avec son minutage ; les lignes saisies sont posées dessus.
    await ctx.progression({ fait: 0, total: 1, etape: texteLignes.length ? `Placement de ${texteLignes.length} lignes dans la chanson (Grok)` : "Pas de paroles saisies : transcription de la chanson (Grok)" });
    const r = await transcrireXai(cles.xai, { audio: audio.donnees, nom: audio.nom, type: audio.type, langue: e.episode.langue, modele: ctx.config.modeles.transcriptionXai }, ctx.f);
    const mots = r.mots.map((m) => ({ text: m.texte, start: m.debut, end: m.fin }));
    alignees = texteLignes.length ? regrouperEnLignes(texteLignes, mots) : lignesDepuisTranscription(mots, e.episode.langue);
    if (alignees.length === 0) throw new Error("Aucune parole reconnue dans la chanson. Si elle est instrumentale, coche « Instrumental ».");
    if (!texteLignes.length) maj.paroles = alignees.map((l) => l.texte).join("\n");
  } else if (texteLignes.length > 0) {
    await ctx.progression({ fait: 0, total: 1, etape: `Placement de ${texteLignes.length} lignes dans la chanson` });
    const r = await alignerParoles(exigerCle(cles, "elevenlabs"), { audio, texte: texteLignes.join("\n") }, ctx.f);
    alignees = regrouperEnLignes(texteLignes, r.words, r.characters);
  } else {
    await ctx.progression({ fait: 0, total: 1, etape: "Pas de paroles saisies : transcription de la chanson" });
    const r = await transcrireAudio(exigerCle(cles, "elevenlabs"), { audio, langue: e.episode.langue, modele: ctx.config.modeles.transcription }, ctx.f);
    alignees = lignesDepuisTranscription(r.mots, e.episode.langue);
    if (alignees.length === 0) throw new Error("Aucune parole reconnue dans la chanson. Si elle est instrumentale, coche « Instrumental ».");
    maj.paroles = alignees.map((l) => l.texte).join("\n");
  }
  // Les lignes au-delà de la fin de la chanson (alignement approximatif) sont ramenées dans la chanson.
  alignees = alignees.filter((l) => l.debut < dureeChanson).map((l) => ({ ...l, fin: Math.min(l.fin, dureeChanson) }));
  maj.paroles_alignees = alignees;
  maj.paroles_traduites = {};
  // Premier passage : on propose l'extrait (vertical : à partir du chant, 2:00 max).
  if (e.episode.extrait_fin === null && Number(e.episode.extrait_debut) === 0) {
    const ex = extraitParDefaut(alignees, dureeChanson, e.episode.format);
    maj.extrait_debut = ex.debut;
    maj.extrait_fin = ex.fin;
  }
  await ecrire(ctx.db.from("episodes").update(maj).eq("id", e.episode.id), "paroles synchronisées");
  await ctx.progression({ fait: 1, total: 1, etape: `${alignees.length} ligne(s) placée(s) dans la chanson` });
}
