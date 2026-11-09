// Statistiques des comptes connectés : chiffres du compte, liste de toutes les vidéos, revenus YouTube (Analytics).
// TikTok et Instagram n'ont pas d'API de revenus : ceux-ci se saisissent à la main dans l'app web.
import { z } from "zod";
import { ErreurApi, type Fetch } from "./contrat";
import { appelJson } from "./http";
import { estErreurJeton, URLS_OAUTH, versionInstagram } from "./oauth";

/** Chiffres d'un compte à un instant donné (null quand le réseau ne les fournit pas). */
export type ChiffresCompte = {
  abonnes: number | null;
  abonnements: number | null;
  jaimeTotal: number | null;
  videos: number | null;
  vuesTotal: number | null;
};

/** Une vidéo présente sur un compte, publiée par l'app ou non. */
export type VideoExterne = {
  idExterne: string;
  titre: string;
  url: string | null;
  miniatureUrl: string | null;
  publieeLe: string | null;
  dureeS: number | null;
  vues: number;
  jaime: number;
  commentaires: number;
  partages: number;
};

/** Revenus YouTube : par mois et par vidéo, ou la raison de leur indisponibilité. */
export type RevenusYoutube =
  | { disponible: true; devise: string; mois: { mois: string; montant: number }[]; parVideo: Map<string, number> }
  | { disponible: false; raison: string };

/** Nombre maximal de pages lues par compte, pour qu'un très gros compte ne bloque pas le worker. */
export const PAGES_MAX = 50;

/** Nombre entier depuis un texte ou un nombre (YouTube renvoie des textes). */
const schemaNombre = z.union([z.number(), z.string()]).transform((v) => Number(v));

