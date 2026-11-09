// Tâche « stats » (par espace) : pour chaque compte connecté, chiffres du jour, toutes ses vidéos, revenus YouTube,
// et statistiques des publications faites par l'app. Un compte en erreur n'empêche pas la synchronisation des autres.
import { dateLocale, type Publication, type StatsPublication } from "@feuilleton/core";
import {
  chiffresChaineYoutube,
  chiffresCompteInstagram,
  chiffresCompteTiktok,
  estErreurJeton,
  estScopeManquant,
  revenusYoutube,
  statsInstagram,
  statsTiktok,
  statsYoutube,
  videosInstagram,
  videosTiktok,
  videosYoutube,
  type ChiffresCompte,
  type RevenusYoutube,
  type VideoExterne,
} from "@feuilleton/integrations";
import { z } from "zod";
import { ErreurReconnexion, jetonValide, marquerExpire, type CompteReseau } from "../comptes";
import type { Contexte } from "../contexte";
import { erreurCourte } from "../donnees";
import { ecrire, ligne, lignes } from "../supabase";

/** Données acceptées : un seul compte à synchroniser (sinon tous les comptes connectés de l'espace). */
export const schemaDonneesStats = z.object({ reseau_connecte_id: z.string().optional() });

/** Statuts des publications dont on suit les statistiques. */
const STATUTS_SUIVIS = ["publiee", "privee"] as const;

/** Statistiques d'une publication à partir d'une vidéo du compte. */
export function statsDepuisVideo(v: VideoExterne): StatsPublication {
  return { vues: v.vues, jaime: v.jaime, commentaires: v.commentaires, partages: v.partages };
}

/** Lignes `videos_reseau` à enregistrer (upsert sur reseau_connecte_id + id_externe). */
export function lignesVideos(compteId: string, videos: readonly VideoExterne[], publicationParId: ReadonlyMap<string, string>, revenus: ReadonlyMap<string, number> | null, maintenant: Date) {
  return videos.map((v) => ({
    reseau_connecte_id: compteId,
    id_externe: v.idExterne,
    publication_id: publicationParId.get(v.idExterne) ?? null,
    titre: v.titre.slice(0, 500),
    url: v.url,
    miniature_url: v.miniatureUrl,
    publiee_le: v.publieeLe,
    duree_s: v.dureeS,
    vues: v.vues,
    jaime: v.jaime,
    commentaires: v.commentaires,
    partages: v.partages,
    // Revenus : seulement pour YouTube ; null ailleurs (saisie manuelle par mois côté web).
    ...(revenus ? { revenu_estime: Math.round((revenus.get(v.idExterne) ?? 0) * 100) / 100, devise: "EUR" } : {}),
    maj_le: maintenant.toISOString(),
  }));
}

/** Bilan d'un compte, affiché dans la progression. */
type BilanCompte = { compte: string; reseau: string; ok: boolean; videos: number; message: string };

/** Exécute la tâche stats. */
export async function tacheStats(ctx: Contexte): Promise<void> {
  const donnees = schemaDonneesStats.parse(ctx.tache.donnees ?? {});
  const espace = await ligne<{ fuseau: string }>(ctx.db.from("espaces").select("fuseau").eq("id", ctx.tache.espace_id).limit(1), "espace");
  let requete = ctx.db.from("reseaux_connectes").select("*").eq("espace_id", ctx.tache.espace_id).eq("statut", "connecte");
  if (donnees.reseau_connecte_id) requete = requete.eq("id", donnees.reseau_connecte_id);
  const comptes = await lignes<CompteReseau>(requete, "comptes connectés");
  const bilans: BilanCompte[] = [];
  for (const [i, compte] of comptes.entries()) {
    ctx.verifierArret();
    await ctx.progression({ fait: i, total: comptes.length, etape: `${compte.reseau} « ${compte.nom_compte} »`, comptes: bilans });
    try {
      bilans.push(await synchroniser(ctx, compte, espace.fuseau));
    } catch (e) {
      if (e instanceof ErreurReconnexion || estErreurJeton(e)) {
        if (!(e instanceof ErreurReconnexion)) await marquerExpire(ctx.db, compte.id);
        bilans.push({ compte: compte.nom_compte, reseau: compte.reseau, ok: false, videos: 0, message: "Reconnecte le compte (autorisation expirée)" });
      } else {
        bilans.push({ compte: compte.nom_compte, reseau: compte.reseau, ok: false, videos: 0, message: erreurCourte(e) });
      }
      ctx.journal(`statistiques de « ${compte.nom_compte} » : ${bilans.at(-1)?.message ?? ""}`);
    }
  }
  await ctx.progression({ fait: comptes.length, total: comptes.length, etape: `${bilans.filter((b) => b.ok).length}/${comptes.length} compte(s) synchronisé(s)`, comptes: bilans });
  if (comptes.length > 0 && bilans.every((b) => !b.ok)) throw new Error(`Aucun compte synchronisé : ${bilans.map((b) => `${b.compte} : ${b.message}`).join(" ; ")}`);
}

