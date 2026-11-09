// Tests du client ElevenLabs : voix, bruitages, liste des voix, clonage et erreurs.
import { describe, expect, it } from "vitest";
import { clonerVoix, genererBruitage, listerVoix, synthetiserVoix } from "../src/elevenlabs";
import { fauxFetch, json, octets, echec } from "./outils";

const CLE = "el-cle-secrete-0123456789abcdef";
const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x64]);

describe("ElevenLabs", () => {
  it("synthétise une réplique sans language_code", async () => {
    const { f, appels } = fauxFetch(() => octets(MP3));
    const r = await synthetiserVoix(CLE, { voixId: "voix 1", texte: "Bonjour" }, f);
    expect(r.equals(MP3)).toBe(true);
    const a = appels[0]!;
    expect(a.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voix%201?output_format=mp3_44100_128");
    expect(a.methode).toBe("POST");
    expect(a.entetes["xi-api-key"]).toBe(CLE);
    expect(a.entetes.authorization).toBeUndefined();
    expect(a.corps).toEqual({ text: "Bonjour", model_id: "eleven_multilingual_v2" });
  });

  it("borne la durée d'un bruitage entre 0,5 et 30 s", async () => {
    const { f, appels } = fauxFetch(() => octets(MP3));
    await genererBruitage(CLE, { texte: "pluie", duree: 90 }, f);
    await genererBruitage(CLE, { texte: "pluie", duree: 0.1 }, f);
    expect(appels[0]!.url).toBe("https://api.elevenlabs.io/v1/sound-generation");
    expect(appels[0]!.corps).toEqual({ text: "pluie", duration_seconds: 30 });
    expect(appels[1]!.corps).toEqual({ text: "pluie", duration_seconds: 0.5 });
  });

  it("liste les voix", async () => {
    const { f, appels } = fauxFetch(() => json({ voices: [{ voice_id: "a", name: "Rachel", category: "premade" }, { voice_id: "b", name: "Moi", category: null }] }));
    expect(await listerVoix(CLE, f)).toEqual([
      { id: "a", nom: "Rachel", categorie: "premade" },
      { id: "b", nom: "Moi", categorie: "inconnue" },
    ]);
    expect(appels[0]!.url).toBe("https://api.elevenlabs.io/v1/voices");
  });

  it("clone une voix en multipart avec plusieurs fichiers", async () => {
    const { f, appels } = fauxFetch(() => json({ voice_id: "clone-1", requires_verification: false }));
    const id = await clonerVoix(CLE, { nom: "Kaï", description: "voix douce", echantillons: [{ nom: "a.mp3", donnees: MP3 }, { nom: "b.mp3", donnees: MP3 }] }, f);
    expect(id).toBe("clone-1");
    const form = appels[0]!.corps as FormData;
    expect(appels[0]!.url).toBe("https://api.elevenlabs.io/v1/voices/add");
    expect(form.get("name")).toBe("Kaï");
    expect(form.getAll("files")).toHaveLength(2);
  });

  it("lit le message d'erreur detail et ne divulgue pas la clé", async () => {
    const { f } = fauxFetch(() => json({ detail: { status: "quota_exceeded", message: `Quota dépassé pour ${CLE}` } }, 401));
    const e = await echec(synthetiserVoix(CLE, { voixId: "v", texte: "t" }, f));
    expect(e).toMatchObject({ statut: 401, code: "quota_exceeded" });
    expect(e.message).not.toContain(CLE);
  });

  it("signale un 429", async () => {
    const { f } = fauxFetch(() => json({ detail: { status: "too_many_concurrent_requests", message: "Trop de requêtes" } }, 429));
    await expect(genererBruitage(CLE, { texte: "x", duree: 3 }, f)).rejects.toMatchObject({ statut: 429 });
  });

  it("refuse un JSON reçu à la place de l'audio", async () => {
    const { f } = fauxFetch(() => json({ ok: true }));
    await expect(synthetiserVoix(CLE, { voixId: "v", texte: "t" }, f)).rejects.toMatchObject({ code: "reponse_invalide" });
  });
});