/** Convertit une durée ISO 8601 de YouTube (« PT1M5S ») en secondes. */
export function dureeIso(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

// ---------------------------------------------------------------- TikTok

/** Adresses TikTok des statistiques. */
export const URLS_STATS_TIKTOK = {
  compte: "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,follower_count,following_count,likes_count,video_count",
  videos:
    "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,cover_image_url,share_url,view_count,like_count,comment_count,share_count,create_time,duration",
} as const;

const schemaErreurTiktok = z.object({ code: z.string(), message: z.string().optional() }).optional();

const schemaCompteTiktok = z.object({
  data: z
    .object({
      user: z
        .object({
          follower_count: z.number().optional(),
          following_count: z.number().optional(),
          likes_count: z.number().optional(),
          video_count: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
  error: schemaErreurTiktok,
});

const schemaVideosTiktok = z.object({
  data: z
    .object({
      videos: z
        .array(
          z.object({
            id: z.union([z.string(), z.number()]).transform(String),
            title: z.string().optional(),
            video_description: z.string().optional(),
            cover_image_url: z.string().optional(),
            share_url: z.string().optional(),
            view_count: z.number().optional(),
            like_count: z.number().optional(),
            comment_count: z.number().optional(),
            share_count: z.number().optional(),
            create_time: z.number().optional(),
            duration: z.number().optional(),
          }),
        )
        .default([]),
      cursor: z.number().optional(),
      has_more: z.boolean().optional(),
    })
    .optional(),
  error: schemaErreurTiktok,
});

/** Lève une ErreurApi si TikTok signale une erreur (scope manquant compris : « scope_not_authorized »). */
function verifierTiktok(e: z.infer<typeof schemaErreurTiktok>): void {
  if (e && e.code !== "ok") throw new ErreurApi("TikTok", e.code === "access_token_invalid" ? 401 : 403, e.message || e.code, e.code);
}

/** Chiffres d'un compte TikTok (scope user.info.stats nécessaire). */
export async function chiffresCompteTiktok(jeton: string, f: Fetch = fetch): Promise<ChiffresCompte> {
  const rep = await appelJson(f, "TikTok", URLS_STATS_TIKTOK.compte, { headers: { Authorization: `Bearer ${jeton}` } }, schemaCompteTiktok, [jeton]);
  verifierTiktok(rep.error);
  const u = rep.data?.user ?? {};
  return { abonnes: u.follower_count ?? null, abonnements: u.following_count ?? null, jaimeTotal: u.likes_count ?? null, videos: u.video_count ?? null, vuesTotal: null };
}

/** Toutes les vidéos publiques d'un compte TikTok (pages de 20, curseur). */
export async function videosTiktok(jeton: string, f: Fetch = fetch): Promise<VideoExterne[]> {
  const out: VideoExterne[] = [];
  let curseur: number | undefined;
  for (let page = 0; page < PAGES_MAX; page++) {
    const corps: Record<string, unknown> = { max_count: 20 };
    if (curseur !== undefined) corps.cursor = curseur;
    const rep = await appelJson(
      f,
      "TikTok",
      URLS_STATS_TIKTOK.videos,
      { method: "POST", headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(corps) },
      schemaVideosTiktok,
      [jeton],
    );
    verifierTiktok(rep.error);
    for (const v of rep.data?.videos ?? []) {
      out.push({
        idExterne: v.id,
        titre: v.title || v.video_description || "",
        url: v.share_url ?? null,
        miniatureUrl: v.cover_image_url ?? null,
        publieeLe: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
        dureeS: v.duration ?? null,
        vues: v.view_count ?? 0,
        jaime: v.like_count ?? 0,
        commentaires: v.comment_count ?? 0,
        partages: v.share_count ?? 0,
      });
    }
    if (!rep.data?.has_more || rep.data.cursor === undefined) break;
    curseur = rep.data.cursor;
  }
  return out;
}

// ---------------------------------------------------------------- Instagram

const schemaCompteInstagram = z.object({
  followers_count: z.number().optional(),
  follows_count: z.number().optional(),
  media_count: z.number().optional(),
});

const schemaMediasInstagram = z.object({
  data: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).transform(String),
        caption: z.string().optional(),
        media_type: z.string().optional(),
        media_product_type: z.string().optional(),
        permalink: z.string().optional(),
        thumbnail_url: z.string().optional(),
        timestamp: z.string().optional(),
        like_count: z.number().optional(),
        comments_count: z.number().optional(),
      }),
    )
    .default([]),
  paging: z.object({ next: z.string().optional() }).optional(),
});

const schemaVuesInstagram = z.object({
  data: z.array(z.object({ name: z.string(), values: z.array(z.object({ value: z.number() })).optional(), total_value: z.object({ value: z.number() }).optional() })),
});

/** Chiffres d'un compte Instagram professionnel. */
export async function chiffresCompteInstagram(jeton: string, f: Fetch = fetch, version = versionInstagram()): Promise<ChiffresCompte> {
  const url = `${URLS_OAUTH.instagram.graph}/${version}/me?${new URLSearchParams({ fields: "user_id,username,followers_count,follows_count,media_count", access_token: jeton }).toString()}`;
  const rep = await appelJson(f, "Instagram", url, { method: "GET" }, schemaCompteInstagram, [jeton]);
  return { abonnes: rep.followers_count ?? null, abonnements: rep.follows_count ?? null, jaimeTotal: null, videos: rep.media_count ?? null, vuesTotal: null };
}

/** Vues d'un média (insights). Renvoie null si Instagram refuse la métrique (type de média, compte trop récent…). */
export async function vuesMediaInstagram(jeton: string, media: string, f: Fetch = fetch, version = versionInstagram()): Promise<number | null> {
  const url = `${URLS_OAUTH.instagram.graph}/${version}/${encodeURIComponent(media)}/insights?${new URLSearchParams({ metric: "views", access_token: jeton }).toString()}`;
  try {
    const rep = await appelJson(f, "Instagram", url, { method: "GET" }, schemaVuesInstagram, [jeton]);
    const m = rep.data.find((x) => x.name === "views");
    return m?.total_value?.value ?? m?.values?.[0]?.value ?? null;
  } catch (e) {
    // Un jeton invalide doit remonter ; les autres refus (métrique indisponible) sont ignorés proprement.
    if (estErreurJeton(e)) throw e;
    return null;
  }
}

/** Tous les médias d'un compte Instagram (pages de 50 via paging.next), avec leurs vues si disponibles. */
export async function videosInstagram(jeton: string, f: Fetch = fetch, version = versionInstagram(), avecVues = true): Promise<VideoExterne[]> {
  const out: VideoExterne[] = [];
  let url: string | undefined = `${URLS_OAUTH.instagram.graph}/${version}/me/media?${new URLSearchParams({
    fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp,like_count,comments_count",
    limit: "50",
    access_token: jeton,
  }).toString()}`;
  for (let page = 0; url && page < PAGES_MAX; page++) {
    const rep: z.infer<typeof schemaMediasInstagram> = await appelJson(f, "Instagram", url, { method: "GET" }, schemaMediasInstagram, [jeton]);
    for (const m of rep.data) {
      const vues = avecVues ? await vuesMediaInstagram(jeton, m.id, f, version) : null;
      out.push({
        idExterne: m.id,
        titre: (m.caption ?? "").split("\n")[0]?.slice(0, 200) ?? "",
        url: m.permalink ?? null,
        miniatureUrl: m.thumbnail_url ?? null,
        publieeLe: m.timestamp ? new Date(m.timestamp).toISOString() : null,
        dureeS: null,
        vues: vues ?? 0,
        jaime: m.like_count ?? 0,
        commentaires: m.comments_count ?? 0,
        partages: 0,
      });
    }
    // paging.next contient déjà le jeton : on la suit telle quelle, sans jamais la journaliser.
    url = rep.paging?.next;
  }
  return out;
}

// ---------------------------------------------------------------- YouTube

/** Adresses YouTube des statistiques. */
export const URLS_STATS_YOUTUBE = {
  chaine: "https://www.googleapis.com/youtube/v3/channels?part=statistics,contentDetails&mine=true",
  playlist: "https://www.googleapis.com/youtube/v3/playlistItems",
  videos: "https://www.googleapis.com/youtube/v3/videos",
  analytics: "https://youtubeanalytics.googleapis.com/v2/reports",
} as const;

const schemaChaine = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        statistics: z
          .object({ subscriberCount: schemaNombre.optional(), viewCount: schemaNombre.optional(), videoCount: schemaNombre.optional(), hiddenSubscriberCount: z.boolean().optional() })
          .optional(),
        contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string().optional() }).optional() }).optional(),
      }),
    )
    .default([]),
});

