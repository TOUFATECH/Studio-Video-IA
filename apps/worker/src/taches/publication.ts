// Tâche « publication » : envoi d'un livrable sur YouTube (programmation native), Instagram ou TikTok (publication immédiate).
import { join } from "node:path";
import { legende, verifierDureePublication, type Episode, type Fichier, type Publication, type Serie, type StatutPublication } from "@studio-video-ia/core";
import { confidentialiteYoutube, definirMiniatureYoutube, envoyerVideoYoutube, estErreurJeton, LIMITE_PUBLICATIONS_INSTAGRAM_24H, publierReel, publierTiktok, quotaInstagram, sourceFichier, urlYoutube } from "@studio-video-ia/integrations";
import { chargerCompte, ErreurReconnexion, jetonValide, marquerExpire, MESSAGE_RECONNEXION, type CompteReseau } from "../comptes";
import type { Contexte } from "../contexte";
import { erreurCourte, fichierPret } from "../donnees";
import { executerFfmpeg } from "../rendu/executant";
import { ecrire, ligne, lignes } from "../supabase";

/** Clé du fichier à publier selon le livrable : la version de la langue, ou la bande annonce. */
export function cleLivrable(p: Pick<Publication, "livrable" | "langue">): string {
  return p.livrable === "bande_annonce" ? "bande_annonce" : `rendu:${p.langue}`;
}

/** Met à jour une publication. */
async function majPublication(ctx: Contexte, id: string, valeurs: Partial<Record<keyof Publication, unknown>>): Promise<void> {
  await ecrire(ctx.db.from("publications").update(valeurs).eq("id", id), "publication");
}

/** Statut final d'un envoi TikTok : privé si la vidéo n'est visible que par son auteur. */
export function statutTiktok(confidentialite: string): StatutPublication {
  return confidentialite === "SELF_ONLY" ? "privee" : "publiee";
}

/** Exécute la tâche publication. Toute erreur passe aussi la publication en « echec » (le planificateur ne la reprend pas). */
export async function tachePublication(ctx: Contexte): Promise<void> {
  const id = ctx.tache.publication_id ?? (typeof ctx.tache.donnees?.publication_id === "string" ? ctx.tache.donnees.publication_id : null);
  if (!id) throw new Error("Tâche publication sans publication.");
  const pub = await ligne<Publication>(ctx.db.from("publications").select("*").eq("id", id).limit(1), "publication");
  if (pub.statut === "publiee" || pub.statut === "privee" || pub.statut === "annulee") {
    await ctx.progression({ fait: 1, total: 1, etape: `Rien à faire : publication déjà ${pub.statut}` });
    return;
  }
  // Envoi interrompu (worker arrêté en plein envoi) : la vidéo est peut-être déjà en ligne. On ne renvoie pas
  // tout seul pour éviter un doublon public ; l'utilisateur vérifie sur le réseau puis clique « Réessayer ».
  if (pub.statut === "envoi" || pub.statut === "traitement") {
    await majPublication(ctx, pub.id, { statut: "echec", erreur: "Envoi interrompu : vérifie sur le réseau si la vidéo est en ligne avant de cliquer Réessayer (sinon elle sortirait deux fois)." });
    await ctx.progression({ fait: 1, total: 1, etape: "Envoi interrompu : vérification manuelle demandée" });
    return;
  }
  const compte = await chargerCompte(ctx.db, pub.reseau_connecte_id);
  try {
    await publier(ctx, pub, compte);
  } catch (e) {
    const reconnexion = e instanceof ErreurReconnexion || estErreurJeton(e);
    if (reconnexion && !(e instanceof ErreurReconnexion)) await marquerExpire(ctx.db, compte.id);
    await majPublication(ctx, pub.id, { statut: "echec", erreur: reconnexion ? MESSAGE_RECONNEXION : erreurCourte(e) });
    throw reconnexion ? new ErreurReconnexion() : e;
  }
}

