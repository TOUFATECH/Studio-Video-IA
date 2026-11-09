// Tests de l'enchaînement des créneaux de programmation des épisodes prêts.
import { describe, expect, it } from "vitest";
import { enchainerCreneaux } from "../lib/programmation";

const rythme = { tous_les_jours: 2, heure: "18:00" };

describe("enchainerCreneaux", () => {
  it("part du prochain créneau puis avance de N jours par épisode", () => {
    const maintenant = new Date("2026-11-09T10:00:00Z");
    const c = enchainerCreneaux(["e1", "e2", "e3"], rythme, null, maintenant, "Indian/Mayotte");
    expect(c.map((x) => [x.episode, x.instant.toISOString()])).toEqual([
      ["e1", "2026-11-09T15:00:00.000Z"],
      ["e2", "2026-11-11T15:00:00.000Z"],
      ["e3", "2026-11-13T15:00:00.000Z"],
    ]);
  });

  it("passe au lendemain si l'heure du jour est passée", () => {
    const maintenant = new Date("2026-11-09T16:00:00Z");
    const c = enchainerCreneaux(["e1"], rythme, null, maintenant, "Indian/Mayotte");
    expect(c[0]?.instant.toISOString()).toBe("2026-11-10T15:00:00.000Z");
  });

  it("se place après la dernière sortie déjà programmée", () => {
    const maintenant = new Date("2026-11-09T10:00:00Z");
    const derniere = new Date("2026-11-12T15:00:00Z");
    const c = enchainerCreneaux(["e4", "e5"], { tous_les_jours: 3, heure: "18:00" }, derniere, maintenant, "Indian/Mayotte");
    expect(c.map((x) => x.instant.toISOString())).toEqual(["2026-11-15T15:00:00.000Z", "2026-11-18T15:00:00.000Z"]);
  });

  it("garde l'heure locale à travers le changement d'heure", () => {
    const maintenant = new Date("2026-10-24T08:00:00Z");
    const c = enchainerCreneaux(["a", "b"], { tous_les_jours: 1, heure: "18:00" }, new Date("2026-10-24T16:00:00Z"), maintenant, "Europe/Paris");
    expect(c.map((x) => x.instant.toISOString())).toEqual(["2026-10-25T17:00:00.000Z", "2026-10-26T17:00:00.000Z"]);
  });

  it("ne renvoie rien sans épisode", () => {
    expect(enchainerCreneaux([], rythme, null, new Date(), "UTC")).toEqual([]);
  });
});
