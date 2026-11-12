// Tâche « rendu » : une version par langue (et la bande annonce d'un film), avec génériques, voix, musique,
// bruitage et sous-titres ; puis passage des publications en attente à « programmée » et mémoire automatique.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  aGeneriques,
  dureesParPlan,
  estHorizontal,
  extraitClip,
  indexerFichiers,
  livrablePour,
  planParleElevenLabs,
  prochainCreneau,
  promptBruitage,
  reperesParoles,
  unitesRendu,
  verifierDureePublication,
  type Espace,
  type Fichier,
  type Langue,
  type Plan,
  type Repere,
  type ReseauConnecte,
} from "@studio-video-ia/core";
import { genererBruitage } from "@studio-video-ia/integrations";
import { z } from "zod";
import { exigerCle } from "../cles";
import type { Contexte } from "../contexte";
import { chansonDuClip, chargerEpisode, chargerReglages, enregistrerFichier, erreurCourte, fichierPret, nomPlan, type EpisodeComplet } from "../donnees";
import { executerFfmpeg, sonder } from "../rendu/executant";
import { monter, type PlanAMonter } from "../rendu/montage";
import { cheminMedia, nomUnique } from "../stockage";
import { ecrire, ligne, lignes, ligneOuNull } from "../bdd";
import { traduireParoles } from "./decoupage";
import { logoDeLaSerie } from "../bibliotheque";

/**
 * Clip du rappel : le dernier plan de l'épisode précédent de la série (même ordre que l'interface : saison puis numéro),
 * s'il a un clip prêt. Null sinon (premier épisode, rappel désactivé).
 */
