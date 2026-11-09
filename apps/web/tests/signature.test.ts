// Tests de la détection du type réel des fichiers importés (signature binaire).
import { describe, expect, it } from "vitest";
import { detecterType, verifierImport } from "../lib/signature";

/** Octets à partir d'une liste de nombres et de textes ASCII. */
function octets(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const c of p) out.push(c.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
}

const PNG = octets([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = octets([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = octets("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ");
const WAV = octets("RIFF", [0x24, 0, 0, 0], "WAVEfmt ");
const MP3_ID3 = octets("ID3", [4, 0, 0, 0, 0, 0, 0]);
const MP3_TRAME = octets([0xff, 0xfb, 0x90, 0x64]);
const M4A = octets([0, 0, 0, 0x20], "ftypM4A ", [0, 0, 0, 0]);
const SVG = octets('﻿  <?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'.replace("﻿", ""));

describe("detecterType", () => {
  it("reconnaît les images", () => {
    expect(detecterType(PNG)).toBe("png");
    expect(detecterType(JPEG)).toBe("jpeg");
    expect(detecterType(WEBP)).toBe("webp");
  });
  it("reconnaît les fichiers audio", () => {
    expect(detecterType(WAV)).toBe("wav");
    expect(detecterType(MP3_ID3)).toBe("mp3");
    expect(detecterType(MP3_TRAME)).toBe("mp3");
    expect(detecterType(M4A)).toBe("m4a");
  });
  it("repère le SVG, même précédé d'espaces", () => {
    expect(detecterType(SVG)).toBe("svg");
    expect(detecterType(octets("<svg onload='x'></svg>"))).toBe("svg");
  });
  it("ne reconnaît pas un texte ou un exécutable", () => {
    expect(detecterType(octets("<html><script>alert(1)</script>"))).toBeNull();
    expect(detecterType(octets("MZ", [0x90, 0]))).toBeNull();
    expect(detecterType(new Uint8Array())).toBeNull();
  });
});

describe("verifierImport", () => {
  it("accepte une image pour une fiche et donne l'extension réelle", () => {
    expect(verifierImport("fiche", JPEG, 1000)).toEqual({ ok: true, type: "jpeg", extension: "jpg", mime: "image/jpeg" });
  });
  it("refuse un fichier audio déguisé en image", () => {
    const r = verifierImport("fiche", MP3_ID3, 1000);
    expect(r.ok).toBe(false);
  });
  it("refuse le SVG avec un message clair", () => {
    expect(verifierImport("fiche", SVG, 100)).toEqual({ ok: false, erreur: "Les images SVG sont refusées." });
  });
  it("refuse une image comme échantillon de voix", () => {
    expect(verifierImport("echantillon_voix", PNG, 100).ok).toBe(false);
    expect(verifierImport("musique", WAV, 100).ok).toBe(true);
  });
  it("applique les tailles maximales", () => {
    expect(verifierImport("fiche", PNG, 10 * 1024 * 1024 + 1).ok).toBe(false);
    expect(verifierImport("echantillon_voix", MP3_ID3, 20 * 1024 * 1024).ok).toBe(true);
    expect(verifierImport("musique", MP3_ID3, 0).ok).toBe(false);
  });
});
