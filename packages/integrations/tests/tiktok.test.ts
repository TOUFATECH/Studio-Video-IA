// Tests de la publication TikTok : découpage, confidentialité, init, envoi par morceaux, suivi et statistiques.
import { describe, expect, it } from "vitest";
import { sourceBuffer } from "../src/http";
import { choisirConfidentialite, decouperEnvoi, extraireIdsPublics, publierTiktok, statsTiktok, TAILLE_MORCEAU_TIKTOK } from "../src/tiktok";
import { fauxFetch, json, sansAttente, vide } from "./outils";

const JETON = "act.jeton-secret-0123456789";
const Mo = 1024 * 1024;

describe("TikTok : découpage", () => {
  it("un seul morceau jusqu'à 64 Mo", () => {
    expect(decouperEnvoi(1000)).toEqual({ tailleMorceau: 1000, nombre: 1, morceaux: [{ debut: 0, fin: 999 }] });
    expect(decouperEnvoi(64 * Mo).nombre).toBe(1);
  });
  it("morceaux de 10 Mo au-delà, le dernier absorbe le reste", () => {
    const taille = 64 * Mo + 5;
    const d = decouperEnvoi(taille);
    expect(d.tailleMorceau).toBe(TAILLE_MORCEAU_TIKTOK);
    expect(d.nombre).toBe(6);
    expect(d.morceaux[0]).toEqual({ debut: 0, fin: 10 * Mo - 1 });
    expect(d.morceaux[5]).toEqual({ debut: 50 * Mo, fin: taille - 1 });
    // Les morceaux couvrent exactement le fichier, sans trou ni recouvrement.
    let attendu = 0;
    for (const m of d.morceaux) {
      expect(m.debut).toBe(attendu);
      attendu = m.fin + 1;
    }
    expect(attendu).toBe(taille);
  });
  it("refuse une taille nulle", () => {
    expect(() => decouperEnvoi(0)).toThrow();
  });
});

describe("TikTok : confidentialité", () => {
  it("public seulement si l'app est auditée et que l'option existe", () => {
    expect(choisirConfidentialite(["PUBLIC_TO_EVERYONE", "SELF_ONLY"], true)).toBe("PUBLIC_TO_EVERYONE");
    expect(choisirConfidentialite(["PUBLIC_TO_EVERYONE", "SELF_ONLY"], false)).toBe("SELF_ONLY");
    expect(choisirConfidentialite(["SELF_ONLY"], true)).toBe("SELF_ONLY");
  });
  it("lit les identifiants publics sans perte de précision", () => {
    expect(extraireIdsPublics('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7311234567890123456]}}')).toEqual(["7311234567890123456"]);
    expect(extraireIdsPublics('{"data":{"status":"PUBLISH_COMPLETE"}}')).toEqual([]);
  });
});

