// Publication TikTok (Content Posting API, envoi direct) : infos du créateur, découpage, envoi par morceaux, suivi, statistiques.
import type { StatsPublication } from "@feuilleton/core";
import { z } from "zod";
import { ErreurApi, type Fetch } from "./contrat";
import { appelJson, attendre as attendreReel, erreurDepuisReponse, erreurReponseInvalide, requete, type Attendre, type SourceEnvoi } from "./http";

const FOURNISSEUR = "TikTok";

/** Adresses de l'API de publication TikTok. */
export const URLS_TIKTOK = {
  createur: "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
  init: "https://open.tiktokapis.com/v2/post/publish/video/init/",
  statut: "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
  videos: "https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count",
} as const;

/** Nombre maximal d'initialisations de publication par minute et par jeton. */
export const LIMITE_INIT_TIKTOK_PAR_MINUTE = 6;

/** Taille à partir de laquelle on découpe (64 Mo) et taille des morceaux (10 Mo). */
export const LIMITE_MORCEAU_UNIQUE_TIKTOK = 64 * 1024 * 1024;
export const TAILLE_MORCEAU_TIKTOK = 10 * 1024 * 1024;

/** Niveaux de confidentialité proposés par TikTok. */
export type ConfidentialiteTiktok = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";

/** États d'une publication. */
export type StatutTiktok = "PROCESSING_UPLOAD" | "PROCESSING_DOWNLOAD" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED";

/** Plan d'envoi : taille d'un morceau, nombre de morceaux et bornes de chacun (octets inclus). */
export type DecoupageEnvoi = { tailleMorceau: number; nombre: number; morceaux: { debut: number; fin: number }[] };

/** Ce que TikTok autorise pour ce créateur. */
export type InfosCreateur = { confidentialites: string[]; dureeMax: number | null; pseudo: string | null };

/** Résultat d'une publication. */
export type ResultatTiktok = { publishId: string; statut: StatutTiktok; idPublic: string | null; confidentialite: ConfidentialiteTiktok };

/** Erreur commune des réponses TikTok : `error.code` vaut « ok » quand tout va bien. */
const schemaErreur = z.object({ code: z.string(), message: z.string().optional(), log_id: z.string().optional() }).optional();

const schemaCreateur = z.object({
  data: z
    .object({
      privacy_level_options: z.array(z.string()).default([]),
      max_video_post_duration_sec: z.number().optional(),
      creator_username: z.string().optional(),
    })
    .optional(),
  error: schemaErreur,
});

const schemaInit = z.object({
  data: z.object({ publish_id: z.string().min(1), upload_url: z.string().url() }).optional(),
  error: schemaErreur,
});

const schemaStatut = z.object({
  data: z.object({ status: z.string(), fail_reason: z.string().optional(), uploaded_bytes: z.number().optional() }).optional(),
  error: schemaErreur,
});

const schemaVideos = z.object({
  data: z
    .object({
      videos: z
        .array(
          z.object({
            id: z.union([z.string(), z.number()]).transform(String),
            view_count: z.number().optional(),
            like_count: z.number().optional(),
            comment_count: z.number().optional(),
            share_count: z.number().optional(),
          }),
        )
        .default([]),
    })
    .optional(),
  error: schemaErreur,
});

/** Lève une ErreurApi si la réponse TikTok porte un code d'erreur autre que « ok ». */
function verifierErreur(e: z.infer<typeof schemaErreur>): void {
  if (e && e.code !== "ok") throw new ErreurApi(FOURNISSEUR, e.code === "access_token_invalid" ? 401 : 400, e.message || e.code, e.code);
}

