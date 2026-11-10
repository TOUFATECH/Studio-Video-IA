// Test d'intégration RÉEL avec ffmpeg : 3 clips de test (l'un sans audio), une voix, rendu vertical sous-titré en français.
// Ignoré proprement si ffmpeg ou ffprobe sont absents.
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plan } from "@studio-video-ia/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aLibass, executerFfmpeg, MESSAGE_SANS_LIBASS, sonder } from "../src/rendu/executant";
import { monter } from "../src/rendu/montage";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const POLICE = process.env.SUBTITLE_FONT || "Noto Sans CJK JP";

/** Vrai si l'outil répond à -version. */
function present(outil: string): boolean {
  return spawnSync(outil, ["-version"], { stdio: "ignore" }).status === 0;
}
const disponible = present(FFMPEG) && present(FFPROBE);

/** Plan minimal pour le montage. */
function plan(id: string, replique: string): Plan {
  return { id, episode_id: "e", position: 0, section: "principal", type: replique ? "dialogue" : "action", texte: "", personnage_id: replique ? "p" : null, replique, repliques_traduites: {}, duree_fixee: null, valide: true, modifie: false, prise_choisie: "A", debut: null, fin: null };
}

describe.skipIf(!disponible)("rendu réel avec ffmpeg", () => {
  let dossier = "";
  const clips: string[] = [];
  let voix = "";

  beforeAll(async () => {
    // Nom de dossier volontairement piégeux (espace, apostrophe, virgule, crochets) pour éprouver l'échappement du filtre.
    dossier = await mkdtemp(join(tmpdir(), "studio video ia rendu l'essai, [1] "));
    const genere = async (nom: string, args: string[]): Promise<string> => {
      const sortie = join(dossier, nom);
      await executerFfmpeg(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args, sortie]);
      return sortie;
    };
    // Clip 1 : 16:9 avec audio ; clip 2 : 9:16 SANS audio ; clip 3 : 16:9 avec audio, plus court que sa durée de plan.
    clips.push(await genere("clip1.mp4", ["-f", "lavfi", "-i", "testsrc=size=640x360:rate=24:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-shortest", "-c:v", "libx264", "-c:a", "aac"]));
    clips.push(await genere("clip2.mp4", ["-f", "lavfi", "-i", "testsrc=size=360x640:rate=30:duration=3", "-c:v", "libx264", "-an"]));
    clips.push(await genere("clip3.mp4", ["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=1.5", "-f", "lavfi", "-i", "sine=frequency=880:duration=1.5", "-shortest", "-c:v", "libx264", "-c:a", "aac"]));
    voix = await genere("voix.mp3", ["-f", "lavfi", "-i", "sine=frequency=220:duration=1.2", "-c:a", "libmp3lame"]);
  }, 60_000);

  afterAll(async () => {
    if (dossier) await rm(dossier, { recursive: true, force: true });
  });

  it("produit un MP4 1080x1920 de la bonne durée, avec audio et sous-titres français", async () => {
    const libass = await aLibass(FFMPEG);
    const durees = [3, 3, 2];
    const plans = [plan("a", "Où est passé le renard ?"), plan("b", ""), plan("c", "Là, derrière l'arbre : regarde !")];
    const etapes: string[] = [];
    const rendu = monter({
      ffmpeg: FFMPEG,
      ffprobe: FFPROBE,
      dossier,
      sortie: join(dossier, "rendu fr.mp4"),
      orientation: "vertical",
      plans: plans.map((p, i) => ({ plan: p, clip: clips[i] ?? "", duree: durees[i] ?? 3, voix: i === 0 ? voix : null })),
      musique: voix,
      sousTitres: { choix: "fr", langueOrigine: "fr" },
      police: POLICE,
      surEtape: (e) => etapes.push(e),
    });
    if (!libass) {
      // Sans libass, le rendu doit refuser clairement plutôt que produire une vidéo sans sous-titres.
      await expect(rendu).rejects.toThrow(MESSAGE_SANS_LIBASS);
      return;
    }
    const r = await rendu;
    expect(r.avecSousTitres).toBe(true);
    const infos = await sonder(FFPROBE, r.chemin);
    expect(Math.abs(infos.duree - 8)).toBeLessThanOrEqual(0.3);
    expect(infos.largeur).toBe(1080);
    expect(infos.hauteur).toBe(1920);
    expect(infos.aAudio).toBe(true);
    expect(etapes).toContain("Mixage et sous-titres");
  }, 120_000);

  it("refuse clairement de rendre des sous-titres avec un ffmpeg sans libass", async () => {
    // Faux ffmpeg : liste de filtres sans « subtitles », tout le reste est confié au vrai ffmpeg.
    const faux = join(dossier, "ffmpeg-sans-libass.sh");
    await writeFile(faux, `#!/bin/sh\ncase "$*" in *-filters*) echo " ... scale V->V Scale."; exit 0;; esac\nexec "${FFMPEG}" "$@"\n`);
    await chmod(faux, 0o755);
    expect(await aLibass(faux)).toBe(false);
    await expect(
      monter({
        ffmpeg: faux,
        ffprobe: FFPROBE,
        dossier,
        sortie: join(dossier, "sans-libass.mp4"),
        orientation: "vertical",
        plans: [{ plan: plan("a", "Bonjour"), clip: clips[0] ?? "", duree: 2, voix: null }],
        sousTitres: { choix: "fr", langueOrigine: "fr" },
        police: POLICE,
      }),
    ).rejects.toThrow(MESSAGE_SANS_LIBASS);
  });

  it("recadre au centre en 9:16 pour une bande annonce", async () => {
    const r = await monter({
      ffmpeg: FFMPEG,
      ffprobe: FFPROBE,
      dossier,
      sortie: join(dossier, "bande annonce.mp4"),
      orientation: "vertical",
      recadrer: true,
      plans: [{ plan: plan("x", ""), clip: clips[0] ?? "", duree: 2, voix: null }],
      sousTitres: null,
      police: POLICE,
    });
    const infos = await sonder(FFPROBE, r.chemin);
    expect(infos.largeur).toBe(1080);
    expect(infos.hauteur).toBe(1920);
    expect(Math.abs(infos.duree - 2)).toBeLessThanOrEqual(0.3);
  }, 60_000);

  it("monte un clip musical : plans de durées non entières sur l'extrait de la chanson, paroles en sous-titres", async () => {
    const libass = await aLibass(FFMPEG);
    // Chanson de test : 12 s de son, dont on garde l'extrait 2 s → 8 s.
    const chanson = join(dossier, "chanson.mp3");
    await executerFfmpeg(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=12", "-c:a", "libmp3lame", chanson]);
    const etapes: string[] = [];
    const r = await monter({
      ffmpeg: FFMPEG,
      ffprobe: FFPROBE,
      dossier,
      sortie: join(dossier, "clip musical.mp4"),
      orientation: "horizontal",
      plans: [
        { plan: { ...plan("m1", ""), debut: 2, fin: 4.6 }, clip: clips[0] ?? "", duree: 2.6, voix: null },
        { plan: { ...plan("m2", ""), debut: 4.6, fin: 8 }, clip: clips[1] ?? "", duree: 3.4, voix: null },
      ],
      chanson: { chemin: chanson, debut: 2, duree: 6 },
      reperesParoles: libass ? [{ debut: 0.5, fin: 3, texte: "On s'envole ce soir" }] : null,
      police: POLICE,
      surEtape: (e) => etapes.push(e),
    });
    const infos = await sonder(FFPROBE, r.chemin);
    expect(Math.abs(infos.duree - 6)).toBeLessThanOrEqual(0.3);
    expect(infos.largeur).toBe(1920);
    expect(infos.hauteur).toBe(1080);
    expect(infos.aAudio).toBe(true);
    expect(r.avecSousTitres).toBe(libass);
  }, 120_000);
});
