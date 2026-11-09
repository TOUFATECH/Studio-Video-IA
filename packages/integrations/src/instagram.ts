// Publication Instagram (Reels) avec l'API Instagram « connexion Instagram » : conteneur, attente, publication, statistiques.
// L'API ne programme pas : le worker publie à l'heure. La vidéo doit être à une URL publique (URL signée Supabase).
import type { StatsPublication } from "@studio-video-ia/core";
import { z } from "zod";
import { ErreurApi, type Fetch } from "./contrat";
import { appelJson, attendre as attendreReel, requete, type Attendre } from "./http";
import { estErreurJeton, URLS_OAUTH, versionInstagram } from "./oauth";

const FOURNISSEUR = "Instagram";

/** Nombre maximal de publications par l'API sur 24 h glissantes et par compte. */
export const LIMITE_PUBLICATIONS_INSTAGRAM_24H = 100;

/** États possibles d'un conteneur de média. */
export type StatutConteneur = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

/** Options du suivi d'un conteneur (toutes les 15 s, 10 min au plus par défaut). */
export type OptionsConteneur = { intervalleMs?: number; delaiMaxMs?: number; attendre?: Attendre; signal?: AbortSignal; version?: string };

const schemaId = z.object({ id: z.union([z.string(), z.number()]).transform(String) });
const schemaStatut = z.object({ status_code: z.string(), status: z.string().optional() });
const schemaPermalien = z.object({ permalink: z.string().optional() });
const schemaInsights = z.object({
  data: z.array(z.object({ name: z.string(), values: z.array(z.object({ value: z.number() })).optional(), total_value: z.object({ value: z.number() }).optional() })),
});
const schemaCompteurs = z.object({ like_count: z.number().optional(), comments_count: z.number().optional() });

/** Adresse Graph d'un chemin, avec le jeton en paramètre (méthode documentée par Instagram). */
function urlGraph(chemin: string, jeton: string, params: Record<string, string> = {}, version = versionInstagram()): string {
  return `${URLS_OAUTH.instagram.graph}/${version}/${chemin}?${new URLSearchParams({ ...params, access_token: jeton }).toString()}`;
}

/** Crée le conteneur d'un Reel à partir d'une vidéo accessible publiquement. Renvoie l'identifiant du conteneur. */
export async function creerConteneurReel(
  jeton: string,
  igId: string,
  p: { urlVideo: string; legende: string; version?: string },
  f: Fetch = fetch,
): Promise<string> {
  const rep = await appelJson(
    f,
    FOURNISSEUR,
    urlGraph(`${encodeURIComponent(igId)}/media`, jeton, {}, p.version),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: "REELS", video_url: p.urlVideo, caption: p.legende, share_to_feed: true }),
    },
    schemaId,
    [jeton, p.urlVideo],
  );
  return rep.id;
}

/** Lit l'état d'un conteneur. */
export async function statutConteneur(jeton: string, conteneur: string, f: Fetch = fetch, version?: string): Promise<string> {
  const rep = await appelJson(f, FOURNISSEUR, urlGraph(encodeURIComponent(conteneur), jeton, { fields: "status_code,status" }, version), { method: "GET" }, schemaStatut, [jeton]);
  return rep.status_code;
}

/** Attend que le conteneur soit prêt (FINISHED). Lève une erreur claire sur ERROR, EXPIRED ou délai dépassé. */
export async function attendreConteneur(jeton: string, conteneur: string, options: OptionsConteneur = {}, f: Fetch = fetch): Promise<void> {
  const intervalle = options.intervalleMs ?? 15_000;
  const delaiMax = options.delaiMaxMs ?? 10 * 60_000;
  const dormir = options.attendre ?? attendreReel;
  let ecoule = 0;
  for (;;) {
    const s = await statutConteneur(jeton, conteneur, f, options.version);
    if (s === "FINISHED" || s === "PUBLISHED") return;
    if (s === "ERROR") throw new ErreurApi(FOURNISSEUR, 422, "Instagram n'a pas pu traiter la vidéo (format, durée ou URL inaccessible)", "conteneur_erreur");
    if (s === "EXPIRED") throw new ErreurApi(FOURNISSEUR, 410, "le conteneur a expiré avant la publication", "conteneur_expire");
    ecoule += intervalle;
    if (ecoule > delaiMax) throw new ErreurApi(FOURNISSEUR, 408, `vidéo toujours en traitement après ${Math.round(delaiMax / 60000)} min`, "delai_depasse");
    await dormir(intervalle, options.signal);
  }
}

