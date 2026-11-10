// Tests des clips musicaux : paroles, alignement, découpage calé sur la chanson, sous-titres, plan de composition.
import { describe, expect, it } from "vitest";
import {
  analyserParoles,
  decouperClip,
  decouperInstrumental,
  dureeComposition,
  dureeGenerationClip,
  dureesParPlan,
  dureeTotale,
  etatEpisode,
  extraitClip,
  extraitParDefaut,
  legende,
  lignesDepuisTranscription,
  livrablePour,
  planComposition,
  promptClip,
  propositionsTitres,
  regrouperEnLignes,
  reperesParoles,
  verifierDureePublication,
  coutUnite,
  type Episode,
  type Fichier,
  type LigneParole,
} from "../src/index";

const PAROLES = `[Couplet 1]
Je marche seul dans la nuit
Les néons dansent sous la pluie

[Refrain]
On s'envole ce soir
Plus rien ne peut nous voir

[Couplet 2]
La ville dort, moi je vis

[Refrain]
On s'envole ce soir
Plus rien ne peut nous voir`;

function episode(extra: Partial<Episode> = {}): Episode {
  return {
    id: "c1", serie_id: "s1", saison_id: "sa1", genre: "clip", numero: 1, titre: "Envol", idee: "", format: "court", duree_cible: 60,
    langue: "fr", langues: ["fr"], sous_titres: { fr: "fr" }, prises: 1, enchainer: true, musique: false, bruitages: false,
    chapitres: [], titres_traduits: {}, choix_titres: {}, miniature: null, memoire_faite: false, hashtags: {},
    style_visuel: "", paroles: PAROLES, paroles_alignees: null, paroles_traduites: {}, bpm: null, extrait_debut: 0, extrait_fin: null,
    musique_style: "synthpop", instrumental: false, fournisseur_texte: "openai", cree_le: "2026-01-01", ...extra,
  };
}

/** Lignes alignées d'exemple : une ligne toutes les 4 s à partir de 8 s, avec un pont instrumental après la 5e ligne. */
function lignesExemple(): LigneParole[] {
  const { lignes } = analyserParoles(PAROLES);
  return lignes.map((texte, i) => {
    const debut = 8 + i * 4 + (i >= 5 ? 10 : 0);
    return { texte, debut, fin: debut + 3.4 };
  });
}

describe("paroles", () => {
  it("lit les sections et ignore les en-têtes et lignes vides", () => {
    const { sections, lignes } = analyserParoles(PAROLES);
    expect(sections.map((s) => s.nom)).toEqual(["Couplet 1", "Refrain", "Couplet 2", "Refrain"]);
    expect(lignes).toHaveLength(7);
    expect(lignes[0]).toBe("Je marche seul dans la nuit");
  });

  it("range des paroles sans en-tête dans une seule section", () => {
    expect(analyserParoles("ligne un\n\nligne deux").sections).toEqual([{ nom: "Chanson", lignes: ["ligne un", "ligne deux"] }]);
  });

  it("regroupe les mots alignés en lignes", () => {
    const lignes = ["Je marche seul", "dans la nuit"];
    const mots = ["Je", "marche", "seul", "dans", "la", "nuit"].map((text, i) => ({ text, start: i, end: i + 0.8 }));
    expect(regrouperEnLignes(lignes, mots)).toEqual([
      { texte: "Je marche seul", debut: 0, fin: 2.8 },
      { texte: "dans la nuit", debut: 3, fin: 5.8 },
    ]);
  });

  it("suit les caractères quand les mots ne correspondent pas (japonais)", () => {
    const lignes = ["夜の街", "空へ"];
    const caracteres = [..."夜の街空へ"].map((text, i) => ({ text, start: i, end: i + 0.5 }));
    const out = regrouperEnLignes(lignes, [{ text: "夜の街空へ", start: 0, end: 4.5 }], caracteres);
    expect(out).toEqual([
      { texte: "夜の街", debut: 0, fin: 2.5 },
      { texte: "空へ", debut: 3, fin: 4.5 },
    ]);
  });

  it("répartit à défaut les lignes sur la durée chantée, sans chevauchement", () => {
    const out = regrouperEnLignes(["a b", "c d e f"], [{ text: "x", start: 10, end: 16 }]);
    expect(out[0]?.debut).toBe(10);
    expect(out[1]?.fin).toBe(16);
    expect((out[0]?.fin ?? 0) <= (out[1]?.debut ?? 0)).toBe(true);
  });

  it("fabrique des lignes depuis une transcription (silences et fins de phrase)", () => {
    const mots = [
      { text: "Hello", start: 0, end: 0.4, type: "word" },
      { text: " ", start: 0.4, end: 0.5, type: "spacing" },
      { text: "world.", start: 0.5, end: 1, type: "word" },
      { text: "Again", start: 3, end: 3.5, type: "word" },
      { text: "here", start: 3.6, end: 4, type: "word" },
    ];
    expect(lignesDepuisTranscription(mots, "en")).toEqual([
      { texte: "Hello world.", debut: 0, fin: 1 },
      { texte: "Again here", debut: 3, fin: 4 },
    ]);
  });
});