describe("TikTok : publication", () => {
  it("init, envoi, suivi jusqu'à PUBLISH_COMPLETE", async () => {
    const etapes: string[] = [];
    let suivis = 0;
    const { f, appels } = fauxFetch((a) => {
      if (a.url.endsWith("/creator_info/query/")) return json({ data: { privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], max_video_post_duration_sec: 600, creator_username: "studio" }, error: { code: "ok" } });
      if (a.url.endsWith("/video/init/")) return json({ data: { publish_id: "v_pub_1", upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=1" }, error: { code: "ok" } });
      if (a.url.startsWith("https://open-upload")) return vide(201);
      return new Response(
        suivis++ === 0
          ? '{"data":{"status":"PROCESSING_UPLOAD"},"error":{"code":"ok"}}'
          : '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7311234567890123456]},"error":{"code":"ok"}}',
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const r = await publierTiktok(JETON, { source: sourceBuffer(Buffer.alloc(2000)), titre: "Ép. 1", duree: 75, auditValide: true, surEtape: (e) => etapes.push(e) }, { attendre: sansAttente }, f);
    expect(r).toEqual({ publishId: "v_pub_1", statut: "PUBLISH_COMPLETE", idPublic: "7311234567890123456", confidentialite: "PUBLIC_TO_EVERYONE", pseudo: "studio" });
    const init = appels.find((a) => a.url.endsWith("/video/init/"))!;
    expect(init.entetes["content-type"]).toBe("application/json; charset=UTF-8");
    expect(init.entetes.authorization).toBe(`Bearer ${JETON}`);
    expect(init.corps).toEqual({
      post_info: { title: "Ép. 1", privacy_level: "PUBLIC_TO_EVERYONE", disable_duet: false, disable_comment: false, disable_stitch: false, is_aigc: true },
      source_info: { source: "FILE_UPLOAD", video_size: 2000, chunk_size: 2000, total_chunk_count: 1 },
    });
    const envoi = appels.find((a) => a.url.startsWith("https://open-upload"))!;
    expect(envoi.methode).toBe("PUT");
    expect(envoi.entetes["content-type"]).toBe("video/mp4");
    expect(envoi.entetes["content-length"]).toBe("2000");
    expect(envoi.entetes["content-range"]).toBe("bytes 0-1999/2000");
    expect(envoi.entetes.authorization).toBeUndefined();
    const statut = appels.find((a) => a.url.endsWith("/status/fetch/"))!;
    expect(statut.corps).toEqual({ publish_id: "v_pub_1" });
    expect(etapes).toContain("traitement");
  });

  it("refuse une vidéo plus longue que la limite du créateur", async () => {
    const { f, appels } = fauxFetch(() => json({ data: { privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 60 }, error: { code: "ok" } }));
    await expect(publierTiktok(JETON, { source: sourceBuffer(Buffer.alloc(10)), titre: "t", duree: 90, auditValide: false }, { attendre: sansAttente }, f)).rejects.toMatchObject({ code: "duree_trop_longue" });
    expect(appels).toHaveLength(1);
  });

  it("transforme FAILED en erreur lisible", async () => {
    const { f } = fauxFetch((a) => {
      if (a.url.endsWith("/creator_info/query/")) return json({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } });
      if (a.url.endsWith("/video/init/")) return json({ data: { publish_id: "p", upload_url: "https://up.tiktok/x" }, error: { code: "ok" } });
      if (a.url.startsWith("https://up.tiktok")) return vide(201);
      return json({ data: { status: "FAILED", fail_reason: "video_pull_failed" }, error: { code: "ok" } });
    });
    await expect(publierTiktok(JETON, { source: sourceBuffer(Buffer.alloc(10)), titre: "t", duree: null, auditValide: false }, { attendre: sansAttente }, f)).rejects.toMatchObject({ code: "video_pull_failed" });
  });

  it("jeton invalide : 401 avec le code TikTok", async () => {
    const { f } = fauxFetch(() => json({ error: { code: "access_token_invalid", message: "The access token is invalid or not found in the request.", log_id: "l" } }, 401));
    await expect(publierTiktok(JETON, { source: sourceBuffer(Buffer.alloc(10)), titre: "t", duree: null, auditValide: false }, { attendre: sansAttente }, f)).rejects.toMatchObject({ statut: 401, code: "access_token_invalid" });
  });

  it("limite de débit : 429", async () => {
    const { f } = fauxFetch(() => json({ error: { code: "rate_limit_exceeded", message: "Too many requests" } }, 429));
    await expect(publierTiktok(JETON, { source: sourceBuffer(Buffer.alloc(10)), titre: "t", duree: null, auditValide: false }, { attendre: sansAttente }, f)).rejects.toMatchObject({ statut: 429 });
  });
});

describe("TikTok : statistiques", () => {
  it("interroge les vidéos par lots", async () => {
    const { f, appels } = fauxFetch(() => json({ data: { videos: [{ id: "1", view_count: 10, like_count: 2, comment_count: 1, share_count: 0 }] }, error: { code: "ok" } }));
    const s = await statsTiktok(JETON, ["1"], f);
    expect(s.get("1")).toEqual({ vues: 10, jaime: 2, commentaires: 1, partages: 0 });
    expect(appels[0]!.url).toBe("https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count");
    expect(appels[0]!.corps).toEqual({ filters: { video_ids: ["1"] } });
  });
});
