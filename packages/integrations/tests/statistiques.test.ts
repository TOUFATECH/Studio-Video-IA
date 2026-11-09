// Tests des statistiques des comptes : pagination TikTok et Instagram, chaîne et vidéos YouTube, revenus (403 géré).
import { describe, expect, it } from "vitest";
import { testerCompte } from "../src/diagnostic";
import {
  chiffresChaineYoutube,
  chiffresCompteInstagram,
  chiffresCompteTiktok,
  dureeIso,
  periodeDouzeMois,
  revenusYoutube,
  videosInstagram,
  videosTiktok,
  videosYoutube,
} from "../src/statistiques";
import { fauxFetch, json } from "./outils";

const JETON = "jeton-secret-0123456789";

describe("TikTok : compte et vidéos", () => {
  it("lit les chiffres du compte", async () => {
    const { f, appels } = fauxFetch(() => json({ data: { user: { follower_count: 120, following_count: 3, likes_count: 900, video_count: 14 } }, error: { code: "ok" } }));
    expect(await chiffresCompteTiktok(JETON, f)).toEqual({ abonnes: 120, abonnements: 3, jaimeTotal: 900, videos: 14, vuesTotal: null });
    expect(appels[0]!.url).toBe("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,follower_count,following_count,likes_count,video_count");
  });

  it("parcourt toutes les pages avec le curseur", async () => {
    const { f, appels } = fauxFetch((_, rang) =>
      rang === 0
        ? json({ data: { videos: [{ id: "1", title: "A", view_count: 10, create_time: 1700000000, duration: 30 }], cursor: 1700000000000, has_more: true }, error: { code: "ok" } })
        : json({ data: { videos: [{ id: "2", video_description: "B", like_count: 4 }], cursor: 0, has_more: false }, error: { code: "ok" } }),
    );
    const v = await videosTiktok(JETON, f);
    expect(v.map((x) => x.idExterne)).toEqual(["1", "2"]);
    expect(v[0]).toMatchObject({ titre: "A", vues: 10, dureeS: 30, publieeLe: "2023-11-14T22:13:20.000Z" });
    expect(v[1]).toMatchObject({ titre: "B", jaime: 4, vues: 0 });
    expect(appels[0]!.methode).toBe("POST");
    expect(appels[0]!.url).toContain("https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description");
    expect(appels[0]!.corps).toEqual({ max_count: 20 });
    expect(appels[1]!.corps).toEqual({ max_count: 20, cursor: 1700000000000 });
  });

  it("testerCompte signale l'autorisation user.info.stats manquante", async () => {
    const { f } = fauxFetch((a) =>
      a.url.includes("follower_count")
        ? json({ data: {}, error: { code: "scope_not_authorized", message: "The user did not authorize the scope required for completing this request." } }, 401)
        : json({ data: { user: { open_id: "oid", display_name: "Studio" } }, error: { code: "ok" } }),
    );
    const r = await testerCompte("tiktok", JETON, "oid", f);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("user.info.stats");
    expect(r.message).toContain("reconnecte");
  });

  it("testerCompte TikTok complet", async () => {
    const { f } = fauxFetch(() => json({ data: { user: { open_id: "oid", display_name: "Studio", follower_count: 1 } }, error: { code: "ok" } }));
    expect((await testerCompte("tiktok", JETON, "oid", f)).ok).toBe(true);
  });
});

describe("Instagram : compte et médias", () => {
  it("lit les chiffres du compte", async () => {
    const { f, appels } = fauxFetch(() => json({ user_id: "1", username: "s", followers_count: 50, follows_count: 2, media_count: 8 }));
    expect(await chiffresCompteInstagram(JETON, f)).toEqual({ abonnes: 50, abonnements: 2, jaimeTotal: null, videos: 8, vuesTotal: null });
    expect(new URL(appels[0]!.url).searchParams.get("fields")).toBe("user_id,username,followers_count,follows_count,media_count");
  });

  it("suit paging.next et ignore proprement les vues indisponibles", async () => {
    const page2 = "https://graph.instagram.com/v25.0/me/media?after=CURSEUR&access_token=x";
    const { f, appels } = fauxFetch((a) => {
      const u = new URL(a.url);
      if (u.pathname === "/v25.0/me/media" && !u.searchParams.get("after")) {
        expect(u.searchParams.get("limit")).toBe("50");
        return json({ data: [{ id: "m1", caption: "Ép. 1\n#histoire", permalink: "https://instagram.com/reel/1", timestamp: "2026-11-01T10:00:00+0000", like_count: 3 }], paging: { next: page2 } });
      }
      if (u.searchParams.get("after") === "CURSEUR") return json({ data: [{ id: "m2", comments_count: 1 }] });
      if (u.pathname === "/v25.0/m1/insights") return json({ data: [{ name: "views", values: [{ value: 77 }] }] });
      return json({ error: { message: "metric not supported", code: 100 } }, 400);
    });
    const v = await videosInstagram(JETON, f);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ idExterne: "m1", titre: "Ép. 1", vues: 77, jaime: 3, publieeLe: "2026-11-01T10:00:00.000Z" });
    expect(v[1]).toMatchObject({ idExterne: "m2", vues: 0, commentaires: 1 });
    expect(appels.some((a) => a.url === page2)).toBe(true);
  });

  it("une erreur de jeton pendant les vues remonte", async () => {
    const { f } = fauxFetch((a) =>
      a.url.includes("/insights") ? json({ error: { message: "Error validating access token", code: 190 } }, 400) : json({ data: [{ id: "m1" }] }),
    );
    await expect(videosInstagram(JETON, f)).rejects.toMatchObject({ code: "190" });
  });
});

