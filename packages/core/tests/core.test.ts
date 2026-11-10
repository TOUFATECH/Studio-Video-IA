// Tests de la logique partagée : durées, unités, sous-titres, planning, titres, chiffrement, état d'un épisode.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  construireReperes,
  couperLignes,
  dureesParPlan,
  dureeTotale,
  etatEpisode,
  horodatageSrt,
  hashtagsPour,
  instantLocal,
  legende,
  normaliserHashtags,
  verifierDureePublication,
  languesATraduire,
  livrablePour,
  prochainCreneau,
  propositionsTitres,
  repartirDurees,
  unitesClips,
  unitesRendu,
  versSrt,
  type Episode,
  type Fichier,
  type Personnage,
  type Plan,
  type TypePlan,
} from "../src/index";
import { apercu, chiffrer, dechiffrer, lireCleMaitre } from "../src/chiffrement";

/** Fabrique un plan de test. */
function plan(id: string, type: TypePlan, extra: Partial<Plan> = {}): Plan {
  return { id, episode_id: "e1", position: 0, section: "principal", type, texte: `Plan ${id}`, personnage_id: null, replique: "", repliques_traduites: {}, duree_fixee: null, valide: false, modifie: false, prise_choisie: "A", debut: null, fin: null, ...extra };
}

/** Fabrique un épisode de test. */
function episode(extra: Partial<Episode> = {}): Episode {
  return {
    id: "e1", serie_id: "s1", saison_id: "sa1", genre: "episode", numero: 2, titre: "Le pont", idee: "idée", format: "court", duree_cible: 75,
    langue: "fr", langues: ["fr", "en"], sous_titres: { fr: "fr", en: "aucun" }, prises: 1, enchainer: true, musique: true, bruitages: true,
    chapitres: [], titres_traduits: { ja: "橋" }, choix_titres: {}, miniature: null, memoire_faite: false, hashtags: {},
    style_visuel: "", paroles: "", paroles_alignees: null, paroles_traduites: {}, bpm: null, extrait_debut: 0, extrait_fin: null, musique_style: "", instrumental: false, fournisseur_texte: "openai",
    cree_le: "2026-01-01", ...extra,
  };
}

const TYPES_COURTS: TypePlan[] = ["accroche", "decor", "action", "dialogue", "action", "decor", "action", "climax", "action", "climax", "final"];

describe("durées", () => {
  it("atteint exactement 75 s avec 11 plans", () => {
    const plans = TYPES_COURTS.map((t, i) => ({ id: String(i), type: t, duree_fixee: null }));
    const d = repartirDurees(plans, 75);
    expect(d.reduce((a, b) => a + b, 0)).toBe(75);
    expect(d.every((x) => [3, 5, 8, 10, 15].includes(x))).toBe(true);
    expect(d[0]).toBe(3); // l'accroche reste courte
  });
  it("respecte une durée fixée à la main", () => {
    const plans = TYPES_COURTS.map((t, i) => ({ id: String(i), type: t, duree_fixee: i === 2 ? 15 : null }));
    expect(repartirDurees(plans, 75)[2]).toBe(15);
  });
  it("répartit un film par chapitre et ajoute les génériques", () => {
    const plans = Array.from({ length: 24 }, (_, i) => ({ id: String(i), type: TYPES_COURTS[i % 11] ?? "action", duree_fixee: null, section: i < 12 ? "ch1" : "ch2" }));
    const total = dureeTotale(plans, 300, "long", true);
    expect(total).toBeGreaterThan(280);
    expect(total).toBeLessThanOrEqual(310);
    expect(dureesParPlan(plans, 300, "long").size).toBe(24);
  });
});

describe("unités", () => {
  const persos: Personnage[] = [
    { id: "p1", serie_id: "s1", nom: "Kaï", description: "", source_voix: "elevenlabs", voix_id: "v1", accord_clone: false, fiche_chemin: null, fiche_statut: "prete", position: 0 },
    { id: "p2", serie_id: "s1", nom: "Brutus", description: "", source_voix: "grok", voix_id: "", accord_clone: false, fiche_chemin: null, fiche_statut: "a_faire", position: 1 },
  ];
  it("ajoute une voix par langue pour les dialogues ElevenLabs seulement", () => {
    const plans = [plan("a", "dialogue", { personnage_id: "p1", replique: "Bonjour" }), plan("b", "dialogue", { personnage_id: "p2", replique: "Grr" }), plan("c", "action")];
    const u = unitesClips(episode({ prises: 2 }), plans, persos);
    expect(u.filter((x) => x.genre === "clip")).toHaveLength(6);
    expect(u.filter((x) => x.genre === "voix").map((x) => x.cle)).toEqual(["a:voix:fr", "a:voix:en"]);
  });
  it("ajoute la bande annonce pour un film", () => {
    expect(unitesRendu(episode({ format: "long" })).map((u) => u.cle)).toEqual(["rendu:fr", "rendu:en", "bande_annonce"]);
  });
});

