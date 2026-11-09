// Tests des statistiques : engagement, tri des vidéos, abonnés, agrégation des revenus et tracé des courbes.
import type { Revenu, StatsCompte, VideoReseau } from "@studio-video-ia/core";
import { describe, expect, it } from "vitest";
import { abonnesEtVariation, agregerRevenus, douzeDerniersMois, engagement, texteParDevise, traceCourbe, trierVideos, vuesSurPeriode } from "../lib/statistiques";

/** Vidéo factice. */
function video(id: string, publiee_le: string | null, vues: number, jaime: number, revenu: number | null = null): VideoReseau {
  return { id, reseau_connecte_id: "c1", id_externe: id, publication_id: null, titre: id, url: null, miniature_url: null, publiee_le, duree_s: null, vues, jaime, commentaires: 0, partages: 0, revenu_estime: revenu, devise: revenu === null ? null : "EUR", maj_le: "2026-11-01T00:00:00Z" };
}

/** Revenu factice. */
function revenu(compte: string, mois: string, montant: number, source: Revenu["source"] = "manuel", devise = "EUR"): Revenu {
  return { id: `${compte}${mois}${source}`, reseau_connecte_id: compte, mois: `${mois}-01`, montant, devise, source, note: "", cree_le: "2026-11-01T00:00:00Z" };
}

describe("engagement", () => {
  it("rapporte les interactions aux vues", () => {
    expect(engagement({ vues: 1000, jaime: 80, commentaires: 15, partages: 5 })).toBeCloseTo(0.1);
  });
  it("vaut 0 sans vue et accepte les valeurs absentes", () => {
    expect(engagement({ vues: 0, jaime: 3 })).toBe(0);
    expect(engagement({ vues: 200, jaime: null })).toBe(0);
  });
});

describe("trierVideos", () => {
  const liste = [video("a", "2026-11-01T10:00:00Z", 500, 10), video("b", "2026-11-05T10:00:00Z", 100, 50, 2), video("c", null, 900, 9), video("d", "2026-10-20T10:00:00Z", 100, 1, 5)];
  it("trie par date, les vidéos sans date en dernier", () => {
    expect(trierVideos(liste, "date", "desc").map((v) => v.id)).toEqual(["b", "a", "d", "c"]);
    expect(trierVideos(liste, "date", "asc").map((v) => v.id)).toEqual(["d", "a", "b", "c"]);
  });
  it("trie par vues, à égalité la plus récente d'abord", () => {
    expect(trierVideos(liste, "vues", "desc").map((v) => v.id)).toEqual(["c", "a", "b", "d"]);
  });
  it("trie par engagement et par revenu", () => {
    expect(trierVideos(liste, "engagement", "desc")[0]?.id).toBe("b");
    expect(trierVideos(liste, "revenu", "desc").map((v) => v.id)).toEqual(["d", "b", "a", "c"]);
  });
  it("ne modifie pas la liste d'origine", () => {
    trierVideos(liste, "vues", "asc");
    expect(liste[0]?.id).toBe("a");
  });
});

describe("agregerRevenus", () => {
  const comptes = [
    { id: "yt", reseau: "youtube" as const },
    { id: "tt", reseau: "tiktok" as const },
    { id: "ig", reseau: "instagram" as const },
  ];
  it("totalise le mois courant et les 12 derniers mois par réseau et par compte", () => {
    const a = agregerRevenus(
      [revenu("yt", "2026-11", 10.5, "api"), revenu("yt", "2026-10", 20, "api"), revenu("tt", "2026-11", 4.25), revenu("ig", "2025-11", 99), revenu("ig", "2025-12", 1)],
      comptes,
      "2026-11",
    );
    expect(a.moisCourant).toEqual({ EUR: 14.75 });
    // Novembre 2025 est hors des 12 derniers mois (décembre 2025 → novembre 2026).
    expect(a.douzeMois).toEqual({ EUR: 35.75 });
    expect(a.parReseau.youtube).toEqual({ mois: { EUR: 10.5 }, douzeMois: { EUR: 30.5 } });
    expect(a.parCompte.ig).toEqual({ mois: {}, douzeMois: { EUR: 1 } });
    expect(a.parMois).toHaveLength(12);
    expect(a.parMois[0]).toEqual({ mois: "2025-12", total: { EUR: 1 } });
    expect(a.parMois.at(-1)).toEqual({ mois: "2026-11", total: { EUR: 14.75 } });
  });
  it("ne compte pas deux fois un mois saisi à la main et lu par l'API", () => {
    const a = agregerRevenus([revenu("yt", "2026-11", 10, "api"), revenu("yt", "2026-11", 12, "manuel")], comptes, "2026-11");
    expect(a.moisCourant).toEqual({ EUR: 10 });
  });
  it("garde les devises séparées et ignore les comptes inconnus", () => {
    const a = agregerRevenus([revenu("tt", "2026-11", 3, "manuel", "USD"), revenu("tt", "2026-11", 2), revenu("zz", "2026-11", 50)], comptes, "2026-11");
    expect(a.moisCourant).toEqual({ USD: 3, EUR: 2 });
    expect(texteParDevise({})).toBe("—");
  });
  it("liste les 12 derniers mois en passant l'année", () => {
    expect(douzeDerniersMois("2026-02")).toEqual(["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("abonnés et vues", () => {
  /** Point d'historique factice. */
  const point = (jour: string, abonnes: number | null, vues_total: number | null = null): StatsCompte => ({ id: jour, reseau_connecte_id: "c1", jour, abonnes, abonnements: null, jaime_total: null, videos: null, vues_total, revenu_estime: null, devise: null });
  it("calcule la variation sur 7 jours à partir de la dernière valeur", () => {
    const h = [point("2026-11-01", 100, 1000), point("2026-11-02", 110, 1500), point("2026-11-09", 150, 4000), point("2026-11-08", null)];
    expect(abonnesEtVariation(h, 7)).toEqual({ abonnes: 150, variation: 40 });
    expect(vuesSurPeriode(h, 7)).toBe(2500);
  });
  it("renvoie null quand l'historique est trop court", () => {
    expect(abonnesEtVariation([point("2026-11-09", 150)], 7)).toEqual({ abonnes: 150, variation: null });
    expect(abonnesEtVariation([], 7)).toEqual({ abonnes: null, variation: null });
  });
});

describe("traceCourbe", () => {
  it("dessine une ligne dans le cadre", () => {
    expect(traceCourbe([0, 10], 104, 24)).toBe("M2.0 22.0 L102.0 2.0");
    expect(traceCourbe([5, 5, 5], 104, 24)).toBe("M2.0 12.0 L52.0 12.0 L102.0 12.0");
    expect(traceCourbe([], 100, 20)).toBe("");
  });
});
