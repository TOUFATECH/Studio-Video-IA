// Publication YouTube : envoi résumable par morceaux, programmation native (privé + publishAt) et statistiques.
import { MARGE_PROGRAMMATION_YOUTUBE_MS, type StatsPublication } from "@studio-video-ia/core";
import { z } from "zod";
import { ErreurApi, type Fetch } from "./contrat";
import { appelJson, erreurDepuisReponse, lireJson, requete, type SourceEnvoi } from "./http";

const FOURNISSEUR = "YouTube";

/** Adresse d'envoi résumable des vidéos. */
export const URL_ENVOI_YOUTUBE = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
/** Adresse de lecture des vidéos (statistiques). */
export const URL_VIDEOS_YOUTUBE = "https://www.googleapis.com/youtube/v3/videos";

/** Taille d'un morceau : 8 Mio, multiple de 256 Kio comme l'exige l'envoi résumable. */
export const TAILLE_MORCEAU_YOUTUBE = 8 * 1024 * 1024;

/** Catégorie « Divertissement ». */
export const CATEGORIE_YOUTUBE = "24";
/** Catégorie « Musique », pour les clips musicaux. */
export const CATEGORIE_YOUTUBE_MUSIQUE = "10";

/** Statut de confidentialité et date de mise en ligne programmée. */
export type StatutYoutube = { privacyStatus: "private" | "public"; publishAt?: string };

/** Paramètres d'un envoi de vidéo. */
export type ParamsEnvoiYoutube = {
  source: SourceEnvoi;
  titre: string;
  description: string;
  tags: readonly string[];
  langue: string;
  programmeeLe: Date;
  maintenant?: Date;
  /** Catégorie YouTube (Divertissement par défaut, Musique pour un clip). */
  categorie?: string;
  surProgression?: (pourcentage: number) => void;
  signal?: AbortSignal;
};

/** Résultat d'un envoi : identifiant de la vidéo et statut appliqué. */
export type ResultatEnvoiYoutube = { id: string; programmee: boolean; publishAt: string | null };

const schemaVideo = z.object({ id: z.string().min(1) });

const schemaStats = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        statistics: z.object({ viewCount: z.string().optional(), likeCount: z.string().optional(), commentCount: z.string().optional() }).optional(),
      }),
    )
    .default([]),
});

/**
 * Programmation native : si la date est à plus de 15 minutes, la vidéo part en privé avec `publishAt`
 * (YouTube la rendra publique à l'heure) ; sinon elle est publiée directement en public.
 */
export function statutYoutube(programmeeLe: Date, maintenant: Date = new Date()): StatutYoutube {
  if (programmeeLe.getTime() - maintenant.getTime() > MARGE_PROGRAMMATION_YOUTUBE_MS) {
    return { privacyStatus: "private", publishAt: programmeeLe.toISOString() };
  }
  return { privacyStatus: "public" };
}

/** Nettoie un texte pour YouTube, qui refuse les chevrons dans les titres et descriptions. */
function sansChevrons(t: string): string {
  return t.replace(/[<>]/g, "");
}

/** Coupe un titre à 100 caractères (limite YouTube), sans couper un caractère composé. */
export function titreYoutube(titre: string): string {
  const car = [...sansChevrons(titre).trim()];
  return car.length <= 100 ? car.join("") : `${car.slice(0, 99).join("").trimEnd()}…`;
}

/** Métadonnées (snippet + status) envoyées à l'ouverture de la session d'envoi. */
export function metadonneesYoutube(p: Pick<ParamsEnvoiYoutube, "titre" | "description" | "tags" | "langue" | "programmeeLe" | "maintenant" | "categorie">): Record<string, unknown> {
  // La somme des tags est limitée à 500 caractères par YouTube : on s'arrête avant.
  const tags: string[] = [];
  let longueur = 0;
  for (const t of p.tags.map((x) => x.replace(/^#/, "").trim()).filter(Boolean)) {
    if (longueur + t.length + 1 > 450) break;
    tags.push(t);
    longueur += t.length + 1;
  }
  return {
    snippet: {
      title: titreYoutube(p.titre),
      description: sansChevrons(p.description).slice(0, 4900),
      tags,
      categoryId: p.categorie ?? CATEGORIE_YOUTUBE,
      defaultLanguage: p.langue,
      defaultAudioLanguage: p.langue,
    },
    status: { ...statutYoutube(p.programmeeLe, p.maintenant ?? new Date()), selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
  };
}

/** Lit l'en-tête Range d'une réponse 308 (« bytes=0-1234 ») et renvoie le prochain octet à envoyer. */
export function prochainOctet(range: string | null): number {
  const m = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
  return m ? Number(m[2]) + 1 : 0;
}

/** Ouvre la session d'envoi résumable et renvoie son adresse (en-tête Location). */
export async function ouvrirSessionYoutube(jeton: string, p: ParamsEnvoiYoutube, f: Fetch = fetch): Promise<string> {
  const rep = await requete(f, FOURNISSEUR, URL_ENVOI_YOUTUBE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jeton}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(p.source.taille),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify(metadonneesYoutube(p)),
    signal: p.signal,
  });
  if (!rep.ok) throw await erreurDepuisReponse(FOURNISSEUR, rep, [jeton]);
  const location = rep.headers.get("location");
  if (!location) throw new ErreurApi(FOURNISSEUR, rep.status, "adresse d'envoi absente de la réponse", "sans_location");
  return location;
}

/**
 * Envoie une vidéo sur YouTube (session résumable, morceaux de 8 Mio, reprise après 308 ou erreur 5xx).
 * Renvoie l'identifiant de la vidéo et indique si elle est programmée.
 */
export async function envoyerVideoYoutube(jeton: string, p: ParamsEnvoiYoutube, f: Fetch = fetch): Promise<ResultatEnvoiYoutube> {
  const statut = statutYoutube(p.programmeeLe, p.maintenant ?? new Date());
  const session = await ouvrirSessionYoutube(jeton, p, f);
  const total = p.source.taille;
  let debut = 0;
  let echecs = 0;
  for (;;) {
    const fin = Math.min(debut + TAILLE_MORCEAU_YOUTUBE, total) - 1;
    let rep: Response;
    try {
      const morceau = await p.source.lire(debut, fin);
      rep = await requete(f, FOURNISSEUR, session, {
        method: "PUT",
        headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "video/mp4", "Content-Range": `bytes ${debut}-${fin}/${total}` },
        body: morceau,
        signal: p.signal,
      });
    } catch (e) {
      if (e instanceof ErreurApi && e.statut === 0 && echecs < 3) {
        echecs++;
        debut = await reprendre(jeton, session, total, f, p.signal);
        continue;
      }
      throw e;
    }
    if (rep.status === 308) {
      debut = prochainOctet(rep.headers.get("range"));
      echecs = 0;
      p.surProgression?.(Math.min(99, Math.round((debut / total) * 100)));
      continue;
    }
    if (rep.status >= 500 && echecs < 3) {
      // Erreur passagère de Google : on demande où en est l'envoi et on reprend de là.
      echecs++;
      debut = await reprendre(jeton, session, total, f, p.signal);
      continue;
    }
    if (!rep.ok) throw await erreurDepuisReponse(FOURNISSEUR, rep, [jeton]);
    const video = await lireJson(FOURNISSEUR, rep, schemaVideo);
    p.surProgression?.(100);
    return { id: video.id, programmee: statut.privacyStatus === "private", publishAt: statut.publishAt ?? null };
  }
}