describe("sous-titres", () => {
  const plans = [plan("a", "accroche"), plan("b", "dialogue", { personnage_id: "p1", replique: "Je vais rentrer.", repliques_traduites: { en: "I'm going home." } })];
  const durees = new Map([["a", 3], ["b", 8]]);
  it("place la réplique au bon moment dans la langue choisie", () => {
    const r = construireReperes({ plans, durees, choix: "en", langueOrigine: "fr" });
    expect(r).toHaveLength(1);
    expect(r[0]?.texte).toBe("I'm going home.");
    expect(r[0]?.debut).toBeCloseTo(3.2);
    expect(versSrt(r)).toContain("00:00:03,200 --> 00:00:10,800");
  });
  it("ne produit rien quand on choisit « aucun »", () => {
    expect(construireReperes({ plans, durees, choix: "aucun", langueOrigine: "fr" })).toEqual([]);
  });
  it("décale d'un opening de 30 s dans un film", () => {
    const r = construireReperes({ plans, durees, choix: "fr", langueOrigine: "fr", decalage: 30 });
    expect(r[0]?.debut).toBeCloseTo(33.2);
  });
  it("coupe les lignes trop longues", () => {
    expect(couperLignes("Un texte vraiment très long qui dépasse largement la limite de quarante-deux caractères", "fr")).toHaveLength(2);
    expect(couperLignes("月を追うべきではなかった誰も予想していなかった", "ja")[0]?.length).toBe(16);
  });
  it("formate l'horodatage SRT", () => {
    expect(horodatageSrt(3725.5)).toBe("01:02:05,500");
  });
  it("liste les langues à traduire (voix et sous-titres)", () => {
    expect(languesATraduire("fr", ["fr", "ja"], { fr: "en", ja: "ja" }).sort()).toEqual(["en", "ja"]);
  });
});

