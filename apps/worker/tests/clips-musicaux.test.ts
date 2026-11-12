import { CHAMPS_FICHIER_DEFAUT } from "@studio-video-ia/core";
// Tests des tâches des clips musicaux : données acceptées, durée par défaut, texte de secours, chanson retenue.
import { describe, expect, it } from "vitest";
import type { Fichier } from "@studio-video-ia/core";
import { texteDeSecours } from "../src/taches/decoupage";
import { chansonDuClip } from "../src/donnees";
import { schemaDonneesScenario } from "../src/taches/scenario";
import { dureeChansonParDefaut, schemaDonneesMusique } from "../src/taches/son";

/** Fichier factice. */
function fichier(extra: Partial<Fichier>): Fichier {
  return { id: Math.random().toString(36), espace_id: "s", episode_id: "e", plan_id: null, personnage_id: null, genre: "chanson", langue: null, prise: null, chemin: "s/e/chanson/a.mp3", duree_s: 180, secondes_generation: null, cout: 0, statut: "pret", erreur: null, essais: 1, cree_le: "2026-01-01", ...CHAMPS_FICHIER_DEFAUT, ...extra };
}

describe("clips musicaux (worker)", () => {
  it("accepte « ecriture » envoyé par d'anciennes versions du site comme « ecrire »", () => {
    expect(schemaDonneesScenario.parse({ mode: "ecriture" }).mode).toBe("ecrire");
    expect(schemaDonneesScenario.parse({}).mode).toBe("ecrire");
    expect(schemaDonneesScenario.parse({ mode: "modification", demande: "x" }).mode).toBe("modification");
  });

  it("propose 1:30 de musique pour un clip vertical, 3:00 pour YouTube", () => {
    expect(dureeChansonParDefaut("court")).toBe(90);
    expect(dureeChansonParDefaut("moyen")).toBe(180);
    expect(dureeChansonParDefaut("long")).toBe(180);
    expect(schemaDonneesMusique.parse({})).toEqual({ synchroniser: true });
    expect(schemaDonneesMusique.safeParse({ duree: 700 }).success).toBe(false);
  });

  it("garde un plan utilisable quand l'IA n'a rien écrit pour un segment", () => {
    expect(texteDeSecours({ debut: 0, fin: 4, texte: "On s'envole", type: "climax" }, "")).toContain("On s'envole");
    expect(texteDeSecours({ debut: 0, fin: 4, texte: "", type: "decor" }, "Ville la nuit")).toContain("Ville la nuit");
  });

  it("prend la chanson prête la plus récente", () => {
    const vieille = fichier({ cree_le: "2026-01-01", chemin: "s/e/chanson/vieille.mp3" });
    const recente = fichier({ cree_le: "2026-02-01", chemin: "s/e/chanson/recente.mp3" });
    const ratee = fichier({ cree_le: "2026-03-01", statut: "echec", chemin: null });
    expect(chansonDuClip([vieille, recente, ratee])?.chemin).toBe("s/e/chanson/recente.mp3");
    expect(chansonDuClip([fichier({ genre: "musique" })])).toBeNull();
  });
});

describe("médias locaux", () => {
  it("n'envoie de lien à Instagram que si le site est public en https", async () => {
    const { adressePublique, Stockage } = await import("../src/stockage");
    const { Depot } = await import("@studio-video-ia/base");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    expect(adressePublique("https://studio.exemple.fr")).toBe(true);
    for (const a of ["http://studio.exemple.fr", "https://localhost:3000", "https://192.168.1.20", "https://127.0.0.1", "pas une adresse"]) expect(adressePublique(a), a).toBe(false);
    const depot = new Depot(join(mkdtempSync(join(tmpdir(), "svi-")), "medias"), "secret");
    await depot.ecrire("e/ep/rendu/a.mp4", new Uint8Array([1, 2]));
    await expect(new Stockage(depot, "http://localhost:3000").urlPublique("e/ep/rendu/a.mp4")).rejects.toThrow("APP_URL");
    const url = await new Stockage(depot, "https://studio.exemple.fr/").urlPublique("e/ep/rendu/a.mp4");
    expect(url).toMatch(/^https:\/\/studio\.exemple\.fr\/api\/medias\/e\/ep\/rendu\/a\.mp4\?e=\d+&s=/);
    expect(await new Stockage(depot).dataUri("e/ep/rendu/a.mp4")).toBe("data:video/mp4;base64,AQI=");
  });
});