const schemaPlaylist = z.object({
  items: z.array(z.object({ contentDetails: z.object({ videoId: z.string() }) })).default([]),
  nextPageToken: z.string().optional(),
});

const schemaVideosYoutube = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z
          .object({
            title: z.string().optional(),
            publishedAt: z.string().optional(),
            thumbnails: z.record(z.object({ url: z.string() })).optional(),
          })
          .optional(),
        statistics: z.object({ viewCount: schemaNombre.optional(), likeCount: schemaNombre.optional(), commentCount: schemaNombre.optional() }).optional(),
        contentDetails: z.object({ duration: z.string().optional() }).optional(),
      }),
    )
    .default([]),
});

const schemaRapport = z.object({
  columnHeaders: z.array(z.object({ name: z.string() })).default([]),
  rows: z.array(z.array(z.union([z.string(), z.number()]))).nullish(),
});

/** Chiffres de la chaîne YouTube et identifiant de sa playlist « uploads ». */
export async function chiffresChaineYoutube(jeton: string, f: Fetch = fetch): Promise<ChiffresCompte & { playlistUploads: string | null }> {
  const rep = await appelJson(f, "YouTube", URLS_STATS_YOUTUBE.chaine, { headers: { Authorization: `Bearer ${jeton}` } }, schemaChaine, [jeton]);
  const c = rep.items[0];
  if (!c) throw new ErreurApi("YouTube", 404, "aucune chaîne sur ce compte", "sans_chaine");
  const s = c.statistics;
  return {
    abonnes: s?.hiddenSubscriberCount ? null : (s?.subscriberCount ?? null),
    abonnements: null,
    jaimeTotal: null,
    videos: s?.videoCount ?? null,
    vuesTotal: s?.viewCount ?? null,
    playlistUploads: c.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

/** Toutes les vidéos d'une chaîne : identifiants via la playlist « uploads », puis détails par lots de 50. */
export async function videosYoutube(jeton: string, playlistUploads: string, f: Fetch = fetch): Promise<VideoExterne[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < PAGES_MAX; page++) {
    const params = new URLSearchParams({ part: "contentDetails", playlistId: playlistUploads, maxResults: "50" });
    if (pageToken) params.set("pageToken", pageToken);
    const rep = await appelJson(f, "YouTube", `${URLS_STATS_YOUTUBE.playlist}?${params.toString()}`, { headers: { Authorization: `Bearer ${jeton}` } }, schemaPlaylist, [jeton]);
    ids.push(...rep.items.map((i) => i.contentDetails.videoId));
    pageToken = rep.nextPageToken;
    if (!pageToken) break;
  }
  const out: VideoExterne[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const lot = ids.slice(i, i + 50);
    const url = `${URLS_STATS_YOUTUBE.videos}?${new URLSearchParams({ part: "snippet,statistics,contentDetails", id: lot.join(",") }).toString()}`;
    const rep = await appelJson(f, "YouTube", url, { headers: { Authorization: `Bearer ${jeton}` } }, schemaVideosYoutube, [jeton]);
    for (const v of rep.items) {
      const vignettes = v.snippet?.thumbnails ?? {};
      const duree = dureeIso(v.contentDetails?.duration);
      out.push({
        idExterne: v.id,
        titre: v.snippet?.title ?? "",
        // Les vidéos de 3 min ou moins sont des Shorts quand elles sont verticales : le lien classique marche dans tous les cas.
        url: `https://www.youtube.com/watch?v=${v.id}`,
        miniatureUrl: vignettes.medium?.url ?? vignettes.default?.url ?? null,
        publieeLe: v.snippet?.publishedAt ?? null,
        dureeS: duree,
        vues: v.statistics?.viewCount ?? 0,
        jaime: v.statistics?.likeCount ?? 0,
        commentaires: v.statistics?.commentCount ?? 0,
        partages: 0,
      });
    }
  }
  return out;
}

/** Date « AAAA-MM-JJ » en UTC. */
function jourIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Période des 12 derniers mois : du 1er du mois il y a 11 mois au dernier jour du mois en cours. */
export function periodeDouzeMois(maintenant: Date): { debut: string; fin: string } {
  const debut = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - 11, 1));
  const fin = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 0));
  return { debut: jourIso(debut), fin: jourIso(fin) };
}