/** Synchronise un compte : chiffres, vidéos, revenus (YouTube) et statistiques des publications. */
async function synchroniser(ctx: Contexte, compte: CompteReseau, fuseau: string): Promise<BilanCompte> {
  const jeton = await jetonValide({ db: ctx.db, cleMaitre: ctx.cleMaitre, cles: await ctx.cles(), compte, f: ctx.f });
  const maintenant = new Date();
  const notes: Record<string, unknown> = { stats_le: maintenant.toISOString() };
  let chiffres: ChiffresCompte | null = null;
  let videos: VideoExterne[] = [];
  let revenus: RevenusYoutube | null = null;

  if (compte.reseau === "tiktok") {
    try {
      chiffres = await chiffresCompteTiktok(jeton, ctx.f);
    } catch (e) {
      // Comptes connectés avant l'ajout de user.info.stats : on continue sans les chiffres du compte.
      if (!estScopeManquant(e)) throw e;
      notes.stats = "indisponible: reconnecte le compte pour autoriser user.info.stats";
    }
    videos = await videosTiktok(jeton, ctx.f);
  } else if (compte.reseau === "instagram") {
    chiffres = await chiffresCompteInstagram(jeton, ctx.f, ctx.config.versionInstagram);
    videos = await videosInstagram(jeton, ctx.f, ctx.config.versionInstagram);
  } else {
    const chaine = await chiffresChaineYoutube(jeton, ctx.f);
    chiffres = chaine;
    videos = chaine.playlistUploads ? await videosYoutube(jeton, chaine.playlistUploads, ctx.f) : [];
    revenus = await revenusYoutube(jeton, maintenant, ctx.f);
    notes.revenus = revenus.disponible ? "disponible" : `indisponible: ${revenus.raison}`;
  }

  // Publications de l'app sur ce compte : pour relier les vidéos et mettre à jour leurs statistiques.
  const publications = await lignes<Pick<Publication, "id" | "id_externe" | "statut">>(
    ctx.db.from("publications").select("id, id_externe, statut").eq("reseau_connecte_id", compte.id).not("id_externe", "is", null),
    "publications du compte",
  );
  const publicationParId = new Map(publications.map((p) => [p.id_externe ?? "", p.id]));
  const revenusParVideo = revenus?.disponible ? revenus.parVideo : null;
  const rangs = lignesVideos(compte.id, videos, publicationParId, compte.reseau === "youtube" ? (revenusParVideo ?? new Map()) : null, maintenant);
  for (let i = 0; i < rangs.length; i += 200) {
    await ecrire(ctx.db.from("videos_reseau").upsert(rangs.slice(i, i + 200), { onConflict: "reseau_connecte_id,id_externe" }), "vidéos du compte");
  }

  if (revenus?.disponible && revenus.mois.length) {
    await ecrire(
      ctx.db.from("revenus").upsert(
        revenus.mois.map((m) => ({ reseau_connecte_id: compte.id, mois: m.mois, montant: Math.max(0, Math.round(m.montant * 100) / 100), devise: revenus.devise, source: "api" })),
        { onConflict: "reseau_connecte_id,mois,source" },
      ),
      "revenus YouTube",
    );
  }

  const jour = dateLocale(maintenant, fuseau);
  const moisCourant = `${jour.slice(0, 7)}-01`;
  const revenuMois = revenus?.disponible ? (revenus.mois.find((m) => m.mois === moisCourant)?.montant ?? 0) : null;
  await ecrire(
    ctx.db.from("stats_comptes").upsert(
      {
        reseau_connecte_id: compte.id,
        jour,
        abonnes: chiffres?.abonnes ?? null,
        abonnements: chiffres?.abonnements ?? null,
        jaime_total: chiffres?.jaimeTotal ?? (videos.length ? videos.reduce((s, v) => s + v.jaime, 0) : null),
        videos: chiffres?.videos ?? videos.length,
        // Instagram et TikTok ne donnent pas de total de vues : on additionne celles des vidéos.
        vues_total: chiffres?.vuesTotal ?? (videos.length ? videos.reduce((s, v) => s + v.vues, 0) : null),
        revenu_estime: revenuMois === null ? null : Math.round(revenuMois * 100) / 100,
        devise: revenuMois === null ? null : "EUR",
      },
      { onConflict: "reseau_connecte_id,jour" },
    ),
    "chiffres du jour",
  );

  await statsPublications(ctx, compte, jeton, publications, videos);
  await ecrire(ctx.db.from("reseaux_connectes").update({ infos: { ...(compte.infos ?? {}), ...notes } }).eq("id", compte.id), "infos du compte");
  return { compte: compte.nom_compte, reseau: compte.reseau, ok: true, videos: videos.length, message: `${videos.length} vidéo(s)${typeof notes.revenus === "string" && notes.revenus !== "disponible" ? ", revenus indisponibles" : ""}` };
}