/** Publie un conteneur prêt. Renvoie l'identifiant du média publié. */
export async function publierConteneur(jeton: string, igId: string, conteneur: string, f: Fetch = fetch, version?: string): Promise<string> {
  const rep = await appelJson(
    f,
    FOURNISSEUR,
    urlGraph(`${encodeURIComponent(igId)}/media_publish`, jeton, {}, version),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creation_id: conteneur }) },
    schemaId,
    [jeton],
  );
  return rep.id;
}

/** Lien public d'un média publié (null si Instagram ne le donne pas). */
export async function permalienInstagram(jeton: string, media: string, f: Fetch = fetch, version?: string): Promise<string | null> {
  const rep = await appelJson(f, FOURNISSEUR, urlGraph(encodeURIComponent(media), jeton, { fields: "permalink" }, version), { method: "GET" }, schemaPermalien, [jeton]);
  return rep.permalink ?? null;
}

/** Publie un Reel de bout en bout : conteneur, attente du traitement, publication, permalien. */
export async function publierReel(
  jeton: string,
  igId: string,
  p: { urlVideo: string; legende: string; surEtape?: (etape: "conteneur" | "traitement" | "publication") => void },
  options: OptionsConteneur = {},
  f: Fetch = fetch,
): Promise<{ id: string; url: string | null }> {
  p.surEtape?.("conteneur");
  const conteneur = await creerConteneurReel(jeton, igId, { urlVideo: p.urlVideo, legende: p.legende, version: options.version }, f);
  p.surEtape?.("traitement");
  await attendreConteneur(jeton, conteneur, options, f);
  p.surEtape?.("publication");
  const id = await publierConteneur(jeton, igId, conteneur, f, options.version);
  // Le permalien est un plus : son absence ne doit pas faire échouer une publication réussie.
  let url: string | null = null;
  try {
    url = await permalienInstagram(jeton, id, f, options.version);
  } catch {
    url = null;
  }
  return { id, url };
}

/** Valeur d'une métrique d'insights (format « total_value » ou « values »). */
function valeurMetrique(d: z.infer<typeof schemaInsights>, nom: string): number | undefined {
  const m = d.data.find((x) => x.name === nom);
  return m?.total_value?.value ?? m?.values?.[0]?.value;
}

/** Statistiques d'un Reel : insights (vues, j'aime, commentaires, partages), sinon repli sur les compteurs publics. */
export async function statsInstagram(jeton: string, media: string, f: Fetch = fetch, version?: string): Promise<StatsPublication> {
  try {
    const d = await appelJson(f, FOURNISSEUR, urlGraph(`${encodeURIComponent(media)}/insights`, jeton, { metric: "views,likes,comments,shares" }, version), { method: "GET" }, schemaInsights, [jeton]);
    return { vues: valeurMetrique(d, "views"), jaime: valeurMetrique(d, "likes"), commentaires: valeurMetrique(d, "comments"), partages: valeurMetrique(d, "shares") };
  } catch (e) {
    // Un jeton invalide ne se corrige pas par un repli : on laisse remonter l'erreur.
    if (estErreurJeton(e)) throw e;
    const c = await appelJson(f, FOURNISSEUR, urlGraph(encodeURIComponent(media), jeton, { fields: "like_count,comments_count" }, version), { method: "GET" }, schemaCompteurs, [jeton]);
    return { jaime: c.like_count, commentaires: c.comments_count };
  }
}

/** Nombre de publications API faites sur les dernières 24 h (pour respecter la limite de 100). */
export async function quotaInstagram(jeton: string, igId: string, f: Fetch = fetch, version?: string): Promise<number | null> {
  const schema = z.object({ data: z.array(z.object({ quota_usage: z.number().optional() })) });
  const rep = await requete(f, FOURNISSEUR, urlGraph(`${encodeURIComponent(igId)}/content_publishing_limit`, jeton, { fields: "quota_usage" }, version), { method: "GET" });
  if (!rep.ok) return null;
  const r = schema.safeParse(await rep.json().catch(() => null));
  return r.success ? (r.data.data[0]?.quota_usage ?? null) : null;
}
