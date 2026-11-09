// Tests de la publication Instagram : conteneur IN_PROGRESS → FINISHED, publication, permalien, statistiques.
import { describe, expect, it } from "vitest";
import { attendreConteneur, publierReel, statsInstagram } from "../src/instagram";
import { fauxFetch, json, sansAttente, echec } from "./outils";

const JETON = "IGAAjeton-secret-0123456789";

describe("Instagram : Reel", () => {
  it("crée le conteneur, attend FINISHED, publie et lit le permalien", async () => {
    const attentes: number[] = [];
    const etapes: string[] = [];
    let suivis = 0;
    const { f, appels } = fauxFetch((a) => {
      const u = new URL(a.url);
      if (u.pathname === "/v25.0/1784/media") return json({ id: "conteneur-1" });
      if (u.pathname === "/v25.0/conteneur-1") return json({ status_code: suivis++ < 2 ? "IN_PROGRESS" : "FINISHED", id: "conteneur-1" });
      if (u.pathname === "/v25.0/1784/media_publish") return json({ id: "media-9" });
      return json({ permalink: "https://www.instagram.com/reel/abc/", id: "media-9" });
    });
    const r = await publierReel(
      JETON,
      "1784",
      { urlVideo: "https://x.supabase.co/storage/v1/object/sign/medias/r.mp4?token=t", legende: "Ép. 1 #histoire", surEtape: (e) => etapes.push(e) },
      { attendre: async (ms) => void attentes.push(ms) },
      f,
    );
    expect(r).toEqual({ id: "media-9", url: "https://www.instagram.com/reel/abc/" });
    expect(attentes).toEqual([15000, 15000]);
    expect(etapes).toEqual(["conteneur", "traitement", "publication"]);
    expect(appels[0]!.methode).toBe("POST");
    expect(appels[0]!.corps).toEqual({ media_type: "REELS", video_url: "https://x.supabase.co/storage/v1/object/sign/medias/r.mp4?token=t", caption: "Ép. 1 #histoire", share_to_feed: true });
    expect(new URL(appels[1]!.url).searchParams.get("fields")).toBe("status_code,status");
    const publication = appels.find((a) => a.url.includes("media_publish"))!;
    expect(publication.corps).toEqual({ creation_id: "conteneur-1" });
  });

  it("échoue clairement sur ERROR", async () => {
    const { f } = fauxFetch(() => json({ status_code: "ERROR" }));
    await expect(attendreConteneur(JETON, "c", { attendre: sansAttente }, f)).rejects.toMatchObject({ code: "conteneur_erreur" });
  });

  it("abandonne après le délai maximal", async () => {
    const { f } = fauxFetch(() => json({ status_code: "IN_PROGRESS" }));
    await expect(attendreConteneur(JETON, "c", { attendre: sansAttente, delaiMaxMs: 30_000 }, f)).rejects.toMatchObject({ code: "delai_depasse" });
  });

  it("garde le code 190 d'un jeton expiré et ne divulgue pas le jeton", async () => {
    const { f } = fauxFetch(() => json({ error: { message: "Error validating access token", type: "OAuthException", code: 190 } }, 400));
    const e = await echec(attendreConteneur(JETON, "c", { attendre: sansAttente }, f));
    expect(e).toMatchObject({ statut: 400, code: "190" });
    expect(e.message).not.toContain(JETON);
  });

  it("signale un 429", async () => {
    const { f } = fauxFetch(() => json({ error: { message: "Application request limit reached", code: 4 } }, 429));
    await expect(publierReel(JETON, "1", { urlVideo: "https://a/b.mp4", legende: "" }, { attendre: sansAttente }, f)).rejects.toMatchObject({ statut: 429 });
  });
});

describe("Instagram : statistiques", () => {
  it("lit les insights", async () => {
    const { f, appels } = fauxFetch(() =>
      json({ data: [{ name: "views", values: [{ value: 300 }] }, { name: "likes", values: [{ value: 12 }] }, { name: "comments", values: [{ value: 3 }] }, { name: "shares", values: [{ value: 1 }] }] }),
    );
    expect(await statsInstagram(JETON, "m1", f)).toEqual({ vues: 300, jaime: 12, commentaires: 3, partages: 1 });
    expect(new URL(appels[0]!.url).searchParams.get("metric")).toBe("views,likes,comments,shares");
  });
  it("se replie sur les compteurs si les insights échouent", async () => {
    const { f, appels } = fauxFetch((a) => (a.url.includes("/insights") ? json({ error: { message: "unsupported metric", code: 100 } }, 400) : json({ like_count: 5, comments_count: 1 })));
    expect(await statsInstagram(JETON, "m1", f)).toEqual({ jaime: 5, commentaires: 1 });
    expect(new URL(appels[1]!.url).searchParams.get("fields")).toBe("like_count,comments_count");
  });
});