describe("planning", () => {
  it("convertit une heure locale de Mayotte (UTC+3) en UTC", () => {
    expect(instantLocal("2026-11-12", "18:30", "Indian/Mayotte").toISOString()).toBe("2026-11-12T15:30:00.000Z");
  });
  it("gère le changement d'heure à Paris", () => {
    expect(instantLocal("2026-07-01", "12:00", "Europe/Paris").toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(instantLocal("2026-12-01", "12:00", "Europe/Paris").toISOString()).toBe("2026-12-01T11:00:00.000Z");
  });
  it("propose demain si l'heure du jour est passée", () => {
    const maintenant = new Date("2026-11-12T16:00:00Z"); // 19:00 à Mayotte
    expect(prochainCreneau({ tous_les_jours: 2, heure: "18:30" }, null, maintenant, "Indian/Mayotte").toISOString()).toBe("2026-11-13T15:30:00.000Z");
  });
  it("se place N jours après la dernière publication programmée", () => {
    const maintenant = new Date("2026-11-12T08:00:00Z");
    const derniere = new Date("2026-11-14T15:30:00Z");
    expect(prochainCreneau({ tous_les_jours: 2, heure: "18:30" }, derniere, maintenant, "Indian/Mayotte").toISOString()).toBe("2026-11-16T15:30:00.000Z");
  });
});

describe("titres et livrables", () => {
  it("formate le titre japonais et utilise la traduction", () => {
    expect(propositionsTitres(episode(), { nom: "Le renard néon" }, "ja")[0]).toBe("第2話「橋」");
  });
  it("publie le film sur YouTube et la bande annonce ailleurs", () => {
    expect(livrablePour({ format: "long" }, "youtube")).toBe("film");
    expect(livrablePour({ format: "long" }, "tiktok")).toBe("bande_annonce");
    expect(livrablePour({ format: "court" }, "instagram")).toBe("court");
  });
});

describe("chiffrement", () => {
  const cle = lireCleMaitre(randomBytes(32).toString("base64"));
  it("chiffre puis déchiffre", () => {
    const c = chiffrer("sk-secret-1234", cle);
    expect(c.startsWith("v1.")).toBe(true);
    expect(c).not.toContain("secret");
    expect(dechiffrer(c, cle)).toBe("sk-secret-1234");
  });
  it("refuse une valeur modifiée", () => {
    const c = chiffrer("abc", cle);
    const parts = c.split(".");
    const corrompu = [parts[0], parts[1], parts[2], Buffer.from("zzz").toString("base64")].join(".");
    expect(() => dechiffrer(corrompu, cle)).toThrow();
  });
  it("refuse une clé maître de mauvaise taille", () => {
    expect(() => lireCleMaitre(Buffer.from("court").toString("base64"))).toThrow();
  });
  it("n'affiche que les 4 derniers caractères", () => {
    expect(apercu("sk-abcdef9876")).toBe("9876");
  });
});

describe("état d'un épisode", () => {
  it("passe de « Storyboard à valider » à « Clips à lancer »", () => {
    const plans = [plan("a", "accroche"), plan("b", "final")];
    const fichiers: Fichier[] = plans.map((p) => ({ id: p.id, espace_id: "w", episode_id: "e1", plan_id: p.id, personnage_id: null, genre: "image", langue: null, prise: null, chemin: "x", duree_s: null, secondes_generation: 10, cout: 0.04, statut: "pret", erreur: null, essais: 1, cree_le: "2026-01-01" }));
    const base = { episode: episode(), personnages: [], fichiers, taches: [], publications: [] };
    expect(etatEpisode({ ...base, plans }).statut).toBe("Storyboard à valider");
    expect(etatEpisode({ ...base, plans: plans.map((p) => ({ ...p, valide: true })) }).statut).toBe("Clips à lancer");
  });
});

describe("hashtags", () => {
  it("nettoie une saisie libre et retire les doublons", () => {
    expect(normaliserHashtags("histoire, #Anime  série #anime", "tiktok")).toBe("#histoire #anime #série");
  });
  it("garde les hashtags japonais et limite Instagram à 30", () => {
    expect(normaliserHashtags("#アニメ #物語", "instagram")).toBe("#アニメ #物語");
    const beaucoup = Array.from({ length: 40 }, (_, i) => `#mot${i}`).join(" ");
    expect(normaliserHashtags(beaucoup, "instagram").split(" ")).toHaveLength(30);
  });
  it("prend ceux de l'épisode, puis de la série, puis par défaut", () => {
    const base = { reseau: "tiktok" as const, langue: "fr" as const, nomSerie: "Le renard néon" };
    expect(hashtagsPour({ ...base, serie: { tiktok: "#renard" }, episode: { tiktok: "#pont" } })).toBe("#pont");
    expect(hashtagsPour({ ...base, serie: { tiktok: "#renard" }, episode: {} })).toBe("#renard");
    expect(hashtagsPour({ ...base, serie: {}, episode: {} })).toBe("#histoire #animation #série #lerenardnéon");
  });
  it("met les hashtags du réseau dans la légende", () => {
    const l = legende(episode({ hashtags: { instagram: "#reel" } }), { nom: "Série", hashtags: { instagram: "#serie" } }, "fr", "instagram");
    expect(l.tags).toBe("#reel");
    expect(l.description.endsWith("#reel")).toBe(true);
  });
});

describe("durées par réseau", () => {
  it("accepte un court de 2:00 sur TikTok et refuse 2:30", () => {
    expect(verifierDureePublication({ reseau: "tiktok", livrable: "court", format: "court", duree: 120 })).toBeNull();
    expect(verifierDureePublication({ reseau: "instagram", livrable: "court", format: "court", duree: 150 })).toContain("2:00");
  });
  it("limite le Short YouTube à 3:00 et l'épisode YouTube à 4:00", () => {
    expect(verifierDureePublication({ reseau: "youtube", livrable: "court", format: "court", duree: 179 })).toBeNull();
    expect(verifierDureePublication({ reseau: "youtube", livrable: "film", format: "moyen", duree: 240 })).toBeNull();
    expect(verifierDureePublication({ reseau: "youtube", livrable: "film", format: "moyen", duree: 260 })).toContain("4:00");
  });
  it("publie l'épisode YouTube en entier sur YouTube et en bande annonce ailleurs", () => {
    expect(livrablePour({ format: "moyen" }, "youtube")).toBe("film");
    expect(livrablePour({ format: "moyen" }, "tiktok")).toBe("bande_annonce");
    expect(unitesRendu(episode({ format: "moyen", langues: ["fr"] })).map((u) => u.cle)).toEqual(["rendu:fr", "bande_annonce"]);
  });
  it("atteint 2:00 en court et 4:00 en épisode YouTube", () => {
    const types: TypePlan[] = ["accroche", "decor", "action", "dialogue", "action", "decor", "action", "climax", "dialogue", "action", "decor", "action", "climax", "action", "dialogue", "action", "final"];
    const plans = types.map((t, i) => ({ id: String(i), type: t, duree_fixee: null }));
    expect(repartirDurees(plans, 120).reduce((a, b) => a + b, 0)).toBe(120);
    expect(dureeTotale(plans, 240, "moyen", true)).toBe(240);
  });
});