describe("extrait et découpage", () => {
  it("borne l'extrait par la chanson et par le format", () => {
    expect(extraitClip(episode({ format: "court" }), 300)).toEqual({ debut: 0, fin: 120 });
    expect(extraitClip(episode({ format: "moyen", extrait_debut: 30 }), 200)).toEqual({ debut: 30, fin: 200 });
    expect(extraitClip(episode({ format: "long", extrait_debut: 10, extrait_fin: 90 }), 200)).toEqual({ debut: 10, fin: 90 });
  });

  it("propose un extrait vertical qui commence juste avant le chant", () => {
    expect(extraitParDefaut(lignesExemple(), 240, "court")).toEqual({ debut: 7, fin: 127 });
    expect(extraitParDefaut(lignesExemple(), 240, "moyen")).toEqual({ debut: 0, fin: 240 });
  });

  it("découpe sur les paroles : plans contigus, entre 2,5 et 15 s, refrain en climax", () => {
    const extrait = { debut: 0, fin: 64 };
    const segs = decouperClip({ lignes: lignesExemple(), extrait, bpm: null });
    expect(segs[0]?.debut).toBe(0);
    expect(segs[segs.length - 1]?.fin).toBe(64);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!;
      expect(s.fin - s.debut).toBeGreaterThanOrEqual(2.5);
      expect(s.fin - s.debut).toBeLessThanOrEqual(15);
      if (i > 0) expect(s.debut).toBe(segs[i - 1]!.fin);
    }
    expect(segs[0]?.type).toBe("accroche");
    expect(segs[segs.length - 1]?.type).toBe("final");
    expect(segs.some((s) => s.type === "climax" && s.texte.includes("On s'envole ce soir"))).toBe(true);
    // Une coupe tombe sur le début de la première ligne chantée.
    expect(segs.some((s) => s.debut === 8)).toBe(true);
    // Le pont instrumental a son propre plan, sans paroles.
    expect(segs.some((s) => s.texte === "" && s.debut > 20)).toBe(true);
  });

  it("cale les coupes sur le temps quand le tempo est connu", () => {
    const lignes: LigneParole[] = [
      { texte: "un", debut: 2, fin: 5 },
      { texte: "deux", debut: 6.1, fin: 9 },
      { texte: "trois", debut: 9.9, fin: 13 },
    ];
    // 120 BPM : un temps toutes les 0,5 s à partir de 2 s.
    const segs = decouperClip({ lignes, extrait: { debut: 0, fin: 16 }, bpm: 120 });
    for (const s of segs.slice(1)) expect(((s.debut - 2) / 0.5) % 1).toBeCloseTo(0, 5);
  });

  it("découpe une musique instrumentale en plans réguliers", () => {
    const segs = decouperInstrumental({ debut: 0, fin: 30 }, 120);
    expect(segs.length).toBeGreaterThanOrEqual(5);
    expect(segs[segs.length - 1]?.fin).toBe(30);
    expect(segs.every((s) => s.texte === "")).toBe(true);
  });

  it("demande à Grok le palier juste au-dessus de la durée du plan", () => {
    expect(dureeGenerationClip(2.6)).toBe(3);
    expect(dureeGenerationClip(5)).toBe(5);
    expect(dureeGenerationClip(5.2)).toBe(8);
    expect(dureeGenerationClip(14.9)).toBe(15);
    expect(coutUnite({ cle: "p:clip:A", genre: "clip", plan: null, langue: null, prise: "A" }, 4.2, { image: 0, video_seconde: 0.1, voix_1000_car: 0 })).toBeCloseTo(0.5);
  });

  it("utilise la place des plans dans la chanson comme durée", () => {
    const plans = [
      { id: "a", type: "accroche" as const, duree_fixee: null, debut: 7, fin: 10.5 },
      { id: "b", type: "final" as const, duree_fixee: null, debut: 10.5, fin: 16 },
    ];
    expect([...dureesParPlan(plans, 60, "long").values()]).toEqual([3.5, 5.5]);
    expect(dureeTotale(plans, 60, "long", true)).toBe(9);
  });
});

describe("sous-titres des paroles", () => {
  it("place les lignes en temps relatif à l'extrait, sans chevauchement", () => {
    const lignes: LigneParole[] = [
      { texte: "avant", debut: 1, fin: 4 },
      { texte: "première", debut: 10, fin: 13.9 },
      { texte: "seconde", debut: 14, fin: 17 },
    ];
    const r = reperesParoles({ lignes, traductions: {}, extrait: { debut: 9, fin: 30 }, choix: "fr", langueChanson: "fr" });
    expect(r).toEqual([
      { debut: 1, fin: 5, texte: "première" },
      { debut: 5, fin: 8.3, texte: "seconde" },
    ]);
  });

  it("affiche la traduction demandée, ou rien sans traduction", () => {
    const lignes: LigneParole[] = [{ texte: "bonjour", debut: 0, fin: 2 }];
    expect(reperesParoles({ lignes, traductions: { en: ["hello"] }, extrait: { debut: 0, fin: 10 }, choix: "en", langueChanson: "fr" })[0]?.texte).toBe("hello");
    expect(reperesParoles({ lignes, traductions: {}, extrait: { debut: 0, fin: 10 }, choix: "ja", langueChanson: "fr" })).toEqual([]);
    expect(reperesParoles({ lignes, traductions: {}, extrait: { debut: 0, fin: 10 }, choix: "aucun", langueChanson: "fr" })).toEqual([]);
  });
});

