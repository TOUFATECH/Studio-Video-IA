// Tests de la publication YouTube : programmation native, envoi résumable par morceaux, reprise, statistiques.
import { describe, expect, it } from "vitest";
import { sourceBuffer } from "../src/http";
import { envoyerVideoYoutube, metadonneesYoutube, prochainOctet, statsYoutube, statutYoutube, TAILLE_MORCEAU_YOUTUBE, titreYoutube } from "../src/youtube";
import { fauxFetch, json, vide } from "./outils";

const JETON = "ya29.jeton-secret-0123456789";
const MAINTENANT = new Date("2026-11-09T12:00:00Z");

describe("YouTube : programmation", () => {
  it("privé + publishAt quand la date est lointaine", () => {
    expect(statutYoutube(new Date("2026-11-10T18:00:00Z"), MAINTENANT)).toEqual({ privacyStatus: "private", publishAt: "2026-11-10T18:00:00.000Z" });
  });
  it("public quand la date est proche ou passée", () => {
    expect(statutYoutube(new Date("2026-11-09T12:10:00Z"), MAINTENANT)).toEqual({ privacyStatus: "public" });
    expect(statutYoutube(new Date("2026-11-08T12:00:00Z"), MAINTENANT)).toEqual({ privacyStatus: "public" });
  });
  it("coupe le titre à 100 caractères et retire les chevrons", () => {
    expect([...titreYoutube("a".repeat(150))].length).toBe(100);
    expect(titreYoutube("<b>Titre</b>")).toBe("bTitre/b");
  });
  it("construit les métadonnées attendues", () => {
    const m = metadonneesYoutube({ titre: "Ép. 1", description: "desc", tags: ["#histoire", "#série"], langue: "fr", programmeeLe: new Date("2026-12-01T00:00:00Z"), maintenant: MAINTENANT });
    expect(m).toEqual({
      snippet: { title: "Ép. 1", description: "desc", tags: ["histoire", "série"], categoryId: "24", defaultLanguage: "fr", defaultAudioLanguage: "fr" },
      status: { privacyStatus: "private", publishAt: "2026-12-01T00:00:00.000Z", selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
    });
  });
  it("lit l'en-tête Range", () => {
    expect(prochainOctet("bytes=0-8388607")).toBe(8388608);
    expect(prochainOctet(null)).toBe(0);
  });
});

describe("YouTube : envoi résumable", () => {
  it("ouvre la session puis envoie par morceaux de 8 Mio avec Content-Range", async () => {
    const taille = TAILLE_MORCEAU_YOUTUBE + 1000;
    const donnees = Buffer.alloc(taille, 1);
    const progression: number[] = [];
    const { f, appels } = fauxFetch((a, rang) => {
      if (rang === 0) return vide(200, { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc" });
      if (rang === 1) return vide(308, { range: `bytes=0-${TAILLE_MORCEAU_YOUTUBE - 1}` });
      return json({ id: "vid123", status: { uploadStatus: "uploaded" } });
    });
    const r = await envoyerVideoYoutube(
      JETON,
      { source: sourceBuffer(donnees), titre: "T", description: "D", tags: [], langue: "fr", programmeeLe: new Date("2026-11-11T00:00:00Z"), maintenant: MAINTENANT, surProgression: (p) => progression.push(p) },
      f,
    );
    expect(r).toEqual({ id: "vid123", programmee: true, publishAt: "2026-11-11T00:00:00.000Z" });
    const ouverture = appels[0]!;
    expect(ouverture.url).toBe("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status");
    expect(ouverture.entetes["x-upload-content-length"]).toBe(String(taille));
    expect(ouverture.entetes["x-upload-content-type"]).toBe("video/mp4");
    expect(ouverture.corps).toMatchObject({ status: { privacyStatus: "private" } });
    expect(appels[1]!.methode).toBe("PUT");
    expect(appels[1]!.entetes["content-range"]).toBe(`bytes 0-${TAILLE_MORCEAU_YOUTUBE - 1}/${taille}`);
    expect((appels[1]!.corps as Uint8Array).byteLength).toBe(TAILLE_MORCEAU_YOUTUBE);
    expect(appels[2]!.entetes["content-range"]).toBe(`bytes ${TAILLE_MORCEAU_YOUTUBE}-${taille - 1}/${taille}`);
    expect(progression.at(-1)).toBe(100);
  });

  it("reprend après une erreur 503", async () => {
    const { f, appels } = fauxFetch((a, rang) => {
      if (rang === 0) return vide(200, { location: "https://upload/session" });
      if (rang === 1) return vide(503);
      if (rang === 2) return vide(308, { range: "bytes=0-4" });
      return json({ id: "v2" });
    });
    const r = await envoyerVideoYoutube(JETON, { source: sourceBuffer(Buffer.alloc(10)), titre: "T", description: "", tags: [], langue: "en", programmeeLe: MAINTENANT, maintenant: MAINTENANT }, f);
    expect(r.programmee).toBe(false);
    expect(appels[2]!.entetes["content-range"]).toBe("bytes */10");
    expect(appels[3]!.entetes["content-range"]).toBe("bytes 5-9/10");
  });

  it("transforme un 401 en ErreurApi", async () => {
    const { f } = fauxFetch(() => json({ error: { code: 401, message: "Invalid Credentials", status: "UNAUTHENTICATED" } }, 401));
    await expect(envoyerVideoYoutube(JETON, { source: sourceBuffer(Buffer.alloc(3)), titre: "T", description: "", tags: [], langue: "fr", programmeeLe: MAINTENANT }, f)).rejects.toMatchObject({ statut: 401, fournisseur: "YouTube" });
  });
});

describe("YouTube : statistiques", () => {
  it("lit vues, j'aime et commentaires", async () => {
    const { f, appels } = fauxFetch(() => json({ items: [{ id: "a", statistics: { viewCount: "120", likeCount: "7", commentCount: "2" } }] }));
    const s = await statsYoutube(JETON, ["a", "b"], f);
    expect(s.get("a")).toEqual({ vues: 120, jaime: 7, commentaires: 2 });
    expect(appels[0]!.url).toBe("https://www.googleapis.com/youtube/v3/videos?part=statistics&id=a%2Cb");
  });
});
