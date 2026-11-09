// Invalidation des générations quand l'utilisateur modifie un plan, les langues ou les sous-titres.
// Appelé après vérification d'appartenance ; écrit en service_role (les fichiers sont en lecture seule pour l'utilisateur).
import "server-only";
import type { Langue } from "@feuilleton/core";
import { supprimerObjets } from "./medias";
import { clientAdmin } from "./supabase/admin";

/** Supprime des lignes « fichiers » (et leurs objets) selon un filtre déjà construit. */
async function supprimer(filtre: { episode_id: string; plan_ids?: readonly string[]; genres: readonly string[]; langues?: readonly Langue[] }): Promise<number> {
  const admin = clientAdmin();
  let q = admin.from("fichiers").select("id, chemin").eq("episode_id", filtre.episode_id).in("genre", [...filtre.genres]);
  if (filtre.plan_ids) q = q.in("plan_id", [...filtre.plan_ids]);
  if (filtre.langues) q = q.in("langue", [...filtre.langues]);
  const { data } = await q;
  const lignes = (data ?? []).map((l) => ({ id: String(l.id), chemin: typeof l.chemin === "string" ? l.chemin : null }));
  if (!lignes.length) return 0;
  await admin.from("fichiers").delete().in("id", lignes.map((l) => l.id));
  await supprimerObjets(lignes.map((l) => l.chemin));
  return lignes.length;
}

/** Supprime les rendus de l'épisode : toutes les langues (et la bande annonce), ou seulement celles indiquées. */
export async function supprimerRendus(episodeId: string, langues?: readonly Langue[]): Promise<number> {
  if (langues && !langues.length) return 0;
  const n = await supprimer({ episode_id: episodeId, genres: ["rendu"], langues });
  // La bande annonce dépend de la version d'origine : elle part avec un rendu complet.
  const ba = langues ? 0 : await supprimer({ episode_id: episodeId, genres: ["bande_annonce", "miniature"] });
  return n + ba;
}

/** Plan modifié : supprime son image, ses clips et ses voix, puis tous les rendus de l'épisode. */
export async function invaliderPlans(episodeId: string, planIds: readonly string[]): Promise<void> {
  if (!planIds.length) return;
  await supprimer({ episode_id: episodeId, plan_ids: planIds, genres: ["image", "clip", "voix"] });
  await supprimerRendus(episodeId);
}

/** Clips modifiés sans toucher aux images (choix du nombre de prises) : supprime clips et rendus. */
export async function invaliderClips(episodeId: string, planIds: readonly string[], prise: "A" | "B" | null): Promise<void> {
  if (!planIds.length) return;
  const admin = clientAdmin();
  let q = admin.from("fichiers").select("id, chemin").eq("episode_id", episodeId).eq("genre", "clip").in("plan_id", [...planIds]);
  if (prise) q = q.eq("prise", prise);
  const { data } = await q;
  const lignes = (data ?? []).map((l) => ({ id: String(l.id), chemin: typeof l.chemin === "string" ? l.chemin : null }));
  if (lignes.length) {
    await admin.from("fichiers").delete().in("id", lignes.map((l) => l.id));
    await supprimerObjets(lignes.map((l) => l.chemin));
  }
}

/** « Refaire » une image : supprime l'image et les clips du plan (ils partent de l'image), puis les rendus. */
export async function invaliderImages(episodeId: string, planIds: readonly string[]): Promise<void> {
  if (!planIds.length) return;
  await supprimer({ episode_id: episodeId, plan_ids: planIds, genres: ["image", "clip"] });
  await supprimerRendus(episodeId);
}

/** Chemins des fichiers d'un plan, à supprimer du bucket avant de supprimer le plan (la base efface les lignes en cascade). */
export async function cheminsDuPlan(planId: string): Promise<string[]> {
  const { data } = await clientAdmin().from("fichiers").select("chemin").eq("plan_id", planId);
  return (data ?? []).map((l) => (typeof l.chemin === "string" ? l.chemin : "")).filter(Boolean);
}
