// Chargement des chiffres des comptes connectés : historique quotidien, vidéos, revenus (lecture limitée à l’utilisateur).
import "server-only";
import type { Revenu, StatsCompte, VideoReseau } from "@studio-video-ia/core";
import { enLots } from "./donnees";
import { ligneRevenu, lignes, ligneStatsCompte, ligneVideo } from "./lignes";
import { utilisateur } from "./session";

/** Historique quotidien des comptes depuis une date « AAAA-MM-JJ ». */
export async function chargerStatsComptes(reseauIds: readonly string[], depuis: string): Promise<StatsCompte[]> {
  if (!reseauIds.length) return [];
  const { db } = await utilisateur();
  const rs = await Promise.all(enLots(reseauIds).map((l) => db.from("stats_comptes").select("*").in("reseau_connecte_id", l).gte("jour", depuis).order("jour")));
  return rs.flatMap((r) => lignes(ligneStatsCompte, r.data, "stats_comptes"));
}

/** Vidéos des comptes (toutes, ou publiées depuis une date), les plus vues d'abord. */
export async function chargerVideos(reseauIds: readonly string[], options: { depuis?: string; limite?: number } = {}): Promise<VideoReseau[]> {
  if (!reseauIds.length) return [];
  const { db } = await utilisateur();
  const rs = await Promise.all(
    enLots(reseauIds).map((l) => {
      let q = db.from("videos_reseau").select("*").in("reseau_connecte_id", l);
      if (options.depuis) q = q.gte("publiee_le", options.depuis);
      return q.order("vues", { ascending: false }).limit(options.limite ?? 2000);
    }),
  );
  return rs.flatMap((r) => lignes(ligneVideo, r.data, "videos_reseau"));
}

/** Revenus des comptes depuis un mois « AAAA-MM-01 ». */
export async function chargerRevenus(reseauIds: readonly string[], depuis: string): Promise<Revenu[]> {
  if (!reseauIds.length) return [];
  const { db } = await utilisateur();
  const rs = await Promise.all(enLots(reseauIds).map((l) => db.from("revenus").select("*").in("reseau_connecte_id", l).gte("mois", depuis).order("mois", { ascending: false })));
  return rs.flatMap((r) => lignes(ligneRevenu, r.data, "revenus"));
}
