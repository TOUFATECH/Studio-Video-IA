// Client xAI (Grok) : génération de clips vidéo à partir d'une image, suivi de la génération et téléchargement immédiat.
import { z } from "zod";
import { ErreurApi, type Fetch } from "./contrat";
import { appelJson, attendre as attendreReel, erreurReponseInvalide, lireOctets, requete, type Attendre } from "./http";

/** Adresse de base de l'API xAI. */
export const BASE_XAI = "https://api.x.ai/v1";
const FOURNISSEUR = "xAI";

/** Résolutions vidéo acceptées par Grok. */
export type ResolutionVideo = "480p" | "720p" | "1080p";
/** Ratios utilisés : vertical pour les courts et génériques, horizontal pour les films. */
export type RatioVideo = "9:16" | "16:9";

/** Paramètres d'une génération de clip. */
export type ParamsVideo = {
  modele: string;
  prompt: string;
  /** Durée en secondes (1 à 15). */
  duree: number;
  ratio: RatioVideo;
  resolution: ResolutionVideo;
  /** Audio généré par Grok (vrai par défaut côté API). */
  genererAudio: boolean;
  /** URL publique de l'image de départ (URL signée Supabase). */
  urlImage: string | null;
};

/** Options du suivi : intervalle et délai maximal (paramétrables pour les tests). */
export type OptionsSuivi = { intervalleMs?: number; delaiMaxMs?: number; attendre?: Attendre; signal?: AbortSignal; surAttente?: (secondes: number) => void };

/** Codes d'erreur documentés par xAI. */
export const CODES_ERREUR_XAI = ["invalid_argument", "permission_denied", "failed_precondition", "service_unavailable", "internal_error"] as const;

const schemaLancement = z.object({ request_id: z.string().min(1) });

/** Réponse du suivi d'une génération. */
export const schemaSuiviVideo = z.object({
  status: z.string(),
  video: z
    .object({ url: z.string().url(), duration: z.number().optional(), respect_moderation: z.boolean().optional() })
    .nullish(),
  model: z.string().optional(),
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).nullish(),
});
/** État d'une génération vidéo. */
export type SuiviVideo = z.infer<typeof schemaSuiviVideo>;

const schemaModeles = z.object({ data: z.array(z.object({ id: z.string() })) });

/** En-têtes d'authentification. */
function entetes(cle: string): Record<string, string> {
  return { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" };
}

/** Traduit un code d'erreur xAI en explication française. */
export function expliquerErreurXai(code: string | undefined, message: string | undefined): string {
  const m = message ? ` (${message})` : "";
  switch (code) {
    case "invalid_argument":
      return `paramètre refusé par Grok${m}`;
    case "permission_denied":
      return `accès refusé : vérifie la clé xAI et les droits vidéo du compte${m}`;
    case "failed_precondition":
      return `génération refusée, souvent par la modération : reformule le plan ou change l'image${m}`;
    case "service_unavailable":
      return `Grok est momentanément indisponible, réessaie plus tard${m}`;
    case "internal_error":
      return `erreur interne de Grok${m}`;
    default:
      return `génération échouée${m}`;
  }
}

/** Lance la génération d'un clip. Renvoie l'identifiant de la requête à suivre. */
export async function lancerVideo(cle: string, p: ParamsVideo, f: Fetch = fetch): Promise<string> {
  const duree = Math.round(p.duree);
  if (duree < 1 || duree > 15) throw new Error(`Durée de clip invalide (${p.duree} s) : Grok accepte de 1 à 15 secondes.`);
  const corps: Record<string, unknown> = {
    model: p.modele,
    prompt: p.prompt,
    duration: duree,
    aspect_ratio: p.ratio,
    resolution: p.resolution,
    generate_audio: p.genererAudio,
  };
  if (p.urlImage) corps.image = { url: p.urlImage };
  const rep = await appelJson(f, FOURNISSEUR, `${BASE_XAI}/videos/generations`, { method: "POST", headers: entetes(cle), body: JSON.stringify(corps) }, schemaLancement, [cle, p.urlImage]);
  return rep.request_id;
}

/** Lit l'état d'une génération. */
export async function lireVideo(cle: string, idRequete: string, f: Fetch = fetch): Promise<SuiviVideo> {
  return appelJson(f, FOURNISSEUR, `${BASE_XAI}/videos/${encodeURIComponent(idRequete)}`, { method: "GET", headers: { Authorization: `Bearer ${cle}` } }, schemaSuiviVideo, [cle]);
}

/**
 * Attend la fin d'une génération (toutes les 5 s, 10 min au plus par défaut).
 * Renvoie l'URL temporaire de la vidéo, à télécharger immédiatement.
 */
export async function attendreVideo(cle: string, idRequete: string, options: OptionsSuivi = {}, f: Fetch = fetch): Promise<{ url: string; duree: number | null }> {
  const intervalle = options.intervalleMs ?? 5000;
  const delaiMax = options.delaiMaxMs ?? 10 * 60_000;
  const dormir = options.attendre ?? attendreReel;
  const debut = Date.now();
  let ecoule = 0;
  for (;;) {
    const s = await lireVideo(cle, idRequete, f);
    if (s.status === "done") {
      if (!s.video) throw erreurReponseInvalide(FOURNISSEUR, "génération terminée sans vidéo");
      if (s.video.respect_moderation === false) {
        throw new ErreurApi(FOURNISSEUR, 400, "clip refusé par la modération de Grok : reformule le plan ou change l'image", "moderation");
      }
      return { url: s.video.url, duree: s.video.duration ?? null };
    }
    if (s.status === "failed" || s.status === "expired") {
      throw new ErreurApi(FOURNISSEUR, 422, expliquerErreurXai(s.error?.code, s.error?.message), s.error?.code ?? s.status);
    }
    // Le temps réel et le temps cumulé des attentes : le second rend le délai testable avec une fausse horloge.
    ecoule = Math.max(ecoule + intervalle, Date.now() - debut);
    if (ecoule > delaiMax) throw new ErreurApi(FOURNISSEUR, 408, `génération toujours en cours après ${Math.round(delaiMax / 60000)} min`, "delai_depasse");
    options.surAttente?.(Math.round(ecoule / 1000));
    await dormir(intervalle, options.signal);
  }
}

/** Télécharge une vidéo depuis son URL temporaire. */
export async function telechargerVideo(url: string, f: Fetch = fetch): Promise<Buffer> {
  const rep = await requete(f, FOURNISSEUR, url, { method: "GET" });
  return lireOctets(FOURNISSEUR, rep, [url]);
}

/** Génère un clip de bout en bout : lancement, suivi, téléchargement. Renvoie le MP4 en mémoire. */
export async function genererVideo(cle: string, p: ParamsVideo, options: OptionsSuivi = {}, f: Fetch = fetch): Promise<{ video: Buffer; duree: number | null; idRequete: string }> {
  const idRequete = await lancerVideo(cle, p, f);
  const { url, duree } = await attendreVideo(cle, idRequete, options, f);
  // L'URL de xAI est temporaire : on télécharge tout de suite, avant toute autre opération.
  const video = await telechargerVideo(url, f);
  return { video, duree, idRequete };
}

/** Liste les modèles accessibles avec la clé (sert au diagnostic). */
export async function listerModelesXai(cle: string, f: Fetch = fetch): Promise<string[]> {
  const rep = await appelJson(f, FOURNISSEUR, `${BASE_XAI}/models`, { method: "GET", headers: { Authorization: `Bearer ${cle}` } }, schemaModeles, [cle]);
  return rep.data.map((m) => m.id);
}
