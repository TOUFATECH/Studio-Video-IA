// Tests des tâches des clips musicaux : données acceptées, durée par défaut, texte de secours, chanson retenue.
import { describe, expect, it } from "vitest";
import type { Fichier } from "@studio-video-ia/core";
import { texteDeSecours } from "../src/taches/decoupage";
import { chansonDuClip } from "../src/donnees";
import { schemaDonneesScenario } from "../src/taches/scenario";
import { dureeChansonParDefaut, schemaDonneesMusique } from "../src/taches/son";

/** Fichier factice. */
function fichier(extra: Partial<Fichier>): Fichier {
  return { id: Math.random().toString(36), espace_id: "s", episode_id: "e", plan_id: null, personnage_id: null, genre: "chanson", langue: null, prise: null, chemin: "s/e/chanson/a.mp3", duree_s: 180, secondes_generation: null, cout: 0, statut: "pret", erreur: null, essais: 1, cree_le: "2026-01-01", ...extra };
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
