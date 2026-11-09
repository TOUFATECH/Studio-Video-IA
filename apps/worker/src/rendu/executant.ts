// Exécution de ffmpeg et ffprobe (spawn sans shell), lecture des fichiers et détection de libass et de la police.
import { spawn } from "node:child_process";
import { z } from "zod";
import { argumentsSonde } from "./arguments";

/** Erreur d'un outil externe, avec la fin de sa sortie d'erreur pour comprendre ce qui s'est passé. */
export class ErreurOutil extends Error {
  /** Crée l'erreur « ffmpeg a échoué (code 1) : … ». */
  constructor(
    public readonly outil: string,
    message: string,
    public readonly finStderr: string = "",
  ) {
    super(finStderr ? `${message} : ${finStderr}` : message);
    this.name = "ErreurOutil";
  }
}

/** Message affiché quand le filtre « subtitles » manque (ffmpeg compilé sans libass). */
export const MESSAGE_SANS_LIBASS =
  "Ce ffmpeg n'a pas libass (filtre « subtitles » absent) : les sous-titres ne peuvent pas être incrustés. Installe un ffmpeg complet (paquet ffmpeg de Debian/Ubuntu, Homebrew, ou l'image Docker du worker).";

/** Nombre de caractères de stderr conservés dans un message d'erreur. */
const FIN_STDERR = 1500;

/** Lance une commande sans shell et renvoie ses sorties ; rejette avec la fin de stderr si le code n'est pas 0. */
export function executer(commande: string, args: readonly string[], options: { signal?: AbortSignal } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resoudre, rejeter) => {
    let enfant;
    try {
      enfant = spawn(commande, [...args], { stdio: ["ignore", "pipe", "pipe"], signal: options.signal });
    } catch (e) {
      rejeter(new ErreurOutil(commande, `${commande} introuvable (${e instanceof Error ? e.message : String(e)})`));
      return;
    }
    let stdout = "";
    let stderr = "";
    enfant.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
    });
    enfant.stderr.setEncoding("utf8").on("data", (d: string) => {
      // On ne garde que la fin : ffmpeg peut être très bavard sur un long rendu.
      stderr = (stderr + d).slice(-FIN_STDERR * 4);
    });
    enfant.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") rejeter(new ErreurOutil(commande, `${commande} introuvable : installe-le ou indique son chemin (FFMPEG_PATH / FFPROBE_PATH)`));
      else if (e.name === "AbortError") rejeter(new ErreurOutil(commande, `${commande} interrompu`));
      else rejeter(new ErreurOutil(commande, `${commande} n'a pas pu démarrer (${e.message})`));
    });
    enfant.on("close", (code) => {
      if (code === 0) resoudre({ stdout, stderr });
      else rejeter(new ErreurOutil(commande, `${nomCourt(commande)} a échoué (code ${String(code)})`, stderr.trim().slice(-FIN_STDERR)));
    });
  });
}

/** Nom court d'une commande (sans le chemin). */
function nomCourt(commande: string): string {
  return commande.split(/[\\/]/).pop() ?? commande;
}

/** Lance ffmpeg avec des arguments déjà construits. */
export async function executerFfmpeg(ffmpeg: string, args: readonly string[], signal?: AbortSignal): Promise<void> {
  await executer(ffmpeg, args, { signal });
}

/** Ce que ffprobe dit d'un fichier. */
export type InfosMedia = { duree: number; largeur: number | null; hauteur: number | null; aVideo: boolean; aAudio: boolean };

const schemaSonde = z.object({
  streams: z.array(z.object({ codec_type: z.string().optional(), width: z.number().optional(), height: z.number().optional(), duration: z.string().optional() })).default([]),
  format: z.object({ duration: z.string().optional() }).optional(),
});

/** Lit durée, dimensions et pistes d'un fichier avec ffprobe. */
export async function sonder(ffprobe: string, fichier: string, signal?: AbortSignal): Promise<InfosMedia> {
  const { stdout } = await executer(ffprobe, argumentsSonde(fichier), { signal });
  let brut: unknown;
  try {
    brut = JSON.parse(stdout) as unknown;
  } catch {
    throw new ErreurOutil("ffprobe", `réponse illisible pour ${fichier}`);
  }
  const r = schemaSonde.safeParse(brut);
  if (!r.success) throw new ErreurOutil("ffprobe", `réponse inattendue pour ${fichier}`);
  const video = r.data.streams.find((s) => s.codec_type === "video");
  const audio = r.data.streams.find((s) => s.codec_type === "audio");
  const duree = Number(r.data.format?.duration ?? video?.duration ?? audio?.duration ?? "0");
  return { duree: Number.isFinite(duree) ? duree : 0, largeur: video?.width ?? null, hauteur: video?.height ?? null, aVideo: !!video, aAudio: !!audio };
}

/** Première ligne de `ffmpeg -version` (null si ffmpeg est absent). */
export async function versionOutil(chemin: string): Promise<string | null> {
  try {
    const { stdout } = await executer(chemin, ["-hide_banner", "-version"]);
    return stdout.split("\n")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Liste des filtres disponibles dans ce ffmpeg. */
export async function filtresFfmpeg(ffmpeg: string): Promise<Set<string>> {
  const { stdout } = await executer(ffmpeg, ["-hide_banner", "-filters"]);
  const noms = new Set<string>();
  for (const ligne of stdout.split("\n")) {
    // Format : « ... subtitles  V->V  Render text subtitles… » : le nom est le deuxième mot.
    const m = /^\s*[A-Z.|]{2,3}\s+(\S+)\s+\S+->\S+/.exec(ligne);
    if (m?.[1]) noms.add(m[1]);
  }
  return noms;
}

/** Vrai si ce ffmpeg sait incruster des sous-titres (libass). */
export async function aLibass(ffmpeg: string): Promise<boolean> {
  try {
    return (await filtresFfmpeg(ffmpeg)).has("subtitles");
  } catch {
    return false;
  }
}

/** Vrai si la police est installée (via fc-list) ; null si fc-list n'est pas disponible pour vérifier. */
export async function policePresente(police: string): Promise<boolean | null> {
  try {
    const { stdout } = await executer("fc-list", [":", "family"]);
    const cherche = police.toLowerCase();
    return stdout.split("\n").some((l) => l.toLowerCase().split(",").some((f) => f.trim() === cherche));
  } catch {
    return null;
  }
}
