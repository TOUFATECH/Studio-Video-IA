// Tâche « rendu » : une version par langue (et la bande annonce d'un film), avec génériques, voix, musique,
// bruitage et sous-titres ; puis passage des publications en attente à « programmée » et mémoire automatique.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  dureesParPlan,
  indexerFichiers,
  planParleElevenLabs,
  promptBruitage,
  unitesRendu,
  type Fichier,
  type Langue,
  type Plan,
} from "@feuilleton/core";
import { genererBruitage } from "@feuilleton/integrations";
import { z } from "zod";
import { exigerCle } from "../cles";
import type { Contexte } from "../contexte";
import { chargerEpisode, chargerReglages, enregistrerFichier, erreurCourte, fichierPret, nomPlan, type EpisodeComplet } from "../donnees";
import { monter, type PlanAMonter } from "../rendu/montage";
import { cheminMedia, nomUnique } from "../stockage";
import { ecrire, lignes, ligneOuNull } from "../supabase";

/** Données acceptées : langues à rendre (toutes par défaut) et bande annonce (vraie par défaut pour un film). */
export const schemaDonneesRendu = z.object({ langues: z.array(z.string()).optional(), bande_annonce: z.boolean().optional() });

/** Durée maximale d'un plan dans la bande annonce, et de la bande annonce entière. */
export const BANDE_ANNONCE = { parPlan: 5, total: 60 } as const;

/** Durée de l'ambiance sonore générée (maximum d'ElevenLabs ; elle tourne ensuite en boucle). */
export const DUREE_BRUITAGE_S = 30;

/** Plans de la bande annonce : accroches et climax du film, 5 s chacun au plus, 60 s au total. */
export function selectionBandeAnnonce(plans: readonly Plan[], durees: Map<string, number>): { plan: Plan; duree: number }[] {
  const out: { plan: Plan; duree: number }[] = [];
  let total = 0;
  for (const p of plans) {
    if (p.type !== "accroche" && p.type !== "climax") continue;
    const duree = Math.min(BANDE_ANNONCE.parPlan, durees.get(p.id) ?? BANDE_ANNONCE.parPlan, BANDE_ANNONCE.total - total);
    if (duree <= 0.5) break;
    out.push({ plan: p, duree });
    total += duree;
  }
  return out;
}

/** Clip à utiliser pour un plan : la prise choisie, sinon la prise A. */
export function clipDuPlan(index: Map<string, Fichier>, plan: Plan): Fichier | null {
  const choisi = index.get(`${plan.id}:clip:${plan.prise_choisie}`);
  if (choisi?.statut === "pret" && choisi.chemin) return choisi;
  const a = index.get(`${plan.id}:clip:A`);
  return a?.statut === "pret" && a.chemin ? a : null;
}

/** Télécharge un fichier du stockage dans le dossier de travail (une seule fois par chemin). */
function telechargeur(ctx: Contexte, dossier: string): (chemin: string) => Promise<string> {
  const deja = new Map<string, Promise<string>>();
  return (chemin) => {
    let p = deja.get(chemin);
    if (!p) {
      const local = join(dossier, `media-${deja.size}-${chemin.split("/").pop() ?? "f"}`);
      p = ctx.stockage.telechargerVers(chemin, local);
      deja.set(chemin, p);
    }
    return p;
  };
}

/** Rendu d'un générique (opening / ending) dans une langue, ou erreur claire s'il n'est pas prêt. */
async function generique(ctx: Contexte, id: string | null, quoi: "opening" | "ending", langue: Langue): Promise<string | null> {
  if (!id) return null;
  const rendus = await lignes<Fichier>(ctx.db.from("fichiers").select("*").eq("episode_id", id).eq("genre", "rendu").eq("langue", langue).eq("statut", "pret").order("cree_le", { ascending: false }).limit(1), quoi);
  const f = rendus[0];
  if (!f?.chemin) throw new Error(`L'${quoi} de la saison n'est pas rendu en ${langue} : lance d'abord son rendu dans cette langue.`);
  return f.chemin;
}

