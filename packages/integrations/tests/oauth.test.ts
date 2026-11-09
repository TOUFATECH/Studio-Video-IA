// Tests de la connexion OAuth : URL d'autorisation, échange du code et renouvellement pour chaque réseau.
import { describe, expect, it } from "vitest";
import { doitRenouveler, echangerCode, renouvelerJeton, urlAutorisation } from "../src/oauth";
import { fauxFetch, json, texteAppels, echec } from "./outils";

const APP = { client_id: "id-app-123", client_secret: "secret-app-tres-long-987654" };
const RETOUR = "https://studio.exemple/api/oauth/retour";

describe("URL d'autorisation", () => {
  it("YouTube : accès hors ligne, consentement forcé, deux scopes", () => {
    const u = new URL(urlAutorisation("youtube", APP, RETOUR, "etat-1"));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe(APP.client_id);
    expect(u.searchParams.get("redirect_uri")).toBe(RETOUR);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("state")).toBe("etat-1");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly");
    expect(u.toString()).not.toContain(APP.client_secret);
  });
  it("Instagram : scopes business", () => {
    const u = new URL(urlAutorisation("instagram", APP, RETOUR, "e"));
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights");
  });
  it("TikTok : client_key au lieu de client_id", () => {
    const u = new URL(urlAutorisation("tiktok", APP, RETOUR, "e"));
    expect(u.origin + u.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(u.searchParams.get("client_key")).toBe(APP.client_id);
    expect(u.searchParams.get("client_id")).toBeNull();
    expect(u.searchParams.get("scope")).toBe("user.info.basic,video.publish,video.list");
  });
});

describe("échange du code", () => {
  it("YouTube : jetons puis chaîne", async () => {
    const { f, appels } = fauxFetch((a) =>
      a.url.startsWith("https://oauth2.googleapis.com/token")
        ? json({ access_token: "ya29.acces", expires_in: 3599, refresh_token: "1//renouv", scope: "s" })
        : json({ items: [{ id: "UC123", snippet: { title: "Ma chaîne" } }] }),
    );
    const j = await echangerCode("youtube", APP, RETOUR, "code-xyz", f);
    expect(j).toMatchObject({ acces: "ya29.acces", renouvellement: "1//renouv", idExterne: "UC123", nomCompte: "Ma chaîne" });
    expect(j.expireLe!.getTime()).toBeGreaterThan(Date.now() + 3500_000);
    expect(appels[0]!.methode).toBe("POST");
    expect(appels[0]!.entetes["content-type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(String(appels[0]!.corps));
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code-xyz");
    expect(appels[1]!.url).toBe("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true");
    expect(appels[1]!.entetes.authorization).toBe("Bearer ya29.acces");
  });

  it("Instagram : jeton court, jeton de 60 jours, identité", async () => {
    const { f, appels } = fauxFetch((a) => {
      if (a.url === "https://api.instagram.com/oauth/access_token") return json({ access_token: "IGcourt", user_id: 17841400000 });
      if (a.url.startsWith("https://graph.instagram.com/access_token")) return json({ access_token: "IGlong", token_type: "bearer", expires_in: 5184000 });
      return json({ user_id: "17841400000", username: "mon_studio", id: "app-scoped" });
    });
    const j = await echangerCode("instagram", APP, RETOUR, "c", f);
    expect(j).toMatchObject({ acces: "IGlong", renouvellement: null, idExterne: "17841400000", nomCompte: "mon_studio" });
    const long = new URL(appels[1]!.url);
    expect(long.searchParams.get("grant_type")).toBe("ig_exchange_token");
    expect(long.searchParams.get("access_token")).toBe("IGcourt");
    expect(new URL(appels[2]!.url).pathname).toBe("/v25.0/me");
    expect(new URL(appels[2]!.url).searchParams.get("fields")).toBe("user_id,username");
  });

  it("TikTok : erreur signalée avec un statut 200", async () => {
    const { f } = fauxFetch(() => json({ error: "invalid_grant", error_description: "Authorization code is expired.", log_id: "x" }));
    await expect(echangerCode("tiktok", APP, RETOUR, "c", f)).rejects.toMatchObject({ statut: 400, code: "invalid_grant" });
  });

  it("TikTok : jetons et identité", async () => {
    const { f, appels } = fauxFetch((a) =>
      a.url === "https://open.tiktokapis.com/v2/oauth/token/"
        ? json({ access_token: "act.1", expires_in: 86400, open_id: "oid", refresh_token: "rft.1", refresh_expires_in: 31536000, scope: "video.publish" })
        : json({ data: { user: { open_id: "oid", display_name: "Studio" } }, error: { code: "ok", message: "" } }),
    );
    const j = await echangerCode("tiktok", APP, RETOUR, "c", f);
    expect(j).toMatchObject({ acces: "act.1", renouvellement: "rft.1", idExterne: "oid", nomCompte: "Studio" });
    expect(new URLSearchParams(String(appels[0]!.corps)).get("client_key")).toBe(APP.client_id);
    expect(appels[1]!.url).toBe("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name");
  });

  it("ne divulgue pas le secret dans une erreur", async () => {
    const { f, appels } = fauxFetch(() => json({ error: "invalid_client", error_description: `bad client_secret=${APP.client_secret}` }, 401));
    const e = await echec(echangerCode("youtube", APP, RETOUR, "c", f));
    expect(e).toMatchObject({ statut: 401 });
    expect(e.message).not.toContain(APP.client_secret);
    expect(texteAppels(appels)).toContain("client_secret");
  });
});

describe("renouvellement", () => {
  it("YouTube garde l'ancien refresh_token", async () => {
    const { f } = fauxFetch(() => json({ access_token: "ya29.neuf", expires_in: 3600 }));
    const r = await renouvelerJeton("youtube", APP, { acces: "ya29.vieux", renouvellement: "1//r" }, f);
    expect(r.acces).toBe("ya29.neuf");
    expect(r.renouvellement).toBe("1//r");
  });
  it("Instagram renouvelle avec le jeton lui-même", async () => {
    const { f, appels } = fauxFetch(() => json({ access_token: "IGneuf", expires_in: 5184000 }));
    const r = await renouvelerJeton("instagram", APP, { acces: "IGvieux", renouvellement: null }, f);
    expect(r.acces).toBe("IGneuf");
    const u = new URL(appels[0]!.url);
    expect(u.origin + u.pathname).toBe("https://graph.instagram.com/refresh_access_token");
    expect(u.searchParams.get("grant_type")).toBe("ig_refresh_token");
  });
  it("TikTok sans jeton de renouvellement : 401", async () => {
    const { f } = fauxFetch(() => json({}));
    await expect(renouvelerJeton("tiktok", APP, { acces: "a", renouvellement: null }, f)).rejects.toMatchObject({ statut: 401 });
  });
  it("décide quand renouveler", () => {
    const maintenant = new Date("2026-11-09T12:00:00Z");
    expect(doitRenouveler("youtube", new Date("2026-11-09T12:05:00Z"), maintenant)).toBe(true);
    expect(doitRenouveler("youtube", new Date("2026-11-09T13:00:00Z"), maintenant)).toBe(false);
    expect(doitRenouveler("instagram", new Date("2026-11-14T12:00:00Z"), maintenant)).toBe(true);
    expect(doitRenouveler("instagram", null, maintenant)).toBe(false);
  });
});
