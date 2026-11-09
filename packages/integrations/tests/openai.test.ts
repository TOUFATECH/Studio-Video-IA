// Tests du client OpenAI avec un fetch simulé : JSON validé, relance, images, erreurs.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ErreurApi } from "../src/contrat";
import { demanderJson, genererImage, modifierImage } from "../src/openai";
import { fauxFetch, json, echec } from "./outils";

const CLE = "sk-test-cle-secrete-0123456789";
const schema = z.object({ titre: z.string(), plans: z.array(z.string()).min(1) });

/** Réponse de chat contenant un texte. */
function reponseChat(contenu: string): Response {
  return json({ choices: [{ message: { content: contenu, refusal: null }, finish_reason: "stop" }] });
}

describe("OpenAI : demanderJson", () => {
  it("envoie le bon corps et valide la réponse", async () => {
    const { f, appels } = fauxFetch(() => reponseChat(JSON.stringify({ titre: "Le pont", plans: ["a"] })));
    const r = await demanderJson(CLE, "gpt-4.1", { system: "sys", user: "usr" }, schema, f);
    expect(r).toEqual({ titre: "Le pont", plans: ["a"] });
    expect(appels).toHaveLength(1);
    const a = appels[0]!;
    expect(a.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(a.methode).toBe("POST");
    expect(a.entetes.authorization?.startsWith("Bearer ")).toBe(true);
    expect(a.entetes["content-type"]).toBe("application/json");
    expect(a.corps).toMatchObject({
      model: "gpt-4.1",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
      ],
    });
  });

  it("relance une fois si le JSON ne respecte pas le schéma", async () => {
    const { f, appels } = fauxFetch((_, rang) => (rang === 0 ? reponseChat('{"titre": 3}') : reponseChat('{"titre":"ok","plans":["x"]}')));
    const r = await demanderJson(CLE, "m", { system: "s", user: "u" }, schema, f);
    expect(r.titre).toBe("ok");
    expect(appels).toHaveLength(2);
    const messages = (appels[1]!.corps as { messages: { role: string; content: string }[] }).messages;
    expect(messages).toHaveLength(4);
    expect(messages[2]).toEqual({ role: "assistant", content: '{"titre": 3}' });
    expect(messages[3]?.content).toContain("invalide");
  });

  it("échoue après une seule relance", async () => {
    const { f, appels } = fauxFetch(() => reponseChat("pas du json"));
    await expect(demanderJson(CLE, "m", { system: "s", user: "u" }, schema, f)).rejects.toMatchObject({ code: "reponse_invalide" });
    expect(appels).toHaveLength(2);
  });

  it("convertit un 401 en ErreurApi sans divulguer la clé", async () => {
    const { f } = fauxFetch(() => json({ error: { message: `Incorrect API key provided: ${CLE}`, code: "invalid_api_key" } }, 401));
    const e = await echec(demanderJson(CLE, "m", { system: "s", user: "u" }, schema, f));
    expect(e).toBeInstanceOf(ErreurApi);
    const err = e as ErreurApi;
    expect(err.statut).toBe(401);
    expect(err.code).toBe("invalid_api_key");
    expect(err.message).not.toContain(CLE);
    expect(err.message).toContain("OpenAI 401");
  });

  it("signale un 429", async () => {
    const { f } = fauxFetch(() => json({ error: { message: "Rate limit reached", type: "requests" } }, 429));
    await expect(demanderJson(CLE, "m", { system: "s", user: "u" }, schema, f)).rejects.toMatchObject({ statut: 429, fournisseur: "OpenAI" });
  });

  it("refuse une réponse de forme inattendue", async () => {
    const { f } = fauxFetch(() => json({ autre: true }));
    await expect(demanderJson(CLE, "m", { system: "s", user: "u" }, schema, f)).rejects.toMatchObject({ statut: 502, code: "reponse_invalide" });
  });
});

describe("OpenAI : images", () => {
  const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);

  it("génère une image verticale", async () => {
    const { f, appels } = fauxFetch(() => json({ data: [{ b64_json: png.toString("base64") }] }));
    const r = await genererImage(CLE, { modele: "gpt-image-1", prompt: "un chat", taille: "1024x1536", qualite: "low" }, f);
    expect(r.equals(png)).toBe(true);
    expect(appels[0]!.url).toBe("https://api.openai.com/v1/images/generations");
    expect(appels[0]!.corps).toEqual({ model: "gpt-image-1", prompt: "un chat", size: "1024x1536", n: 1, quality: "low" });
  });

  it("envoie les références en multipart image[]", async () => {
    const { f, appels } = fauxFetch(() => json({ data: [{ b64_json: png.toString("base64") }] }));
    await modifierImage(
      CLE,
      {
        modele: "gpt-image-1",
        prompt: "scène",
        taille: "1536x1024",
        references: [
          { nom: "fiche.png", donnees: png },
          { nom: "precedent.png", donnees: png },
        ],
      },
      f,
    );
    const a = appels[0]!;
    expect(a.url).toBe("https://api.openai.com/v1/images/edits");
    expect(a.entetes["content-type"]).toBeUndefined();
    expect(a.corps).toBeInstanceOf(FormData);
    const form = a.corps as FormData;
    expect(form.get("model")).toBe("gpt-image-1");
    expect(form.get("size")).toBe("1536x1024");
    expect(form.getAll("image[]")).toHaveLength(2);
    const premier = form.getAll("image[]")[0] as File;
    expect(premier.name).toBe("fiche.png");
    expect(premier.type).toBe("image/png");
  });

  it("refuse une réponse sans image", async () => {
    const { f } = fauxFetch(() => json({ data: [] }));
    await expect(genererImage(CLE, { modele: "m", prompt: "p", taille: "1024x1024" }, f)).rejects.toMatchObject({ code: "reponse_invalide" });
  });
});