/** Ambiance sonore de l'épisode : réutilisée si elle existe, sinon générée une fois avec ElevenLabs. */
async function bruitage(ctx: Contexte, e: EpisodeComplet): Promise<string | null> {
  if (!e.episode.bruitages) return null;
  const existant = indexerFichiers(e.fichiers.filter((f) => f.genre === "bruitage" && f.statut === "pret" && f.chemin));
  const deja = [...existant.values()][0];
  if (deja?.chemin) return deja.chemin;
  const cle = (await ctx.cles()).elevenlabs;
  if (!cle) {
    ctx.journal("pas de clé ElevenLabs : rendu sans bruitage d'ambiance");
    return null;
  }
  try {
    const mp3 = await genererBruitage(cle, { texte: promptBruitage(e.serie, e.plans), duree: DUREE_BRUITAGE_S }, ctx.f);
    const chemin = cheminMedia(e.serie.espace_id, e.episode.id, "bruitage", nomUnique("ambiance", "mp3"));
    await ctx.stockage.envoyer(chemin, mp3, "audio/mpeg");
    // Coût non estimé : les tarifs saisis ne couvrent pas les bruitages ElevenLabs.
    await enregistrerFichier(ctx.db, { espace_id: e.serie.espace_id, episode_id: e.episode.id, genre: "bruitage", chemin, duree_s: DUREE_BRUITAGE_S });
    return chemin;
  } catch (err) {
    // L'ambiance est un plus : son échec ne doit pas bloquer le rendu.
    ctx.journal(`bruitage impossible, rendu sans ambiance : ${erreurCourte(err)}`);
    return null;
  }
}

/** Exécute la tâche rendu. */
export async function tacheRendu(ctx: Contexte): Promise<void> {
  const donnees = schemaDonneesRendu.parse(ctx.tache.donnees ?? {});
  if (!ctx.tache.episode_id) throw new Error("Tâche rendu sans épisode.");
  const e = await chargerEpisode(ctx.db, ctx.tache.episode_id);
  if (e.plans.length === 0) throw new Error("L'épisode n'a pas de plans.");
  const index = indexerFichiers(e.fichiers);
  const durees = dureesParPlan(e.plans, e.episode.duree_cible, e.episode.format);
  const unites = unitesRendu(e.episode).filter((u) => (u.genre === "rendu" ? !donnees.langues || donnees.langues.includes(u.langue ?? "") : donnees.bande_annonce !== false));

  // Tout ce qui manque est signalé d'un coup, avant de lancer ffmpeg.
  const manquants: string[] = [];
  for (const p of e.plans) {
    if (!clipDuPlan(index, p)) manquants.push(`clip du ${nomPlan(e.plans, p)}`);
    if (planParleElevenLabs(p, e.personnages)) {
      for (const u of unites) if (u.langue && !fichierPret(e.fichiers, `${p.id}:voix:${u.langue}`)) manquants.push(`voix ${u.langue} du ${nomPlan(e.plans, p)}`);
    }
  }
  if (manquants.length) throw new Error(`Rendu impossible, il manque : ${manquants.slice(0, 8).join(", ")}${manquants.length > 8 ? "…" : ""}.`);

  const dossier = await ctx.dossier();
  const local = telechargeur(ctx, dossier);
  const film = e.episode.format === "long";
  const musique = e.episode.musique
    ? await ligneOuNull<Fichier>(ctx.db.from("fichiers").select("*").eq("espace_id", e.serie.espace_id).eq("genre", "musique").eq("statut", "pret").order("cree_le", { ascending: false }).limit(1), "musique")
    : null;
  await ctx.progression({ fait: 0, total: unites.length, etape: "Préparation des fichiers" });
  const cheminBruitage = await bruitage(ctx, e);
  const rendues: string[] = [];

  for (const [n, u] of unites.entries()) {
    ctx.verifierArret();
    const bande = u.genre === "bande_annonce";
    const langue: Langue = bande ? e.episode.langue : (u.langue ?? e.episode.langue);
    const libelle = bande ? "Bande annonce" : `Version ${langue}`;
    const selection = bande ? selectionBandeAnnonce(e.plans, durees) : e.plans.map((p) => ({ plan: p, duree: durees.get(p.id) ?? 5 }));
    if (selection.length === 0) {
      ctx.journal("bande annonce ignorée : aucun plan d'accroche ni de climax");
      continue;
    }
    const plans: PlanAMonter[] = [];
    for (const s of selection) {
      const clip = clipDuPlan(index, s.plan);
      const voix = planParleElevenLabs(s.plan, e.personnages) ? fichierPret(e.fichiers, `${s.plan.id}:voix:${langue}`) : null;
      plans.push({ plan: s.plan, clip: await local(clip?.chemin ?? ""), duree: s.duree, voix: voix?.chemin ? await local(voix.chemin) : null });
    }
    const choix = bande ? langue : (e.episode.sous_titres[langue] ?? "aucun");
    const sousDossier = join(dossier, bande ? "bande-annonce" : langue);
    await mkdir(sousDossier, { recursive: true });
    const avant = film && !bande ? await generique(ctx, e.saison.opening_id, "opening", langue) : null;
    const apres = film && !bande ? await generique(ctx, e.saison.ending_id, "ending", langue) : null;
    const resultat = await monter({
      ffmpeg: ctx.config.ffmpeg,
      ffprobe: ctx.config.ffprobe,
      dossier: sousDossier,
      sortie: join(sousDossier, "sortie.mp4"),
      // La bande annonce d'un film est recadrée en 9:16 pour TikTok et Instagram.
      orientation: film && !bande ? "horizontal" : "vertical",
      recadrer: bande && film,
      plans,
      avant: avant ? await local(avant) : null,
      apres: apres ? await local(apres) : null,
      musique: musique?.chemin ? await local(musique.chemin) : null,
      bruitage: cheminBruitage ? await local(cheminBruitage) : null,
      sousTitres: choix === "aucun" ? null : { choix, langueOrigine: e.episode.langue },
      police: ctx.config.police,
      signal: ctx.signal,
      surEtape: (etape) => void ctx.progression({ fait: n, total: unites.length, etape: `${libelle} : ${etape}` }).catch(() => undefined),
    });
    const chemin = cheminMedia(e.serie.espace_id, e.episode.id, bande ? "bande_annonce" : "rendu", nomUnique(bande ? "bande-annonce" : langue, "mp4"));
    await ctx.progression({ fait: n, total: unites.length, etape: `${libelle} : envoi du fichier` });
    await ctx.stockage.envoyerFichier(chemin, resultat.chemin, "video/mp4");
    await enregistrerFichier(ctx.db, { espace_id: e.serie.espace_id, episode_id: e.episode.id, genre: bande ? "bande_annonce" : "rendu", langue, chemin, duree_s: Math.round(resultat.duree * 100) / 100 });
    rendues.push(bande ? "bande_annonce" : langue);
  }

  await apresRendu(ctx, e, rendues);
  await ctx.progression({ fait: unites.length, total: unites.length, etape: `Rendu terminé (${rendues.join(", ")})` });
}