/** Envoi proprement dit. */
async function publier(ctx: Contexte, pub: Publication, compte: CompteReseau): Promise<void> {
  const episode = await ligne<Episode>(ctx.db.from("episodes").select("*").eq("id", pub.episode_id).limit(1), "épisode");
  const serie = await ligne<Serie>(ctx.db.from("series").select("*").eq("id", episode.serie_id).limit(1), "série");
  // Garde-fou : on ne publie qu'avec un compte du même espace que la série.
  if (compte.espace_id !== serie.espace_id) throw new Error("Ce compte réseau n'appartient pas au même compte que la série : publication refusée.");
  const fichiers = await lignes<Fichier>(ctx.db.from("fichiers").select("*").eq("episode_id", episode.id).in("genre", ["rendu", "bande_annonce"]), "rendus");
  const fichier = fichierPret(fichiers, cleLivrable(pub));
  if (!fichier?.chemin) throw new Error(`Le rendu ${pub.livrable === "bande_annonce" ? "de la bande annonce" : pub.langue} n'existe pas : lance le rendu avant de publier.`);
  // Durée maximale voulue par réseau (TikTok et Instagram 2:00, Short YouTube 3:00, épisode YouTube 4:00).
  const trop = verifierDureePublication({ reseau: compte.reseau, livrable: pub.livrable, format: episode.format, duree: Number(fichier.duree_s ?? 0) });
  if (trop) throw new Error(trop);
  const texte = legende({ ...episode, hashtags: episode.hashtags ?? {} }, { ...serie, hashtags: serie.hashtags ?? {} }, pub.langue, compte.reseau);
  const jeton = await jetonValide({ db: ctx.db, cleMaitre: ctx.cleMaitre, cles: await ctx.cles(), compte, f: ctx.f });

  let derniere = -1;
  /** Progression 0–100 de la publication, sans écrire en base pour chaque petit pas. */
  const avancer = async (statut: StatutPublication, pourcentage: number, etape: string): Promise<void> => {
    const p = Math.max(0, Math.min(100, Math.round(pourcentage)));
    if (p === derniere && statut !== "traitement") return;
    derniere = p;
    await majPublication(ctx, pub.id, { statut, progression: p, erreur: null });
    await ctx.progression({ fait: p, total: 100, etape });
  };
  await avancer("envoi", 0, "Préparation de l'envoi");

  if (compte.reseau === "youtube") {
    const local = await ctx.stockage.telechargerVers(fichier.chemin, join(await ctx.dossier(), "video.mp4"));
    const programmeeLe = new Date(pub.programmee_le);
    const r = await envoyerVideoYoutube(
      jeton,
      {
        source: await sourceFichier(local),
        titre: texte.titre,
        description: texte.description,
        tags: [...texte.tags.split(/\s+/), serie.nom],
        langue: pub.langue,
        programmeeLe,
        signal: ctx.signal,
        surProgression: (x) => void avancer("envoi", x, `Envoi sur YouTube (${x} %)`).catch(() => undefined),
      },
      ctx.f,
    );
    const url = urlYoutube(r.id, pub.livrable !== "film");
    await miniatureYoutube(ctx, episode, jeton, r.id);
    // YouTube peut garder privée une vidéo envoyée par un projet Google non audité : on lit le statut réel.
    const reel = r.programmee ? null : await confidentialiteYoutube(jeton, r.id, ctx.f).catch(() => null);
    if (reel?.privacyStatus === "private") {
      await majPublication(ctx, pub.id, { statut: "privee", id_externe: r.id, url, progression: 100, publiee_le: new Date().toISOString(), erreur: "YouTube a gardé la vidéo privée : projet Google non audité (YouTube API Services) ou chaîne non validée." });
      await ctx.progression({ fait: 100, total: 100, etape: "Envoyée sur YouTube, mais restée privée" });
      return;
    }
    await majPublication(ctx, pub.id, r.programmee ? { statut: "programmee", id_externe: r.id, url, progression: 100 } : { statut: "publiee", id_externe: r.id, url, progression: 100, publiee_le: new Date().toISOString() });
    await ctx.progression({ fait: 100, total: 100, etape: r.programmee ? `Programmée sur YouTube pour ${programmeeLe.toISOString()}` : "Publiée sur YouTube" });
    return;
  }

  if (compte.reseau === "instagram") {
    if (!compte.id_externe) throw new ErreurReconnexion("identifiant du compte Instagram absent");
    // Limite d'Instagram : 100 publications par API sur 24 h glissantes (lecture du quota, ignorée si indisponible).
    const quota = await quotaInstagram(jeton, compte.id_externe, ctx.f, ctx.config.versionInstagram);
    if (quota !== null && quota >= LIMITE_PUBLICATIONS_INSTAGRAM_24H) {
      throw new Error(`Limite d'Instagram atteinte (${LIMITE_PUBLICATIONS_INSTAGRAM_24H} publications par 24 h) : reprogramme cette publication plus tard.`);
    }
    // Instagram télécharge la vidéo lui-même : URL signée d'une heure, jamais journalisée.
    const urlVideo = await ctx.stockage.urlSignee(fichier.chemin);
    const r = await publierReel(
      jeton,
      compte.id_externe,
      {
        urlVideo,
        legende: texte.description,
        surEtape: (etape) =>
          void avancer(etape === "conteneur" ? "envoi" : "traitement", etape === "conteneur" ? 10 : etape === "traitement" ? 50 : 90, `Instagram : ${etape}`).catch(() => undefined),
      },
      { signal: ctx.signal, version: ctx.config.versionInstagram },
      ctx.f,
    );
    await majPublication(ctx, pub.id, { statut: "publiee", id_externe: r.id, url: r.url, progression: 100, publiee_le: new Date().toISOString() });
    await ctx.progression({ fait: 100, total: 100, etape: "Publiée sur Instagram" });
    return;
  }

  const local = await ctx.stockage.telechargerVers(fichier.chemin, join(await ctx.dossier(), "video.mp4"));
  const r = await publierTiktok(
    jeton,
    {
      source: await sourceFichier(local),
      titre: texte.description,
      duree: fichier.duree_s !== null ? Number(fichier.duree_s) : null,
      auditValide: compte.audit_tiktok_valide,
      surEtape: (etape, x) => void avancer(etape, etape === "envoi" ? Math.min(95, x) : 98, etape === "envoi" ? `Envoi sur TikTok (${x} %)` : "TikTok traite la vidéo").catch(() => undefined),
    },
    { signal: ctx.signal },
    ctx.f,
  );
  const statut = statutTiktok(r.confidentialite);
  const pseudo = r.pseudo ?? (typeof compte.infos?.username === "string" ? compte.infos.username : null);
  const url = r.idPublic && pseudo ? `https://www.tiktok.com/@${pseudo}/video/${r.idPublic}` : null;
  // Seul l'identifiant public de la vidéo permet de retrouver ses statistiques (le publish_id ne sert qu'à l'envoi).
  await majPublication(ctx, pub.id, { statut, id_externe: r.idPublic ?? null, url, progression: 100, publiee_le: new Date().toISOString() });
  await ctx.progression({ fait: 100, total: 100, etape: statut === "privee" ? "Publiée sur TikTok en privé (application non auditée)" : "Publiée sur TikTok" });
}

/**
 * Envoie la miniature choisie dans l'étape Montage (si l'épisode en a une), convertie en JPEG 1280x720.
 * Ne bloque jamais la publication : YouTube refuse les miniatures personnalisées sur une chaîne non validée.
 */
async function miniatureYoutube(ctx: Contexte, episode: Episode, jeton: string, videoId: string): Promise<void> {
  const choix = episode.miniature;
  const chemin = choix ? choix.chemins[choix.choix] : undefined;
  if (!chemin) return;
  try {
    const dossier = await ctx.dossier();
    const source = await ctx.stockage.telechargerVers(chemin, join(dossier, "miniature-source"));
    const jpeg = join(dossier, "miniature.jpg");
    // 1280x720 recadré au centre, qualité JPEG élevée mais sous la limite de 2 Mo de YouTube.
    await executerFfmpeg(ctx.config.ffmpeg, ["-y", "-i", source, "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720", "-q:v", "3", jpeg], ctx.signal);
    const { readFile } = await import("node:fs/promises");
    await definirMiniatureYoutube(jeton, videoId, await readFile(jpeg), ctx.f);
  } catch (e) {
    ctx.journal(`miniature YouTube non envoyée : ${erreurCourte(e)}`);
  }
}