/** Lit un rapport YouTube Analytics. */
async function rapport(jeton: string, params: Record<string, string>, f: Fetch): Promise<z.infer<typeof schemaRapport>> {
  const url = `${URLS_STATS_YOUTUBE.analytics}?${new URLSearchParams({ ids: "channel==MINE", ...params }).toString()}`;
  return appelJson(f, "YouTube Analytics", url, { headers: { Authorization: `Bearer ${jeton}` } }, schemaRapport, [jeton]);
}

/**
 * Revenus estimés des 12 derniers mois (par mois et par vidéo), en euros.
 * Un refus 403 (chaîne non monétisée, autorisation « monetary » absente) n'est pas une erreur :
 * on renvoie `disponible: false` avec la raison. Un jeton invalide (401) remonte.
 */
export async function revenusYoutube(jeton: string, maintenant: Date = new Date(), f: Fetch = fetch): Promise<RevenusYoutube> {
  const { debut, fin } = periodeDouzeMois(maintenant);
  try {
    const parMois = await rapport(jeton, { startDate: debut, endDate: fin, metrics: "estimatedRevenue", dimensions: "month", currency: "EUR" }, f);
    const iMois = parMois.columnHeaders.findIndex((c) => c.name === "month");
    const iRev = parMois.columnHeaders.findIndex((c) => c.name === "estimatedRevenue");
    const mois = (parMois.rows ?? [])
      .map((r) => ({ mois: `${String(r[iMois] ?? "")}-01`, montant: Number(r[iRev] ?? 0) }))
      .filter((m) => /^\d{4}-\d{2}-01$/.test(m.mois) && Number.isFinite(m.montant));
    const parVid = await rapport(
      jeton,
      { startDate: debut, endDate: fin, metrics: "estimatedRevenue,views", dimensions: "video", sort: "-views", maxResults: "200", currency: "EUR" },
      f,
    );
    const iVid = parVid.columnHeaders.findIndex((c) => c.name === "video");
    const iRevV = parVid.columnHeaders.findIndex((c) => c.name === "estimatedRevenue");
    const parVideo = new Map<string, number>();
    for (const r of parVid.rows ?? []) {
      const id = r[iVid];
      const montant = Number(r[iRevV] ?? 0);
      if (typeof id === "string" && Number.isFinite(montant)) parVideo.set(id, montant);
    }
    return { disponible: true, devise: "EUR", mois, parVideo };
  } catch (e) {
    if (e instanceof ErreurApi && e.statut === 403) return { disponible: false, raison: e.message.replace(/^YouTube Analytics 403 : /, "") };
    throw e;
  }
}

/** Vrai si une erreur TikTok signifie que l'autorisation user.info.stats n'a pas été donnée. */
export function estScopeManquant(e: unknown): boolean {
  return e instanceof ErreurApi && (e.code === "scope_not_authorized" || e.code === "scope_permission_missed");
}