/** Après le rendu : publications en attente prêtes → « programmée » ; mémoire automatique si demandée. */
async function apresRendu(ctx: Contexte, e: EpisodeComplet, rendues: readonly string[]): Promise<void> {
  const attente = await lignes<{ id: string; langue: Langue; livrable: string }>(
    ctx.db.from("publications").select("id, langue, livrable").eq("episode_id", e.episode.id).eq("statut", "attend_rendu"),
    "publications en attente",
  );
  const pretes = attente.filter((p) => (p.livrable === "bande_annonce" ? rendues.includes("bande_annonce") : rendues.includes(p.langue)));
  if (pretes.length) {
    await ecrire(
      ctx.db.from("publications").update({ statut: "programmee" }).in(
        "id",
        pretes.map((p) => p.id),
      ),
      "publications programmées",
    );
  }
  const { preferences } = await chargerReglages(ctx.db, await ctx.proprietaire());
  if (preferences.memoire_auto && !e.episode.memoire_faite && e.episode.genre === "episode") {
    const actives = await lignes<{ id: string }>(
      ctx.db.from("taches").select("id").eq("episode_id", e.episode.id).eq("type", "memoire").in("statut", ["en_file", "en_cours", "en_pause"]),
      "tâche mémoire",
    );
    if (actives.length === 0) {
      await ecrire(ctx.db.from("taches").insert({ espace_id: e.serie.espace_id, episode_id: e.episode.id, type: "memoire", donnees: {} }), "tâche mémoire");
    }
  }
}
