// Tests de la signature et de la vérification du cookie « state » des connexions OAuth.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { creerEtat, DUREE_ETAT_MS, verifierEtat } from "../lib/etat-oauth";

const CLE = randomBytes(32);
const ESPACE = "6f1c2a7e-3b9d-4c55-8e0a-2d4b6f8a1c3e";
const T0 = 1_800_000_000_000;

describe("état OAuth", () => {
  it("valide un aller-retour normal et rend l'espace", () => {
    const { state, cookie } = creerEtat(ESPACE, "youtube", CLE, T0);
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(verifierEtat(cookie, state, "youtube", CLE, T0 + 60_000)).toEqual({ ok: true, espaceId: ESPACE });
  });

  it("refuse un state différent", () => {
    const { cookie } = creerEtat(ESPACE, "youtube", CLE, T0);
    const autre = creerEtat(ESPACE, "youtube", CLE, T0).state;
    expect(verifierEtat(cookie, autre, "youtube", CLE, T0).ok).toBe(false);
  });

  it("refuse un cookie modifié", () => {
    const { state, cookie } = creerEtat(ESPACE, "tiktok", CLE, T0);
    const [contenu, signature] = cookie.split(".") as [string, string];
    const falsifie = Buffer.from(JSON.stringify({ s: state, e: "00000000-0000-4000-8000-000000000000", r: "tiktok", t: T0 })).toString("base64url");
    expect(verifierEtat(`${falsifie}.${signature}`, state, "tiktok", CLE, T0).ok).toBe(false);
    expect(verifierEtat(`${contenu}.${signature}x`, state, "tiktok", CLE, T0).ok).toBe(false);
  });

  it("refuse une autre clé, un autre réseau, un cookie absent", () => {
    const { state, cookie } = creerEtat(ESPACE, "instagram", CLE, T0);
    expect(verifierEtat(cookie, state, "instagram", randomBytes(32), T0).ok).toBe(false);
    expect(verifierEtat(cookie, state, "youtube", CLE, T0).ok).toBe(false);
    expect(verifierEtat(undefined, state, "instagram", CLE, T0).ok).toBe(false);
    expect(verifierEtat(cookie, null, "instagram", CLE, T0).ok).toBe(false);
  });

  it("refuse une tentative expirée", () => {
    const { state, cookie } = creerEtat(ESPACE, "youtube", CLE, T0);
    expect(verifierEtat(cookie, state, "youtube", CLE, T0 + DUREE_ETAT_MS + 1).ok).toBe(false);
  });
});
