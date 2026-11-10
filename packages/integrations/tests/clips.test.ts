// Tests des API des clips musicaux : alignement des paroles, transcription, musique (ElevenLabs) et Claude (Anthropic).
import { describe, expect, it } from "vitest";
import { demanderJsonClaude, extraireJson, listerModelesAnthropic } from "../src/anthropic";
import { testerAnthropic } from "../src/diagnostic";
import { alignerParoles, composerMusique, transcrireAudio } from "../src/elevenlabs";
import { metadonneesYoutube } from "../src/youtube";
import { z } from "zod";
import { echec, fauxFetch, json, octets, texteAppels } from "./outils";

const CLE_EL = "el-cle-secrete-0123456789abcdef";
const CLE_CLAUDE = "sk-ant-api03-secretsecretsecret0123456789";
const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
const AUDIO = { nom: "chanson.mp3", donnees: MP3 };

describe("ElevenLabs pour les clips", () => {
  it("aligne les paroles en multipart file + text", async () => {
    const { f, appels } = fauxFetch(() => json({ characters: [{ text: "a", start: 0, end: 0.1 }], words: [{ text: "Bonjour", start: 0.5, end: 1.1, loss: 0.2 }], loss: 0.3 }));
    const r = await alignerParoles(CLE_EL, { audio: AUDIO, texte: "Bonjour" }, f);
    expect(r.words[0]).toEqual({ text: "Bonjour", start: 0.5, end: 1.1, loss: 0.2 });
    const a = appels[0]!;
    expect(a.url).toBe("https://api.elevenlabs.io/v1/forced-alignment");
    expect(a.entetes["xi-api-key"]).toBe(CLE_EL);
    expect(a.entetes["content-type"]).toBeUndefined();
    const form = a.corps as FormData;
    expect(form.get("text")).toBe("Bonjour");
    expect((form.get("file") as File).name).toBe("chanson.mp3");
  });

  it("refuse d'aligner des paroles vides sans appeler l'API", async () => {
    const { f, appels } = fauxFetch(() => json({}));
    await expect(alignerParoles(CLE_EL, { audio: AUDIO, texte: "  " }, f)).rejects.toThrow("Paroles vides");
    expect(appels).toHaveLength(0);
  });

  it("transcrit mot à mot avec la langue et sans événements sonores", async () => {
    const { f, appels } = fauxFetch(() =>
      json({ language_code: "fra", text: "Bonjour toi", words: [{ text: "Bonjour", start: 0, end: 0.5, type: "word" }, { text: " ", start: 0.5, end: 0.6, type: "spacing" }, { text: "toi", start: 0.6, end: 1, type: "word" }] }),
    );
    const r = await transcrireAudio(CLE_EL, { audio: AUDIO, langue: "fr" }, f);
    expect(r.texte).toBe("Bonjour toi");
    expect(r.mots).toHaveLength(3);
    const form = appels[0]!.corps as FormData;
    expect(appels[0]!.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(form.get("model_id")).toBe("scribe_v1");
    expect(form.get("timestamps_granularity")).toBe("word");
    expect(form.get("tag_audio_events")).toBe("false");
    expect(form.get("language_code")).toBe("fr");
  });

  it("compose une musique avec un plan de composition (music_v1)", async () => {
    const { f, appels } = fauxFetch(() => octets(MP3));
    const plan = { positive_global_styles: ["pop"], negative_global_styles: [], sections: [{ section_name: "Refrain", positive_local_styles: [], negative_local_styles: [], duration_ms: 10000, lines: ["On s'envole"] }] };
    const r = await composerMusique(CLE_EL, { plan }, f);
    expect(r.equals(MP3)).toBe(true);
    expect(appels[0]!.url).toBe("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192");
    expect(appels[0]!.corps).toEqual({ model_id: "music_v1", composition_plan: plan, respect_sections_durations: true });
  });

  it("rend lisible un refus de prompt musical", async () => {
    const { f } = fauxFetch(() => json({ detail: { status: "bad_prompt", message: "The prompt mentions an artist name." } }, 400));
    const plan = { positive_global_styles: ["pop"], negative_global_styles: [], sections: [{ section_name: "A", positive_local_styles: [], negative_local_styles: [], duration_ms: 5000, lines: [] }] };
    const e = await echec(composerMusique(CLE_EL, { plan }, f));
    expect(e.message).toBe("ElevenLabs 400 : The prompt mentions an artist name.");
  });
});

describe("Claude (Anthropic)", () => {
  const schema = z.object({ titre: z.string() });

  it("envoie la clé, la version d'API et le prompt système, puis valide le JSON", async () => {
    const { f, appels } = fauxFetch(() => json({ content: [{ type: "text", text: '```json\n{"titre":"Envol"}\n```' }], stop_reason: "end_turn" }));
    const r = await demanderJsonClaude(CLE_CLAUDE, "claude-sonnet-5-5", { system: "Tu es réalisateur.", user: "Écris." }, schema, f);
    expect(r).toEqual({ titre: "Envol" });
    const a = appels[0]!;
    expect(a.url).toBe("https://api.anthropic.com/v1/messages");
    expect(a.entetes["x-api-key"]).toBe(CLE_CLAUDE);
    expect(a.entetes["anthropic-version"]).toBe("2023-06-01");
    const corps = a.corps as { model: string; system: string; messages: { role: string; content: string }[]; max_tokens: number };
    expect(corps.model).toBe("claude-sonnet-5-5");
    expect(corps.system).toContain("Tu es réalisateur.");
    expect(corps.messages).toEqual([{ role: "user", content: "Écris." }]);
    expect(corps.max_tokens).toBeGreaterThan(1000);
  });

  it("relance une fois si le JSON est invalide", async () => {
    const { f, appels } = fauxFetch((_, rang) => json({ content: [{ type: "text", text: rang === 0 ? "Voici : pas de JSON" : '{"titre":"Ok"}' }], stop_reason: "end_turn" }));
    expect(await demanderJsonClaude(CLE_CLAUDE, "m", { system: "s", user: "u" }, schema, f)).toEqual({ titre: "Ok" });
    const corps = appels[1]!.corps as { messages: { role: string }[] };
    expect(corps.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("extrait le JSON entouré de texte", () => {
    expect(extraireJson('Voici le résultat : {"a": {"b": 1}} Bonne journée')).toBe('{"a": {"b": 1}}');
  });

  it("teste la clé sans jamais la laisser fuiter dans le message", async () => {
    const { f, appels } = fauxFetch(() => json({ data: [{ id: "claude-sonnet-5-5" }, { id: "claude-opus-5-5" }] }));
    expect(await listerModelesAnthropic(CLE_CLAUDE, f)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(appels[0]!.url).toBe("https://api.anthropic.com/v1/models");
    const { f: f401 } = fauxFetch(() => json({ type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${CLE_CLAUDE}` } }, 401));
    const r = await testerAnthropic(CLE_CLAUDE, f401);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("refusée (401)");
    expect(r.message).not.toContain(CLE_CLAUDE);
    expect(texteAppels(appels)).not.toContain(CLE_CLAUDE);
  });
});

describe("YouTube pour les clips", () => {
  it("range un clip dans la catégorie Musique, le reste en Divertissement", () => {
    const base = { titre: "Envol (Clip officiel)", description: "", tags: [], langue: "fr", programmeeLe: new Date("2026-01-01"), maintenant: new Date("2026-01-01") };
    const snippet = (m: Record<string, unknown>) => m.snippet as { categoryId: string };
    expect(snippet(metadonneesYoutube({ ...base, categorie: "10" })).categoryId).toBe("10");
    expect(snippet(metadonneesYoutube(base)).categoryId).toBe("24");
  });
});
