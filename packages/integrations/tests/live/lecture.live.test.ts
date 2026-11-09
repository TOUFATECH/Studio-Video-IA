// Tests réels en lecture seule (aucune génération payante) : lancés seulement avec RUN_LIVE_TESTS=1 et la clé présente.
import { describe, expect, it } from "vitest";
import { testerElevenLabs, testerOpenAI, testerXai } from "../../src/diagnostic";

const actifs = process.env.RUN_LIVE_TESTS === "1";
const cleOpenAI = process.env.OPENAI_API_KEY ?? "";
const cleXai = process.env.XAI_API_KEY ?? "";
const cleElevenLabs = process.env.ELEVENLABS_API_KEY ?? "";

describe.skipIf(!actifs || !cleOpenAI)("OpenAI réel", () => {
  it("liste les modèles (GET /v1/models)", async () => {
    const r = await testerOpenAI(cleOpenAI);
    expect(r.ok, r.message).toBe(true);
  }, 30_000);
});

describe.skipIf(!actifs || !cleXai)("xAI réel", () => {
  it("liste les modèles (GET /v1/models)", async () => {
    const r = await testerXai(cleXai);
    expect(r.ok, r.message).toBe(true);
  }, 30_000);
});

describe.skipIf(!actifs || !cleElevenLabs)("ElevenLabs réel", () => {
  it("lit le compte (GET /v1/user)", async () => {
    const r = await testerElevenLabs(cleElevenLabs);
    expect(r.ok, r.message).toBe(true);
  }, 30_000);
});