/** En-têtes JSON authentifiés. */
function entetes(jeton: string): Record<string, string> {
  return { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json; charset=UTF-8" };
}

/**
 * Découpe un fichier pour l'envoi : un seul morceau jusqu'à 64 Mo, sinon des morceaux de 10 Mo
 * avec `total_chunk_count = floor(taille / 10 Mo)`, le dernier morceau absorbant le reste.
 * Règle tirée du « Media Transfer Guide » de TikTok (à vérifier si TikTok la fait évoluer).
 */
export function decouperEnvoi(taille: number): DecoupageEnvoi {
  if (!Number.isInteger(taille) || taille <= 0) throw new Error(`Taille de fichier invalide : ${taille}`);
  if (taille <= LIMITE_MORCEAU_UNIQUE_TIKTOK) return { tailleMorceau: taille, nombre: 1, morceaux: [{ debut: 0, fin: taille - 1 }] };
  const nombre = Math.floor(taille / TAILLE_MORCEAU_TIKTOK);
  const morceaux = Array.from({ length: nombre }, (_, i) => ({
    debut: i * TAILLE_MORCEAU_TIKTOK,
    fin: i === nombre - 1 ? taille - 1 : (i + 1) * TAILLE_MORCEAU_TIKTOK - 1,
  }));
  return { tailleMorceau: TAILLE_MORCEAU_TIKTOK, nombre, morceaux };
}

/**
 * Choisit la confidentialité : public seulement si l'application a passé l'audit TikTok
 * et que le créateur le propose ; sinon « moi seulement » (une app non auditée ne publie qu'en privé).
 */
export function choisirConfidentialite(options: readonly string[], auditValide: boolean): ConfidentialiteTiktok {
  return auditValide && options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY";
}

/** Lit ce que TikTok autorise pour ce créateur (confidentialités, durée maximale). */
export async function infosCreateur(jeton: string, f: Fetch = fetch): Promise<InfosCreateur> {
  const rep = await appelJson(f, FOURNISSEUR, URLS_TIKTOK.createur, { method: "POST", headers: entetes(jeton) }, schemaCreateur, [jeton]);
  verifierErreur(rep.error);
  return { confidentialites: rep.data?.privacy_level_options ?? [], dureeMax: rep.data?.max_video_post_duration_sec ?? null, pseudo: rep.data?.creator_username ?? null };
}

/** Initialise une publication directe (envoi de fichier). Renvoie l'identifiant et l'adresse d'envoi (valable 1 h). */
export async function initialiserPublication(
  jeton: string,
  p: { titre: string; confidentialite: ConfidentialiteTiktok; taille: number },
  f: Fetch = fetch,
): Promise<{ publishId: string; urlEnvoi: string; decoupage: DecoupageEnvoi }> {
  const decoupage = decouperEnvoi(p.taille);
  const corps = {
    post_info: {
      title: [...p.titre].slice(0, 2200).join(""),
      privacy_level: p.confidentialite,
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false,
      // Contenu généré par IA : TikTok demande de le déclarer.
      is_aigc: true,
    },
    source_info: { source: "FILE_UPLOAD", video_size: p.taille, chunk_size: decoupage.tailleMorceau, total_chunk_count: decoupage.nombre },
  };
  const rep = await appelJson(f, FOURNISSEUR, URLS_TIKTOK.init, { method: "POST", headers: entetes(jeton), body: JSON.stringify(corps) }, schemaInit, [jeton]);
  verifierErreur(rep.error);
  if (!rep.data) throw erreurReponseInvalide(FOURNISSEUR, "publish_id absent");
  return { publishId: rep.data.publish_id, urlEnvoi: rep.data.upload_url, decoupage };
}

/** Envoie le fichier morceau par morceau vers l'adresse fournie par TikTok. */
export async function envoyerMorceaux(
  urlEnvoi: string,
  source: SourceEnvoi,
  decoupage: DecoupageEnvoi,
  options: { surProgression?: (pourcentage: number) => void; signal?: AbortSignal } = {},
  f: Fetch = fetch,
): Promise<void> {
  for (const m of decoupage.morceaux) {
    const octets = await source.lire(m.debut, m.fin);
    const rep = await requete(f, FOURNISSEUR, urlEnvoi, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(octets.byteLength),
        "Content-Range": `bytes ${m.debut}-${m.fin}/${source.taille}`,
      },
      body: octets,
      signal: options.signal,
    });
    // 206 : morceau reçu, 201 : fichier complet.
    if (!rep.ok) throw await erreurDepuisReponse(FOURNISSEUR, rep, [urlEnvoi]);
    options.surProgression?.(Math.round(((m.fin + 1) / source.taille) * 100));
  }
}

/**
 * Extrait les identifiants publics du texte brut de la réponse.
 * TikTok les renvoie comme des nombres de 19 chiffres, que JSON.parse arrondirait : on les lit avant.
 */
export function extraireIdsPublics(brut: string): string[] {
  const m = /"publicaly_available_post_id"\s*:\s*\[([^\]]*)\]/.exec(brut);
  if (!m?.[1]) return [];
  return [...m[1].matchAll(/"?(\d+)"?/g)].map((x) => x[1] ?? "").filter(Boolean);
}