describe("YouTube : chaîne, vidéos, revenus", () => {
  it("lit la chaîne et la playlist uploads", async () => {
    const { f, appels } = fauxFetch(() => json({ items: [{ id: "UC1", statistics: { subscriberCount: "1200", viewCount: "50000", videoCount: "30" }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] }));
    expect(await chiffresChaineYoutube(JETON, f)).toEqual({ abonnes: 1200, abonnements: null, jaimeTotal: null, videos: 30, vuesTotal: 50000, playlistUploads: "UU1" });
    expect(appels[0]!.url).toBe("https://www.googleapis.com/youtube/v3/channels?part=statistics,contentDetails&mine=true");
  });

  it("parcourt la playlist puis lit les vidéos par lots", async () => {
    const { f, appels } = fauxFetch((a) => {
      const u = new URL(a.url);
      if (u.pathname.endsWith("/playlistItems") && !u.searchParams.get("pageToken")) return json({ items: [{ contentDetails: { videoId: "a" } }], nextPageToken: "P2" });
      if (u.pathname.endsWith("/playlistItems")) return json({ items: [{ contentDetails: { videoId: "b" } }] });
      return json({
        items: [
          { id: "a", snippet: { title: "A", publishedAt: "2026-10-01T00:00:00Z", thumbnails: { medium: { url: "https://i/a.jpg" } } }, statistics: { viewCount: "10", likeCount: "2" }, contentDetails: { duration: "PT1M5S" } },
          { id: "b", snippet: { title: "B" }, statistics: {}, contentDetails: { duration: "PT45S" } },
        ],
      });
    });
    const v = await videosYoutube(JETON, "UU1", f);
    expect(v.map((x) => x.idExterne)).toEqual(["a", "b"]);
    expect(v[0]).toMatchObject({ titre: "A", vues: 10, jaime: 2, dureeS: 65, miniatureUrl: "https://i/a.jpg" });
    const videos = appels.find((a) => a.url.includes("/videos?"))!;
    expect(new URL(videos.url).searchParams.get("id")).toBe("a,b");
    expect(new URL(videos.url).searchParams.get("part")).toBe("snippet,statistics,contentDetails");
  });

  it("lit les revenus par mois et par vidéo", async () => {
    const { f, appels } = fauxFetch((a) =>
      new URL(a.url).searchParams.get("dimensions") === "month"
        ? json({ columnHeaders: [{ name: "month" }, { name: "estimatedRevenue" }], rows: [["2026-10", 12.5], ["2026-11", 3]] })
        : json({ columnHeaders: [{ name: "video" }, { name: "estimatedRevenue" }, { name: "views" }], rows: [["a", 1.2, 100]] }),
    );
    const r = await revenusYoutube(JETON, new Date("2026-11-09T12:00:00Z"), f);
    expect(r).toEqual({ disponible: true, devise: "EUR", mois: [{ mois: "2026-10-01", montant: 12.5 }, { mois: "2026-11-01", montant: 3 }], parVideo: new Map([["a", 1.2]]) });
    const u = new URL(appels[0]!.url);
    expect(u.origin + u.pathname).toBe("https://youtubeanalytics.googleapis.com/v2/reports");
    expect(u.searchParams.get("ids")).toBe("channel==MINE");
    expect(u.searchParams.get("startDate")).toBe("2025-12-01");
    expect(u.searchParams.get("endDate")).toBe("2026-11-30");
    expect(u.searchParams.get("currency")).toBe("EUR");
    const v = new URL(appels[1]!.url);
    expect(v.searchParams.get("metrics")).toBe("estimatedRevenue,views");
    expect(v.searchParams.get("sort")).toBe("-views");
    expect(v.searchParams.get("maxResults")).toBe("200");
  });

  it("un 403 rend les revenus indisponibles sans échouer", async () => {
    const { f } = fauxFetch(() => json({ error: { code: 403, message: "Forbidden", status: "PERMISSION_DENIED" } }, 403));
    expect(await revenusYoutube(JETON, new Date("2026-11-09T12:00:00Z"), f)).toEqual({ disponible: false, raison: "Forbidden" });
  });

  it("un 401 remonte", async () => {
    const { f } = fauxFetch(() => json({ error: { code: 401, message: "Invalid Credentials" } }, 401));
    await expect(revenusYoutube(JETON, new Date(), f)).rejects.toMatchObject({ statut: 401 });
  });

  it("outils de dates et de durées", () => {
    expect(dureeIso("PT1H2M3S")).toBe(3723);
    expect(dureeIso("P1D")).toBe(86400);
    expect(dureeIso(undefined)).toBeNull();
    expect(periodeDouzeMois(new Date("2026-01-15T00:00:00Z"))).toEqual({ debut: "2025-02-01", fin: "2026-01-31" });
  });
});