describe("plan de composition", () => {
  it("respecte la durée voulue et les bornes d'ElevenLabs", () => {
    const plan = planComposition({ paroles: PAROLES, style: "synthpop, voix féminine, 110 BPM", dureeCible: 90, instrumental: false });
    expect(plan.positive_global_styles).toEqual(["synthpop", "voix féminine", "110 BPM"]);
    expect(plan.sections[0]?.lines).toEqual([]);
    expect(plan.sections.map((s) => s.section_name)).toContain("Refrain");
    expect(Math.abs(dureeComposition(plan) - 90)).toBeLessThan(2);
    for (const s of plan.sections) {
      expect(s.duration_ms).toBeGreaterThanOrEqual(3000);
      expect(s.duration_ms).toBeLessThanOrEqual(120000);
    }
  });

  it("produit une musique sans chant quand c'est demandé", () => {
    const plan = planComposition({ paroles: PAROLES, style: "", dureeCible: 30, instrumental: true });
    expect(plan.negative_global_styles).toContain("vocals");
    expect(plan.sections.every((s) => s.lines.length === 0)).toBe(true);
  });

  it("ne dépasse jamais 10 minutes", () => {
    const longues = Array.from({ length: 200 }, (_, i) => `ligne ${i}`).join("\n");
    expect(dureeComposition(planComposition({ paroles: longues, style: "rock", dureeCible: 2000, instrumental: false }))).toBeLessThanOrEqual(600);
  });
});

describe("publication et état d'un clip", () => {
  const serie = { nom: "Nova", hashtags: {} };

  it("titre « Titre (Clip officiel) » et hashtags musique", () => {
    expect(propositionsTitres(episode(), serie, "fr")).toEqual(["Envol (Clip officiel)", "Nova — Envol", "Envol"]);
    expect(legende(episode(), serie, "en", "tiktok").tags).toContain("#musicvideo");
  });

  it("un clip 16:9 ne part que sur YouTube, 4:00 max en format moyen", () => {
    expect(livrablePour({ format: "moyen", genre: "clip" }, "tiktok")).toBe("film");
    expect(verifierDureePublication({ reseau: "tiktok", livrable: "film", format: "moyen", duree: 200, genre: "clip" })).toContain("YouTube");
    expect(verifierDureePublication({ reseau: "youtube", livrable: "film", format: "moyen", duree: 260, genre: "clip" })).toContain("4:00");
    expect(verifierDureePublication({ reseau: "youtube", livrable: "film", format: "long", duree: 420, genre: "clip" })).toBeNull();
    expect(verifierDureePublication({ reseau: "instagram", livrable: "court", format: "court", duree: 119, genre: "clip" })).toBeNull();
  });

  it("guide l'utilisateur : chanson, synchronisation, découpage", () => {
    const base = { plans: [], personnages: [], taches: [], publications: [] };
    expect(etatEpisode({ ...base, episode: episode(), fichiers: [] }).action).toBe("Ajouter la chanson");
    const chanson = { id: "f", espace_id: "e", episode_id: "c1", plan_id: null, personnage_id: null, genre: "chanson", langue: null, prise: null, chemin: "e/x.mp3", duree_s: 180, secondes_generation: null, cout: 0, statut: "pret", erreur: null, essais: 1, cree_le: "2026-01-01" } satisfies Fichier;
    const e1 = etatEpisode({ ...base, episode: episode(), fichiers: [chanson] });
    expect([e1.etape, e1.action]).toEqual(["son", "Synchroniser les paroles"]);
    const e2 = etatEpisode({ ...base, episode: episode({ paroles_alignees: lignesExemple() }), fichiers: [chanson] });
    expect([e2.etape, e2.action]).toEqual(["scenario", "Découper le clip"]);
  });

  it("donne à l'IA un segment par plan avec ses paroles", () => {
    const segs = decouperClip({ lignes: lignesExemple(), extrait: { debut: 0, fin: 64 }, bpm: null });
    const p = promptClip({ serie: { nom: "Nova", style_visuel: "néon" }, episode: episode(), personnages: [], segments: segs.map((s, index) => ({ index, ...s })) });
    expect(p.user).toContain(`Segments (${segs.length})`);
    expect(p.user).toContain("« Je marche seul dans la nuit");
    expect(p.system).toContain("JSON");
  });
});
