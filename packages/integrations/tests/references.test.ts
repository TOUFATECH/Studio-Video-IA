// Tests des nouveautés du cahier des charges : références et voix Grok, transcription Grok, images jointes (vision).
import { describe, expect, it } from "vitest";
import { demanderJsonClaude } from "../src/anthropic";
import { demanderJson } from "../src/openai";
import { lancerVideo, transcrireXai } from "../src/xai";
import { fauxFetch, json } from "./outils";

const CLE = "xai-cle-secrete-abcdef0123456789";

describe("Grok Imagine Video 1.5 : références et voix", () => {
  it("envoie l'image de départ, les références et les voix, et passe en 720p", async () => {
    const { f, appels } = fauxFetch(() => json({ request_id: "req-ref" }));
    await lancerVideo(
      CLE,
      {
        modele: "grok-imagine-video-1.5",
        prompt: "<IMAGE_0> … Zaydo est <IMAGE_1> ; le salon est <IMAGE_2>. Zaydo dit avec la voix <AUDIO_0> : « Assieds-toi »",
        duree: 4,
        ratio: "9:16",
        resolution: "1080p",
        genererAudio: true,
        urlImage: "data:image/png;base64,AAAA",
        references: ["data:image/png;base64,BBBB", "data:image/jpeg;base64,CCCC"],
        voix: ["leo"],
      },
      f,
    );
    const corps = appels[0]?.corps as Record<string, unknown>;
    expect(corps.image).toEqual({ url: "data:image/png;base64,AAAA" });
    expect(corps.reference_images).toEqual([{ url: "data:image/png;base64,BBBB" }, { url: "data:image/jpeg;base64,CCCC" }]);
    expect(corps.reference_audios).toEqual([{ voice_id: "leo" }]);
    expect(corps.resolution).toBe("720p");
    expect(corps.generate_audio).toBe(true);
  });

  it("limite à 14 références et 3 voix, et garde 1080p sans référence", async () => {
    const { f, appels } = fauxFetch(() => json({ request_id: "r" }));
    const refs = Array.from({ length: 20 }, (_, i) => `data:image/png;base64,${i}`);
    await lancerVideo(CLE, { modele: "m", prompt: "p", duree: 2, ratio: "9:16", resolution: "1080p", genererAudio: true, urlImage: null, references: refs, voix: ["a", "b", "c", "d"] }, f);
    const corps = appels[0]?.corps as { reference_images: unknown[]; reference_audios: unknown[] };
    expect(corps.reference_images).toHaveLength(14);
    expect(corps.reference_audios).toHaveLength(3);
    await lancerVideo(CLE, { modele: "m", prompt: "p", duree: 2, ratio: "9:16", resolution: "1080p", genererAudio: false, urlImage: "x" }, f);
    expect((appels[1]?.corps as Record<string, unknown>).resolution).toBe("1080p");
    expect(appels[1]?.corps).not.toHaveProperty("reference_images");
  });
});

describe("Grok Speech to Text", () => {
  it("transcrit avec le minutage des mots, options avant le fichier", async () => {
    const { f, appels } = fauxFetch(() => json({ text: "On s'envole ce soir", language: "fr", duration: 3.2, words: [{ text: "On", start: 0.1, end: 0.3 }, { text: "s'envole", start: 0.3, end: 0.9 }] }));
    const r = await transcrireXai(CLE, { audio: new Uint8Array([1, 2, 3]), nom: "chanson.mp3", langue: "fr" }, f);
    expect(r.mots).toEqual([
      { texte: "On", debut: 0.1, fin: 0.3 },
      { texte: "s'envole", debut: 0.3, fin: 0.9 },
    ]);
    expect(r.duree).toBe(3.2);
    const a = appels[0]!;
    expect(a.url).toBe("https://api.x.ai/v1/stt");
    const form = a.corps as FormData;
    expect([...form.keys()]).toEqual(["model", "format", "language", "file"]);
    expect(form.get("model")).toBe("grok-stt");
  });
});

describe("Vision : images jointes au contrôle qualité", () => {
  it("OpenAI : ajoute les images au message de l'utilisateur", async () => {
    const { f, appels } = fauxFetch(() => json({ choices: [{ message: { content: '{"statut":"ok","raisons":[]}' } }] }));
    const r = await demanderJson("sk", "gpt", { system: "s", user: "u" }, (await import("zod")).z.object({ statut: (await import("zod")).z.string() }), f, [{ type: "image/png", donnees: new Uint8Array([9]) }]);
    expect(r.statut).toBe("ok");
    const messages = (appels[0]?.corps as { messages: { role: string; content: unknown }[] }).messages;
    const parties = messages[1]?.content as { type: string; image_url?: { url: string } }[];
    expect(parties[0]).toEqual({ type: "text", text: "u" });
    expect(parties[1]?.image_url?.url).toBe("data:image/png;base64,CQ==");
  });

  it("Claude : met les images avant le texte", async () => {
    const { z } = await import("zod");
    const { f, appels } = fauxFetch(() => json({ content: [{ type: "text", text: '{"statut":"douteux","raisons":["visage éclairci"]}' }], stop_reason: "end_turn" }));
    const r = await demanderJsonClaude("cle", "claude", { system: "s", user: "u" }, z.object({ statut: z.string(), raisons: z.array(z.string()) }), f, [{ type: "image/jpeg", donnees: new Uint8Array([1]) }]);
    expect(r.raisons).toEqual(["visage éclairci"]);
    const contenu = (appels[0]?.corps as { messages: { content: { type: string }[] }[] }).messages[0]?.content;
    expect(contenu?.map((b) => b.type)).toEqual(["image", "text"]);
  });
});