export async function clipRappel(ctx: Contexte, e: EpisodeComplet): Promise<string | null> {
  if (!e.episode.rappel || e.episode.genre !== "episode") return null;
  const saisons = await lignes<{ id: string; numero: number }>(ctx.db.from("saisons").select("id, numero").eq("serie_id", e.serie.id), "saisons");
  const numero = new Map(saisons.map((x) => [x.id, x.numero]));
  const episodes = await lignes<{ id: string; saison_id: string; numero: number }>(
    ctx.db.from("episodes").select("id, saison_id, numero").eq("serie_id", e.serie.id).eq("genre", "episode"),
    "épisodes de la série",
  );
  const ordre = (x: { saison_id: string; numero: number }): number => (numero.get(x.saison_id) ?? 0) * 10_000 + x.numero;
  const precedent = episodes.filter((x) => ordre(x) < ordre(e.episode)).sort((a, b) => ordre(b) - ordre(a))[0];
  if (!precedent) return null;
  const dernier = await ligneOuNull<Plan>(ctx.db.from("plans").select("*").eq("episode_id", precedent.id).order("position", { ascending: false }).limit(1), "dernier plan");
  if (!dernier) return null;
  const clips = await lignes<Fichier>(ctx.db.from("fichiers").select("*").eq("plan_id", dernier.id).eq("genre", "clip").eq("statut", "pret"), "clip du rappel");
  return clipDuPlan(indexerFichiers(clips), dernier)?.chemin ?? null;
}

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
  // Clip musical : la chanson remplace voix, musique et ambiance ; les plans couvrent l'extrait choisi.
  const estClip = e.episode.genre === "clip";
  let chanson: { chemin: string; debut: number; duree: number } | null = null;
  let extrait: { debut: number; fin: number } | null = null;
  if (estClip) {
    const f = chansonDuClip(e.fichiers);
    if (!f?.chemin) throw new Error("Rendu impossible : le clip n'a pas de chanson. Ajoute-la dans l'étape « Son et paroles ».");
    const cheminLocal = await local(f.chemin);
    const dureeChanson = f.duree_s ? Number(f.duree_s) : (await sonder(ctx.config.ffprobe, cheminLocal, ctx.signal)).duree;
    extrait = extraitClip(e.episode, dureeChanson);
    // Sous-titres choisis dans une autre langue après le découpage : la traduction manquante est faite maintenant.
    try {
      await traduireParoles(ctx, e);
    } catch (err) {
      ctx.journal(`traduction des paroles impossible, rendu sans ces sous-titres : ${erreurCourte(err)}`);
    }
    const debut = Math.min(...e.plans.map((p) => p.debut ?? extrait!.debut));
    const total = e.plans.reduce((s, p) => s + (durees.get(p.id) ?? 0), 0);
    chanson = { chemin: cheminLocal, debut, duree: total };
  }
  // 16:9 pour un épisode YouTube ou un film ; opening et ending seulement autour d'un film.
  const horizontal = estHorizontal(e.episode.format);
  const generiques = aGeneriques(e.episode.format, e.episode.genre);
  const musique = e.episode.musique && !estClip
    ? await ligneOuNull<Fichier>(ctx.db.from("fichiers").select("*").eq("espace_id", e.serie.espace_id).eq("genre", "musique").eq("statut", "pret").order("cree_le", { ascending: false }).limit(1), "musique")
    : null;
  await ctx.progression({ fait: 0, total: unites.length, etape: "Préparation des fichiers" });
  const cheminBruitage = estClip ? null : await bruitage(ctx, e);
  // Marque : logo en incrustation et carte de fin ; rappel de 2 s de l'épisode précédent.
  const logo = e.episode.logo || e.episode.carte_fin ? logoDeLaSerie(e.elements, e.references) : null;
  const logoLocal = logo ? await local(logo.chemin) : null;
  const rappel = await clipRappel(ctx, e).catch((err) => {
    ctx.journal(`rappel de l'épisode précédent impossible : ${erreurCourte(err)}`);
    return null;
  });
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
    let paroles: Repere[] | null = null;
    if (estClip && chanson && extrait) {
      // Les sous-titres d'un clip sont les paroles (ou leur traduction), calées sur le début réel du premier plan.
      paroles = reperesParoles({
        lignes: e.episode.paroles_alignees ?? [],
        traductions: e.episode.paroles_traduites,
        extrait: { debut: chanson.debut, fin: chanson.debut + chanson.duree },
        choix,
        langueChanson: e.episode.langue,
      });
      if (choix !== "aucun" && paroles.length === 0) ctx.journal(`pas de paroles à afficher en ${choix} : rendu sans sous-titres`);
    }
    const avant = generiques && !bande ? await generique(ctx, e.saison.opening_id, "opening", langue) : null;
    const apres = generiques && !bande ? await generique(ctx, e.saison.ending_id, "ending", langue) : null;
    const resultat = await monter({
      ffmpeg: ctx.config.ffmpeg,
      ffprobe: ctx.config.ffprobe,
      dossier: sousDossier,
      sortie: join(sousDossier, "sortie.mp4"),
      // La bande annonce (épisode YouTube ou film, tournés en 16:9) est recadrée en 9:16 pour TikTok et Instagram.
      orientation: horizontal && !bande ? "horizontal" : "vertical",
      recadrer: bande && horizontal,
      plans,
      avant: avant ? await local(avant) : null,
      apres: apres ? await local(apres) : null,
      rappel: rappel && !bande ? await local(rappel) : null,
      logo: e.episode.logo ? logoLocal : null,
      carteFin: e.episode.carte_fin && logoLocal && !bande ? { logo: logoLocal, couleur: logo?.couleur ?? null } : null,
      musique: musique?.chemin ? await local(musique.chemin) : null,
      bruitage: cheminBruitage ? await local(cheminBruitage) : null,
      sousTitres: choix === "aucun" || estClip ? null : { choix, langueOrigine: e.episode.langue },
      chanson,
      reperesParoles: paroles,
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
  await creerMiniatures(ctx, e).catch((err) => ctx.journal(`miniatures non créées : ${erreurCourte(err)}`));
  await programmerSelonRythme(ctx, e).catch((err) => ctx.journal(`programmation automatique impossible : ${erreurCourte(err)}`));
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

/** Images des plans les plus forts, dans l'ordre de préférence pour une miniature. */
export function plansPourMiniatures(plans: readonly Plan[]): Plan[] {
  const ordre = ["climax", "accroche", "action", "decor", "dialogue", "final"] as const;
  return [...plans].sort((a, b) => ordre.indexOf(a.type) - ordre.indexOf(b.type) || a.position - b.position).slice(0, 3);
}

/**
 * Trois miniatures YouTube (JPEG 1280x720) tirées des images des plans forts, si l'épisode n'en a pas encore.
 * Gratuit : on recadre les images du storyboard, aucune nouvelle génération.
 */
async function creerMiniatures(ctx: Contexte, e: EpisodeComplet): Promise<void> {
  if ((e.episode.genre !== "episode" && e.episode.genre !== "clip") || e.episode.miniature?.chemins.length) return;
  const index = indexerFichiers(e.fichiers);
  const dossier = join(await ctx.dossier(), "miniatures");
  await mkdir(dossier, { recursive: true });
  const chemins: string[] = [];
  for (const [i, plan] of plansPourMiniatures(e.plans).entries()) {
    const image = index.get(`${plan.id}:image`);
    if (image?.statut !== "pret" || !image.chemin) continue;
    const source = await ctx.stockage.telechargerVers(image.chemin, join(dossier, `source-${i}`));
    const sortie = join(dossier, `miniature-${i}.jpg`);
    await executerFfmpeg(ctx.config.ffmpeg, ["-y", "-i", source, "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720", "-q:v", "3", sortie], ctx.signal);
    const chemin = cheminMedia(e.serie.espace_id, e.episode.id, "miniature", nomUnique(`miniature-${i + 1}`, "jpg"));
    await ctx.stockage.envoyerFichier(chemin, sortie, "image/jpeg");
    chemins.push(chemin);
  }
  if (chemins.length) await ecrire(ctx.db.from("episodes").update({ miniature: { choix: 0, chemins } }).eq("id", e.episode.id), "miniatures");
}

/**
 * Case « Programmer tout seul les épisodes prêts » du rythme de la série : si l'épisode n'a encore aucune
 * publication, il prend le prochain créneau sur les comptes du rythme (même espace, connectés, durée permise).
 */
async function programmerSelonRythme(ctx: Contexte, e: EpisodeComplet): Promise<void> {
  if ((e.episode.genre !== "episode" && e.episode.genre !== "clip") || !e.serie.rythme.auto || e.serie.rythme.reseaux.length === 0) return;
  const existantes = await lignes<{ id: string }>(ctx.db.from("publications").select("id").eq("episode_id", e.episode.id).neq("statut", "annulee"), "publications de l'épisode");
  if (existantes.length) return;
  const espace = await ligne<Espace>(ctx.db.from("espaces").select("*").eq("id", e.serie.espace_id).limit(1), "espace");
  const comptes = await lignes<ReseauConnecte>(
    ctx.db.from("reseaux_connectes").select("id, espace_id, reseau, nom_compte, langue, statut").in("id", e.serie.rythme.reseaux).eq("espace_id", e.serie.espace_id).eq("statut", "connecte"),
    "comptes du rythme",
  );
  if (!comptes.length) return;
  // Dernière date déjà prise par la série : le nouvel épisode passe N jours après.
  const episodesSerie = await lignes<{ id: string }>(ctx.db.from("episodes").select("id").eq("serie_id", e.serie.id), "épisodes de la série");
  const futures = await lignes<{ programmee_le: string }>(
    ctx.db.from("publications").select("programmee_le").in("episode_id", episodesSerie.map((x) => x.id)).in("statut", ["programmee", "attend_rendu"]),
    "publications futures",
  );
  const maintenant = new Date();
  const derniere = futures.map((p) => Date.parse(p.programmee_le)).filter((t) => t > maintenant.getTime());
  const creneau = prochainCreneau(e.serie.rythme, derniere.length ? new Date(Math.max(...derniere)) : null, maintenant, espace.fuseau);
  const fichiers = await lignes<Fichier>(ctx.db.from("fichiers").select("*").eq("episode_id", e.episode.id).in("genre", ["rendu", "bande_annonce"]).eq("statut", "pret"), "rendus");
  const nouvelles = comptes.flatMap((c) => {
    // Version dans la langue du compte si elle existe, sinon la langue d'origine.
    const langue: Langue = e.episode.langues.includes(c.langue) ? c.langue : e.episode.langue;
    const livrable = livrablePour(e.episode, c.reseau);
    const f = livrable === "bande_annonce" ? fichiers.find((x) => x.genre === "bande_annonce") : fichiers.find((x) => x.genre === "rendu" && x.langue === langue);
    if (!f) return [];
    if (verifierDureePublication({ reseau: c.reseau, livrable, format: e.episode.format, duree: Number(f.duree_s ?? 0), genre: e.episode.genre })) return [];
    return [{ episode_id: e.episode.id, reseau_connecte_id: c.id, langue, livrable, programmee_le: creneau.toISOString(), statut: "programmee" }];
  });
  if (nouvelles.length) {
    await ecrire(ctx.db.from("publications").insert(nouvelles), "programmation automatique");
    ctx.journal(`${nouvelles.length} publication(s) programmée(s) automatiquement pour ${creneau.toISOString()}`);
  }
}
