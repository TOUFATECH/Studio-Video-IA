// Tests de la conversion de la date locale de publication (champ datetime-local) dans le fuseau de l'espace.
import { describe, expect, it } from "vitest";
import { fuseauValide, instantDepuisSaisie, saisieDepuisInstant } from "../lib/dates";

describe("instantDepuisSaisie", () => {
  it("interprète la saisie dans le fuseau de l'espace, pas celui du serveur", () => {
    expect(instantDepuisSaisie("2026-11-12T18:30", "Indian/Mayotte").toISOString()).toBe("2026-11-12T15:30:00.000Z");
    expect(instantDepuisSaisie("2026-11-12T18:30", "Asia/Tokyo").toISOString()).toBe("2026-11-12T09:30:00.000Z");
    expect(instantDepuisSaisie("2026-11-12T18:30", "UTC").toISOString()).toBe("2026-11-12T18:30:00.000Z");
  });

  it("tient compte de l'heure d'été", () => {
    expect(instantDepuisSaisie("2026-07-01T12:00", "Europe/Paris").toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(instantDepuisSaisie("2026-12-01T12:00", "Europe/Paris").toISOString()).toBe("2026-12-01T11:00:00.000Z");
    expect(instantDepuisSaisie("2026-07-01T09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });

  it("accepte les secondes et refuse les saisies invalides", () => {
    expect(instantDepuisSaisie("2026-11-12T18:30:00", "UTC").toISOString()).toBe("2026-11-12T18:30:00.000Z");
    expect(() => instantDepuisSaisie("12/11/2026 18:30", "UTC")).toThrow();
    expect(() => instantDepuisSaisie("2026-02-31T10:00", "UTC")).toThrow();
    expect(() => instantDepuisSaisie("2026-02-10T25:00", "UTC")).toThrow();
  });

  it("fait l'aller-retour avec saisieDepuisInstant", () => {
    const instant = new Date("2026-11-12T15:30:00.000Z");
    expect(saisieDepuisInstant(instant, "Indian/Mayotte")).toBe("2026-11-12T18:30");
    expect(instantDepuisSaisie(saisieDepuisInstant(instant, "Asia/Seoul"), "Asia/Seoul").toISOString()).toBe(instant.toISOString());
  });
});

describe("fuseauValide", () => {
  it("reconnaît les fuseaux IANA", () => {
    expect(fuseauValide("Europe/Paris")).toBe(true);
    expect(fuseauValide("Mars/Olympus")).toBe(false);
  });
});
