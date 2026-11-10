// Tests du dépôt de médias : chemins sûrs, écriture atomique, adresses signées.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assurerCleChiffrement, cheminSur, configBase, Depot } from "../src/index";

const dossier = mkdtempSync(join(tmpdir(), "svi-depot-"));
afterAll(() => rmSync(dossier, { recursive: true, force: true }));

describe("dépôt des médias", () => {
  const depot = new Depot(join(dossier, "medias"), "secret-de-test");

  it("refuse les chemins qui sortent du dossier", () => {
    expect(cheminSur("espace/episode/a.png")).toBe("espace/episode/a.png");
    for (const c of ["../etc/passwd", "a/../../b", "/abs", "a//b", "a/./b", "a b.png", ""]) {
      if (c === "/abs") expect(cheminSur(c)).toBe("abs");
      else expect(() => cheminSur(c), c).toThrow();
    }
  });

  it("écrit, lit, mesure et supprime", async () => {
    await depot.ecrire("e1/ep/image.png", new Uint8Array([1, 2, 3]));
    expect([...(await depot.lire("e1/ep/image.png"))]).toEqual([1, 2, 3]);
    expect(await depot.taille("e1/ep/image.png")).toBe(3);
    await depot.supprimer(["e1/ep/image.png", null, "../hors"]);
    expect(await depot.taille("e1/ep/image.png")).toBeNull();
  });

  it("signe des adresses à durée limitée", () => {
    const maintenant = Date.UTC(2026, 0, 1);
    const adresse = depot.adresseSignee("e1/ep/clip.mp4", 60, maintenant);
    const u = new URL(adresse, "http://x");
    expect(u.pathname).toBe("/api/medias/e1/ep/clip.mp4");
    const e = u.searchParams.get("e");
    const s = u.searchParams.get("s");
    expect(depot.verifier("e1/ep/clip.mp4", e, s, maintenant)).toBe(true);
    expect(depot.verifier("e1/ep/autre.mp4", e, s, maintenant)).toBe(false);
    expect(depot.verifier("e1/ep/clip.mp4", e, s, maintenant + 61_000)).toBe(false);
    expect(depot.verifier("e1/ep/clip.mp4", String(Number(e) + 1000), s, maintenant)).toBe(false);
    expect(new Depot(join(dossier, "medias"), "autre-secret").verifier("e1/ep/clip.mp4", e, s, maintenant)).toBe(false);
  });
});

describe("configuration", () => {
  it("SQLite dans le dossier des données par défaut, PostgreSQL avec DATABASE_URL", () => {
    const c = configBase({ DONNEES_DIR: "/donnees" });
    expect(c).toEqual({ url: "sqlite:/donnees/studio.db", dossierDonnees: "/donnees", dossierMedias: "/donnees/medias" });
    expect(configBase({ DONNEES_DIR: "/d", DATABASE_URL: "postgres://u:p@h:5432/b" }).url).toBe("postgres://u:p@h:5432/b");
    expect(configBase({ DONNEES_DIR: "/d", DATABASE_URL: "file:/autre/base.db" }).url).toBe("sqlite:/autre/base.db");
  });

  it("génère une clé de chiffrement au premier lancement et la garde", () => {
    const env: Record<string, string | undefined> = {};
    const cle = assurerCleChiffrement(join(dossier, "donnees"), env);
    expect(Buffer.from(cle, "base64")).toHaveLength(32);
    expect(env.ENCRYPTION_KEY).toBe(cle);
    expect(assurerCleChiffrement(join(dossier, "donnees"), {})).toBe(cle);
    expect(assurerCleChiffrement(join(dossier, "donnees"), { ENCRYPTION_KEY: "fournie" })).toBe("fournie");
  });
});
