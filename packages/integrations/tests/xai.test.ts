// Tests du client xAI : lancement d'un clip, suivi pending → done, téléchargement, modération et erreurs.
import { describe, expect, it } from "vitest";
import { genererVideo, lancerVideo, attendreVideo } from "../src/xai";
import { fauxFetch, json, octets, sansAttente, echec } from "./outils";

const CLE = "xai-cle-secrete-abcdef0123456789";
const PARAMS = {
  modele: "grok-imagine-video",
  prompt: "Un renard court dans la neige",
  duree: 5,
  ratio: "9:16" as const,
  resolution: "720p" as const,
  genererAudio: false,
  urlImage: "https://exemple.supabase.co/storage/v1/object/sign/medias/a.png?token=abc",
};

describe("xAI : vidéo", () => {
  it("lance une génération avec le bon corps", async () => {
    const { f, appels } = fauxFetch(() => json({ request_id: "req-1" }));
    expect(await lancerVideo(CLE, PARAMS, f)).toBe("req-1");
    const a = appels[0]!;
    expect(a.url).toBe("https://api.x.ai/v1/videos/generations");
    expect(a.methode).toBe("POST");
    expect(a.entetes.authorization).toBe(`Bearer ${CLE}`);
    expect(a.corps).toEqual({
      model: "grok-imagine-video",
      prompt: PARAMS.prompt,
      duration: 5,
      aspect_ratio: "9:16",
      resolution: "720p",
      generate_audio: false,
      image: { url: PARAMS.urlImage },
    });
  });

  it("refuse une durée hors de 1 à 15 s sans appeler l'API", async () => {
    const { f, appels } = fauxFetch(() => json({}));
    await expect(lancerVideo(CLE, { ...PARAMS, duree: 20 }, f)).rejects.toThrow(/1 à 15/);
    expect(appels).toHaveLength(0);
  });

  it("suit pending → done puis télécharge la vidéo tout de suite", async () => {
    const mp4 = Buffer.from("faux mp4");
    const attentes: number[] = [];
    const { f, appels } = fauxFetch((a, rang) => {
      if (rang === 0) return json({ request_id: "req-2" });
      if (a.url === "https://api.x.ai/v1/videos/req-2" && rang < 3) return json({ status: "pending", model: "grok-imagine-video" });
      if (a.url === "https://api.x.ai/v1/videos/req-2") return json({ status: "done", video: { url: "https://vidgen.x.ai/temp/abc.mp4", duration: 5, respect_moderation: true } });
      return octets(mp4, "video/mp4");
    });
    const r = await genererVideo(CLE, PARAMS, { attendre: async (ms) => void attentes.push(ms) }, f);
    expect(r.video.equals(mp4)).toBe(true);
    expect(r.duree).toBe(5);
    expect(attentes).toEqual([5000, 5000]);
    expect(appels.map((a) => a.methode)).toEqual(["POST", "GET", "GET", "GET", "GET"]);
    expect(appels[4]!.url).toBe("https://vidgen.x.ai/temp/abc.mp4");
  });

  it("signale un refus de modération", async () => {
    const { f } = fauxFetch(() => json({ status: "done", video: { url: "https://v.x.ai/a.mp4", respect_moderation: false } }));
    await expect(attendreVideo(CLE, "r", { attendre: sansAttente }, f)).rejects.toMatchObject({ code: "moderation" });
  });

  it("traduit un échec failed_precondition", async () => {
    const { f } = fauxFetch(() => json({ status: "failed", error: { code: "failed_precondition", message: "blocked" } }));
    const e = await echec(attendreVideo(CLE, "r", { attendre: sansAttente }, f));
    expect(e).toMatchObject({ code: "failed_precondition" });
    expect((e as Error).message).toContain("modération");
  });

  it("abandonne après le délai maximal", async () => {
    const { f } = fauxFetch(() => json({ status: "pending" }));
    await expect(attendreVideo(CLE, "r", { attendre: sansAttente, intervalleMs: 5000, delaiMaxMs: 20_000 }, f)).rejects.toMatchObject({ code: "delai_depasse" });
  });

  it("convertit un 401 et un 429 en ErreurApi sans la clé", async () => {
    for (const statut of [401, 429]) {
      const { f } = fauxFetch(() => json({ code: "x", error: `Bad key ${CLE}` }, statut));
      const e = await echec(lancerVideo(CLE, PARAMS, f));
      expect(e).toMatchObject({ statut, fournisseur: "xAI" });
      expect((e as Error).message).not.toContain(CLE);
    }
  });

  it("refuse une réponse de lancement invalide", async () => {
    const { f } = fauxFetch(() => json({ id: 3 }));
    await expect(lancerVideo(CLE, PARAMS, f)).rejects.toMatchObject({ code: "reponse_invalide" });
  });
});
