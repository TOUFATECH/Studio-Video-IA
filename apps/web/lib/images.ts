// Préparation des photos et vidéos importées : remise à l'endroit (EXIF), recadrage des bords unis, taille raisonnable,
// et image tirée d'une vidéo pour servir de référence aux IA.
import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

/** Plus grand côté d'une photo de référence (les IA d'images travaillent en 1024 à 2048 px). */
export const COTE_MAX_REFERENCE = 2048;

/**
 * Redresse une photo selon son orientation EXIF, retire les bords unis (scans, captures), la ramène à 2048 px au plus
 * et la ré-encode : JPEG pour une photo, PNG pour un logo (transparence gardée). Les métadonnées (GPS) sont retirées.
 */
export async function preparerPhoto(octets: Uint8Array, opts: { logo?: boolean } = {}): Promise<{ donnees: Buffer; extension: "jpg" | "png"; largeur: number; hauteur: number }> {
  let img = sharp(octets, { failOn: "error" }).rotate();
  // Le recadrage des bords se fait sur la photo redressée ; une image entièrement unie est gardée telle quelle.
  try {
    const rognee = await img.clone().trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
    if (rognee.info.width > 64 && rognee.info.height > 64) img = sharp(rognee.data);
  } catch {
    // Rien à rogner : on garde l'image redressée.
  }
  img = img.resize({ width: COTE_MAX_REFERENCE, height: COTE_MAX_REFERENCE, fit: "inside", withoutEnlargement: true });
  const sortie = opts.logo ? await img.png().toBuffer({ resolveWithObject: true }) : await img.flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { donnees: sortie.data, extension: opts.logo ? "png" : "jpg", largeur: sortie.info.width, hauteur: sortie.info.height };
}

/** Exécute ffmpeg/ffprobe et renvoie la sortie standard (erreur si le code de sortie n'est pas 0). */
function executer(outil: string, args: readonly string[], delaiMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(outil, args, { stdio: ["ignore", "pipe", "pipe"] });
    let sortie = "";
    let erreur = "";
    const minuteur = setTimeout(() => p.kill("SIGKILL"), delaiMs);
    p.stdout.on("data", (d: Buffer) => (sortie += d.toString()));
    p.stderr.on("data", (d: Buffer) => (erreur += d.toString()));
    p.on("error", (e) => {
      clearTimeout(minuteur);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(minuteur);
      if (code === 0) resolve(sortie);
      else reject(new Error(erreur.trim().split("\n").pop() ?? `code ${code}`));
    });
  });
}

/** Infos d'une vidéo importée : présence d'une piste vidéo et durée (null si ffprobe est absent). */
export async function sonderVideo(octets: Uint8Array, extension: string): Promise<{ video: boolean; duree: number | null } | null> {
  const dossier = await mkdtemp(join(tmpdir(), "svi-import-"));
  try {
    const entree = join(dossier, `video.${extension}`);
    await writeFile(entree, octets);
    const json = await executer(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", entree]);
    const infos = JSON.parse(json) as { streams?: { codec_type?: string }[]; format?: { duration?: string } };
    const duree = Number(infos.format?.duration);
    return { video: (infos.streams ?? []).some((s) => s.codec_type === "video"), duree: Number.isFinite(duree) ? duree : null };
  } catch {
    return null;
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
}

/** Image JPEG tirée d'une vidéo (à 1 s, ou au début si elle est plus courte), redressée ; null si ffmpeg manque. */
export async function imageDeVideo(octets: Uint8Array, extension: string): Promise<Buffer | null> {
  const dossier = await mkdtemp(join(tmpdir(), "svi-image-"));
  try {
    const entree = join(dossier, `video.${extension}`);
    const sortie = join(dossier, "image.jpg");
    await writeFile(entree, octets);
    try {
      await executer(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", entree, "-frames:v", "1", "-q:v", "3", sortie]);
    } catch {
      await executer(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", entree, "-frames:v", "1", "-q:v", "3", sortie]);
    }
    return (await preparerPhoto(await readFile(sortie))).donnees;
  } catch {
    return null;
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
}
