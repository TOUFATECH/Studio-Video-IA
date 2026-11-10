// Tests de l'espace Clips côté site : formulaires, import de la chanson, liens et lecture des lignes.
import { describe, expect, it } from "vitest";
import { codeEpisode, lienEpisode, nomEpisode } from "../lib/episodes";
import { ligneEpisode, lignePlan, ligneSerie } from "../lib/lignes";
import { schemaCle, schemaImportChanson, schemaMusique, schemaNouveauClip, schemaReglagesClip, schemaSonParoles } from "../lib/schemas";
import { verifierImport } from "../lib/signature";

const ID = "6f1c7a52-2b8e-4f43-9a8d-0b6f3c1e2d4a";

describe("formulaires d'un clip", () => {
  it("crée un clip vertical par défaut, à partir d'une chanson importée", () => {
    expect(schemaNouveauClip.parse({ espace_id: ID, titre: " Envol ", langue: "fr" })).toEqual({ espace_id: ID, titre: "Envol", langue: "fr", format: "court", source: "importer" });
  });

  it("lit les paroles, la case instrumental et l'IA choisie", () => {
    const r = schemaSonParoles.parse({ id: ID, paroles: "[Refrain]\nOn s'envole", musique_style: "pop", instrumental: "on", langue: "ja", fournisseur_texte: "anthropic" });
    expect(r.instrumental).toBe(true);
    expect(r.fournisseur_texte).toBe("anthropic");
    expect(schemaSonParoles.safeParse({ id: ID, paroles: "", musique_style: "", langue: "fr", fournisseur_texte: "gemini" }).success).toBe(false);
  });

  it("accepte un extrait sans fin et un tempo vide, refuse un extrait à l'envers ou un tempo absurde", () => {
    const base = { id: ID, titre: "", idee: "", style_visuel: "", format: "court", extrait_debut: "7.5", sous_titres: "fr" };
    expect(schemaReglagesClip.parse({ ...base, extrait_fin: "", bpm: "" })).toMatchObject({ extrait_debut: 7.5, extrait_fin: null, bpm: null });
    expect(schemaReglagesClip.parse({ ...base, extrait_fin: "67.5", bpm: "110" })).toMatchObject({ extrait_fin: 67.5, bpm: 110 });
    expect(schemaReglagesClip.safeParse({ ...base, extrait_fin: "8", bpm: "" }).success).toBe(false);
    expect(schemaReglagesClip.safeParse({ ...base, extrait_fin: "", bpm: "400" }).success).toBe(false);
  });

  it("borne la durée d'une musique générée entre 10 s et 10 min", () => {
    expect(schemaMusique.parse({ episode_id: ID, duree: "90" }).duree).toBe(90);
    expect(schemaMusique.safeParse({ episode_id: ID, duree: "900" }).success).toBe(false);
  });

  it("accepte une clé Claude comme clé simple", () => {
    expect(schemaCle.safeParse({ fournisseur: "anthropic", valeur: "sk-ant-api03-0123456789abcdef" }).success).toBe(true);
  });
});

describe("import de la chanson", () => {
  it("demande une adresse pour un MP3, WAV ou M4A seulement", () => {
    expect(schemaImportChanson.safeParse({ etape: "adresse", cible: ID, taille: 4_000_000, extension: "mp3" }).success).toBe(true);
    expect(schemaImportChanson.safeParse({ etape: "adresse", cible: ID, taille: 4_000_000, extension: "exe" }).success).toBe(false);
    expect(schemaImportChanson.safeParse({ etape: "valider", cible: ID, chemin: "esp/clip/chanson/a.mp3" }).success).toBe(true);
  });

  it("vérifie le vrai type et la taille (45 Mo)", () => {
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(verifierImport("chanson", mp3, 30 * 1024 * 1024).ok).toBe(true);
    expect(verifierImport("chanson", mp3, 46 * 1024 * 1024).ok).toBe(false);
    expect(verifierImport("chanson", png, 1000).ok).toBe(false);
  });
});

describe("liens et noms des clips", () => {
  it("ouvre un clip dans l'espace Clips et un épisode dans ses pages", () => {
    expect(lienEpisode({ id: "c1", genre: "clip" }, "son")).toBe("/clips/c1?etape=son");
    expect(lienEpisode({ id: "e1", genre: "episode" })).toBe("/episodes/e1");
    expect(codeEpisode({ genre: "clip", numero: 3 }, undefined)).toBe("Clip 3");
    expect(nomEpisode({ genre: "clip", titre: "", numero: 3 }, undefined)).toBe("Clip 3");
  });
});

describe("lecture des lignes", () => {
  it("donne des valeurs par défaut aux colonnes des clips absentes (base pas encore migrée)", () => {
    const serie = ligneSerie.parse({ id: ID, espace_id: ID, nom: "x", style_visuel: "", langue: "fr", univers: "", fil_rouge: "", rythme: null, cree_le: "2026-01-01" });
    expect(serie.genre).toBe("serie");
    const plan = lignePlan.parse({ id: ID, episode_id: ID, position: 0, section: "principal", type: "action", texte: "x", personnage_id: null, replique: "", repliques_traduites: {}, duree_fixee: null, valide: false, modifie: false, prise_choisie: "A" });
    expect([plan.debut, plan.fin]).toEqual([null, null]);
  });

  it("lit les paroles alignées et les nombres envoyés en texte par PostgreSQL", () => {
    const ep = ligneEpisode.parse({
      id: ID, serie_id: ID, saison_id: ID, genre: "clip", numero: 1, titre: "", idee: "", format: "moyen", duree_cible: 120, langue: "fr", langues: ["fr"],
      sous_titres: { fr: "fr" }, prises: 1, enchainer: true, musique: false, bruitages: false, chapitres: [], titres_traduits: {}, choix_titres: {}, miniature: null,
      memoire_faite: false, hashtags: {}, paroles_alignees: [{ texte: "a", debut: 1, fin: 2 }], bpm: "110.00", extrait_debut: "7.250", extrait_fin: "127.250", cree_le: "2026-01-01",
    });
    expect(ep.bpm).toBe(110);
    expect(ep.extrait_debut).toBe(7.25);
    expect(ep.paroles_alignees).toEqual([{ texte: "a", debut: 1, fin: 2 }]);
  });
});