/** Met à jour `publications.stats` : depuis la liste des vidéos, sinon par une lecture directe (vidéos privées, par exemple). */
async function statsPublications(ctx: Contexte, compte: CompteReseau, jeton: string, publications: readonly Pick<Publication, "id" | "id_externe" | "statut">[], videos: readonly VideoExterne[]): Promise<void> {
  const suivies = publications.filter((p) => (STATUTS_SUIVIS as readonly string[]).includes(p.statut) && p.id_externe);
  const parId = new Map(videos.map((v) => [v.idExterne, v]));
  const stats = new Map<string, StatsPublication>();
  const manquantes: string[] = [];
  for (const p of suivies) {
    const v = parId.get(p.id_externe ?? "");
    if (v) stats.set(p.id, statsDepuisVideo(v));
    else manquantes.push(p.id_externe ?? "");
  }
  if (manquantes.length) {
    try {
      let lues = new Map<string, StatsPublication>();
      if (compte.reseau === "youtube") lues = await statsYoutube(jeton, manquantes, ctx.f);
      // Seuls les identifiants numériques sont des vidéos TikTok ; les autres sont des identifiants d'envoi (vidéo privée).
      else if (compte.reseau === "tiktok") lues = await statsTiktok(jeton, manquantes.filter((x) => /^\d+$/.test(x)), ctx.f);
      else for (const m of manquantes) lues.set(m, await statsInstagram(jeton, m, ctx.f, ctx.config.versionInstagram));
      for (const p of suivies) {
        const s = lues.get(p.id_externe ?? "");
        if (s) stats.set(p.id, s);
      }
    } catch (e) {
      if (estErreurJeton(e)) throw e;
      ctx.journal(`statistiques de publications partielles pour « ${compte.nom_compte} » : ${erreurCourte(e)}`);
    }
  }
  const maintenant = new Date().toISOString();
  for (const [id, s] of stats) await ecrire(ctx.db.from("publications").update({ stats: s, stats_le: maintenant }).eq("id", id), "statistiques d'une publication");
}