/** Lit l'état d'une publication. */
export async function statutPublication(jeton: string, publishId: string, f: Fetch = fetch): Promise<{ statut: string; raison: string | null; idsPublics: string[] }> {
  const rep = await requete(f, FOURNISSEUR, URLS_TIKTOK.statut, { method: "POST", headers: entetes(jeton), body: JSON.stringify({ publish_id: publishId }) });
  if (!rep.ok) throw await erreurDepuisReponse(FOURNISSEUR, rep, [jeton]);
  const brut = await rep.text();
  let corps: unknown;
  try {
    corps = JSON.parse(brut) as unknown;
  } catch {
    throw erreurReponseInvalide(FOURNISSEUR, "JSON illisible");
  }
  const r = schemaStatut.safeParse(corps);
  if (!r.success) throw erreurReponseInvalide(FOURNISSEUR, r.error.issues.map((i) => i.message).join(" ; "));
  verifierErreur(r.data.error);
  if (!r.data.data) throw erreurReponseInvalide(FOURNISSEUR, "statut absent");
  return { statut: r.data.data.status, raison: r.data.data.fail_reason ?? null, idsPublics: extraireIdsPublics(brut) };
}

/**
 * Publie une vidéo de bout en bout : infos du créateur, confidentialité, init, envoi, suivi jusqu'à la fin.
 * `duree` (secondes) est comparée à la durée maximale autorisée pour le créateur.
 */
export async function publierTiktok(
  jeton: string,
  p: {
    source: SourceEnvoi;
    titre: string;
    duree: number | null;
    auditValide: boolean;
    surEtape?: (etape: "envoi" | "traitement", pourcentage: number) => void;
  },
  options: { intervalleMs?: number; delaiMaxMs?: number; attendre?: Attendre; signal?: AbortSignal } = {},
  f: Fetch = fetch,
): Promise<ResultatTiktok> {
  const infos = await infosCreateur(jeton, f);
  if (p.duree !== null && infos.dureeMax !== null && p.duree > infos.dureeMax) {
    throw new ErreurApi(FOURNISSEUR, 400, `vidéo de ${Math.round(p.duree)} s, ce compte accepte ${infos.dureeMax} s au plus`, "duree_trop_longue");
  }
  const confidentialite = choisirConfidentialite(infos.confidentialites, p.auditValide);
  const { publishId, urlEnvoi, decoupage } = await initialiserPublication(jeton, { titre: p.titre, confidentialite, taille: p.source.taille }, f);
  p.surEtape?.("envoi", 0);
  await envoyerMorceaux(urlEnvoi, p.source, decoupage, { surProgression: (x) => p.surEtape?.("envoi", x), signal: options.signal }, f);
  p.surEtape?.("traitement", 100);
  const intervalle = options.intervalleMs ?? 5000;
  const delaiMax = options.delaiMaxMs ?? 10 * 60_000;
  const dormir = options.attendre ?? attendreReel;
  let ecoule = 0;
  for (;;) {
    const s = await statutPublication(jeton, publishId, f);
    if (s.statut === "PUBLISH_COMPLETE" || s.statut === "SEND_TO_USER_INBOX") {
      return { publishId, statut: s.statut, idPublic: s.idsPublics[0] ?? null, confidentialite };
    }
    if (s.statut === "FAILED") throw new ErreurApi(FOURNISSEUR, 422, `publication refusée : ${s.raison ?? "raison inconnue"}`, s.raison ?? "failed");
    ecoule += intervalle;
    if (ecoule > delaiMax) throw new ErreurApi(FOURNISSEUR, 408, `publication toujours en traitement après ${Math.round(delaiMax / 60000)} min`, "delai_depasse");
    await dormir(intervalle, options.signal);
  }
}

/** Statistiques de vidéos publiées (20 identifiants au plus par appel). */
export async function statsTiktok(jeton: string, ids: readonly string[], f: Fetch = fetch): Promise<Map<string, StatsPublication>> {
  const out = new Map<string, StatsPublication>();
  for (let i = 0; i < ids.length; i += 20) {
    const lot = ids.slice(i, i + 20);
    const rep = await appelJson(f, FOURNISSEUR, URLS_TIKTOK.videos, { method: "POST", headers: entetes(jeton), body: JSON.stringify({ filters: { video_ids: lot } }) }, schemaVideos, [jeton]);
    verifierErreur(rep.error);
    for (const v of rep.data?.videos ?? []) {
      out.set(v.id, { vues: v.view_count, jaime: v.like_count, commentaires: v.comment_count, partages: v.share_count });
    }
  }
  return out;
}
