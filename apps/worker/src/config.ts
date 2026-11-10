// Lecture et validation des variables d'environnement du worker, avec un message clair si l'une manque.
import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

/** Version du worker, affichée dans le battement de cœur et le diagnostic. */
export const VERSION_WORKER = "0.1.0";

/** Une chaîne vide (« CLE= » dans le .env) compte comme absente. */
const texte = (defaut?: string) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), defaut === undefined ? z.string() : z.string().default(defaut));

/** Schéma des variables utilisées par le worker. */
export const schemaConfig = z.object({
  // Générée automatiquement dans le dossier des données si absente (voir @studio-video-ia/base).
  ENCRYPTION_KEY: texte().pipe(
    z.string().refine((v) => Buffer.from(v, "base64").length === 32, "doit faire 32 octets encodés en base64 (openssl rand -base64 32), la même que pour le web"),
  ),
  // Adresse du site : sert aux liens que télécharge Instagram (doit alors être publique, en https).
  APP_URL: texte("http://localhost:3000").pipe(z.string().url("doit être une adresse, ex. https://studio.mon-domaine.fr")),
  OPENAI_TEXT_MODEL: texte("gpt-4.1"),
  OPENAI_IMAGE_MODEL: texte("gpt-image-1"),
  // Qualité fixée explicitement : sans elle, le modèle choisit « auto », souvent la plus chère.
  OPENAI_IMAGE_QUALITY: texte("medium").pipe(z.enum(["low", "medium", "high"])),
  XAI_VIDEO_MODEL: texte("grok-imagine-video"),
  XAI_VIDEO_RESOLUTION: texte("720p").pipe(z.enum(["480p", "720p", "1080p"])),
  ELEVENLABS_TTS_MODEL: texte("eleven_multilingual_v2"),
  ELEVENLABS_MUSIC_MODEL: texte("music_v1"),
  ELEVENLABS_STT_MODEL: texte("scribe_v1"),
  ANTHROPIC_MODEL: texte("claude-sonnet-5-5"),
  WORKER_NAME: texte(hostname()),
  WORKER_TMP_DIR: texte("./tmp"),
  FFMPEG_PATH: texte("ffmpeg"),
  FFPROBE_PATH: texte("ffprobe"),
  SUBTITLE_FONT: texte("Noto Sans CJK JP"),
  WORKER_CONCURRENCY: texte("2").pipe(z.coerce.number().int().min(1).max(8)),
  INSTAGRAM_API_VERSION: texte("v25.0").pipe(z.string().regex(/^v\d+\.\d+$/, "format attendu : v25.0")),
});

/** Configuration validée du worker. */
export type Config = {
  cleChiffrement: string;
  adresseSite: string;
  modeles: {
    texte: string;
    image: string;
    qualiteImage: "low" | "medium" | "high";
    video: string;
    resolutionVideo: "480p" | "720p" | "1080p";
    voix: string;
    musique: string;
    transcription: string;
    claude: string;
  };
  nom: string;
  dossierTemp: string;
  ffmpeg: string;
  ffprobe: string;
  police: string;
  concurrence: number;
  versionInstagram: string;
};

/** Erreur de configuration : liste lisible des variables manquantes ou invalides. */
export class ErreurConfig extends Error {
  /** Crée l'erreur avec une ligne par variable en cause. */
  constructor(public readonly problemes: string[]) {
    super(`Configuration incomplète (fichier .env) :\n${problemes.map((p) => `  - ${p}`).join("\n")}\nCopie .env.example en .env à la racine du dépôt et remplis ces valeurs.`);
    this.name = "ErreurConfig";
  }
}

/** Lit la configuration depuis un objet d'environnement (process.env par défaut). */
export function lireConfig(env: Record<string, string | undefined> = process.env): Config {
  const r = schemaConfig.safeParse(env);
  if (!r.success) {
    throw new ErreurConfig(r.error.issues.map((i) => `${String(i.path[0] ?? "?")} : ${i.message === "Required" ? "manquante" : i.message}`));
  }
  const c = r.data;
  return {
    cleChiffrement: c.ENCRYPTION_KEY,
    adresseSite: c.APP_URL,
    modeles: { texte: c.OPENAI_TEXT_MODEL, image: c.OPENAI_IMAGE_MODEL, qualiteImage: c.OPENAI_IMAGE_QUALITY, video: c.XAI_VIDEO_MODEL, resolutionVideo: c.XAI_VIDEO_RESOLUTION,
      voix: c.ELEVENLABS_TTS_MODEL,
      musique: c.ELEVENLABS_MUSIC_MODEL,
      transcription: c.ELEVENLABS_STT_MODEL,
      claude: c.ANTHROPIC_MODEL,
    },
    nom: c.WORKER_NAME,
    dossierTemp: resolve(c.WORKER_TMP_DIR),
    ffmpeg: c.FFMPEG_PATH,
    ffprobe: c.FFPROBE_PATH,
    police: c.SUBTITLE_FONT,
    concurrence: c.WORKER_CONCURRENCY,
    versionInstagram: c.INSTAGRAM_API_VERSION,
  };
}

/** Analyse le contenu d'un fichier .env (KEY=valeur, commentaires #, guillemets simples ou doubles). */
export function analyserEnv(contenu: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ligne of contenu.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(ligne);
    if (!m?.[1]) continue;
    let v = m[2] ?? "";
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

/**
 * Charge le premier fichier .env trouvé en remontant depuis le dossier courant (jusqu'à la racine du dépôt),
 * sans écraser les variables déjà définies (celles de Docker ou du shell gardent la priorité).
 * Renvoie le chemin du fichier chargé, ou null.
 */
export function chargerFichierEnv(depart: string = process.cwd()): string | null {
  let dossier = resolve(depart);
  for (let i = 0; i < 4; i++) {
    const chemin = join(dossier, ".env");
    if (existsSync(chemin)) {
      const valeurs = analyserEnv(readFileSync(chemin, "utf8"));
      for (const [k, v] of Object.entries(valeurs)) if (process.env[k] === undefined) process.env[k] = v;
      return chemin;
    }
    const parent = dirname(dossier);
    if (parent === dossier) break;
    dossier = parent;
  }
  return null;
}