/** Demande à YouTube combien d'octets il a reçus (PUT vide avec « bytes * / total »). */
async function reprendre(jeton: string, session: string, total: number, f: Fetch, signal?: AbortSignal): Promise<number> {
  const rep = await requete(f, FOURNISSEUR, session, { method: "PUT", headers: { Authorization: `Bearer ${jeton}`, "Content-Range": `bytes */${total}` }, signal });
  if (rep.status === 308) return prochainOctet(rep.headers.get("range"));
  throw await erreurDepuisReponse(FOURNISSEUR, rep, [jeton]);
}

/** Adresse publique d'une vidéo : format Shorts pour une vidéo verticale. */
export function urlYoutube(id: string, vertical: boolean): string {
  return vertical ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
}

/** Statistiques de vidéos (50 au plus par appel). Les partages ne sont pas fournis par YouTube. */
export async function statsYoutube(jeton: string, ids: readonly string[], f: Fetch = fetch): Promise<Map<string, StatsPublication>> {
  const out = new Map<string, StatsPublication>();
  for (let i = 0; i < ids.length; i += 50) {
    const lot = ids.slice(i, i + 50);
    const url = `${URL_VIDEOS_YOUTUBE}?${new URLSearchParams({ part: "statistics", id: lot.join(",") }).toString()}`;
    const rep = await appelJson(f, FOURNISSEUR, url, { headers: { Authorization: `Bearer ${jeton}` } }, schemaStats, [jeton]);
    for (const it of rep.items) {
      const s = it.statistics ?? {};
      out.set(it.id, {
        vues: s.viewCount !== undefined ? Number(s.viewCount) : undefined,
        jaime: s.likeCount !== undefined ? Number(s.likeCount) : undefined,
        commentaires: s.commentCount !== undefined ? Number(s.commentCount) : undefined,
      });
    }
  }
  return out;
}

/** Réponse de lecture du statut de confidentialité d'une vidéo. */
const schemaConfidentialite = z.object({ items: z.array(z.object({ id: z.string(), status: z.object({ privacyStatus: z.string(), publishAt: z.string().optional() }).optional() })) });

/**
 * Confidentialité réelle d'une vidéo après l'envoi (« public », « private », « unlisted »), ou null si introuvable.
 * Sert à repérer les vidéos que YouTube garde privées (projet Google non vérifié par l'audit YouTube API Services).
 */
export async function confidentialiteYoutube(jeton: string, id: string, f: Fetch = fetch): Promise<{ privacyStatus: string; publishAt: string | null } | null> {
  const url = `${URL_VIDEOS_YOUTUBE}?${new URLSearchParams({ part: "status", id }).toString()}`;
  const rep = await appelJson(f, FOURNISSEUR, url, { headers: { Authorization: `Bearer ${jeton}` } }, schemaConfidentialite, [jeton]);
  const s = rep.items[0]?.status;
  return s ? { privacyStatus: s.privacyStatus, publishAt: s.publishAt ?? null } : null;
}

/** Adresse d'envoi d'une miniature personnalisée. */
export const URL_MINIATURE_YOUTUBE = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";

/**
 * Envoie la miniature (JPEG, 2 Mo au plus) d'une vidéo. YouTube n'accepte les miniatures personnalisées
 * que sur une chaîne validée (vérification par téléphone) : l'appelant traite l'échec comme un simple avertissement.
 */
export async function definirMiniatureYoutube(jeton: string, videoId: string, jpeg: Uint8Array, f: Fetch = fetch): Promise<void> {
  const url = `${URL_MINIATURE_YOUTUBE}?${new URLSearchParams({ videoId }).toString()}`;
  const rep = await requete(f, FOURNISSEUR, url, {
    method: "POST",
    headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "image/jpeg" },
    body: new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }),
  });
  if (!rep.ok) throw await erreurDepuisReponse(FOURNISSEUR, rep, [jeton]);
}
