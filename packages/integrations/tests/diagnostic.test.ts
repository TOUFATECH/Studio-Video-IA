// Tests des diagnostics : messages lisibles, jamais d'exception, et outils HTTP (masquage des secrets).
import { describe, expect, it } from "vitest";
import { testerCompte, testerElevenLabs, testerOpenAI, testerXai } from "../src/diagnostic";
import { masquerSecrets, requete } from "../src/http";
import { fauxFetch, json, echec } from "./outils";

describe("diagnostic des clés", () => {
  it("OpenAI valide", async () => {
    const { f, appels } = fauxFetch(() => json({ data: [{ id: "gpt-4.1" }, { id: "gpt-image-1" }] }));
    const r = await testerOpenAI("sk-x", f);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("2 modèles");
    expect(appels[0]!.url).toBe("https://api.openai.com/v1/models");
  });
  it("OpenAI refusée : message clair, sans exception", async () => {
    const { f } = fauxFetch(() => json({ error: { message: "bad" } }, 401));
    const r = await testerOpenAI("sk-x", f);
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain("refusée");
  });
  it("xAI injoignable", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const r = await testerXai("xai-x", f);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("injoignable");
  });
  it("xAI valide", async () => {
    const { f, appels } = fauxFetch(() => json({ data: [{ id: "grok-4" }] }));
    expect((await testerXai("k", f)).ok).toBe(true);
    expect(appels[0]!.url).toBe("https://api.x.ai/v1/models");
  });
  it("ElevenLabs : caractères restants", async () => {
    const { f, appels } = fauxFetch(() => json({ subscription: { tier: "creator", character_count: 1000, character_limit: 100000 } }));
    const r = await testerElevenLabs("k", f);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("99000");
    expect(appels[0]!.url).toBe("https://api.elevenlabs.io/v1/user");
  });
  it("ElevenLabs : clé restreinte acceptée si elle liste les voix", async () => {
    const { f } = fauxFetch((a) => (a.url.endsWith("/user") ? json({ detail: { status: "missing_permissions", message: "no user_read" } }, 401) : json({ voices: [] })));
    expect((await testerElevenLabs("k", f)).ok).toBe(true);
  });
});

describe("diagnostic des comptes", () => {
  it("401 : demande de reconnecter", async () => {
    const { f } = fauxFetch(() => json({ error: { code: 401, message: "Invalid Credentials" } }, 401));
    const r = await testerCompte("youtube", "ya29.x", "UC1", f);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("reconnecte");
  });
  it("autre compte que celui enregistré", async () => {
    const { f } = fauxFetch(() => json({ data: { user: { open_id: "autre", display_name: "B" } }, error: { code: "ok" } }));
    const r = await testerCompte("tiktok", "act.x", "oid", f);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("autre compte");
  });
  it("Instagram connecté", async () => {
    const { f } = fauxFetch(() => json({ user_id: "1784", username: "studio" }));
    expect(await testerCompte("instagram", "IG", "1784", f)).toMatchObject({ ok: true });
  });
});

describe("outils HTTP", () => {
  it("masque les secrets connus et les formes de jetons", () => {
    const t = masquerSecrets("clé sk-proj-abcdef123456 et Bearer abc.def et ?access_token=XYZ&x=1 et monsecret123", ["monsecret123"]);
    expect(t).not.toContain("abcdef123456");
    expect(t).not.toContain("abc.def");
    expect(t).not.toContain("XYZ");
    expect(t).not.toContain("monsecret123");
  });
  it("une panne réseau ne divulgue pas l'URL", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND graph.instagram.com") });
    }) as typeof fetch;
    const e = await echec(requete(f, "Instagram", "https://graph.instagram.com/me?access_token=SECRET"));
    expect(e.message).toContain("connexion impossible");
    expect(e.message).not.toContain("SECRET");
  });
});
