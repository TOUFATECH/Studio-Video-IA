// Tests des fonctions pures des tâches et des outils : bande annonce, prises, personnages, traductions, mémoire,
// vidéos des comptes, configuration, parallélisme et relance, tableau du diagnostic.
import { describe, expect, it } from "vitest";
import type { Episode, Fichier, FaitMemoire, Personnage, Plan, TypePlan } from "@feuilleton/core";
import { analyserEnv, ErreurConfig, lireConfig } from "../src/config";
import { avecRelance, enParallele, ErreurPlafond } from "../src/contexte";
import { aEchecBloquant, formaterTableau } from "../src/diagnostic-cli";
import { fichierPret, unitePrete } from "../src/donnees";
import { audioGrok, ratioClips, traductionsManquantes } from "../src/taches/clips";
import { mysteresResolus } from "../src/taches/memoire";
import { cleLivrable, statutTiktok } from "../src/taches/publication";
import { clipDuPlan, selectionBandeAnnonce } from "../src/taches/rendu";
import { trouverPersonnage } from "../src/taches/scenario";
import { lignesVideos } from "../src/taches/stats";
import { personnagesPresents, tailleImage } from "../src/taches/storyboard";
import { indexerFichiers } from "@feuilleton/core";

/** Plan de test. */
function plan(id: string, type: TypePlan, extra: Partial<Plan> = {}): Plan {
  return { id, episode_id: "e", position: 0, section: "principal", type, texte: `Plan ${id}`, personnage_id: null, replique: "", repliques_traduites: {}, duree_fixee: null, valide: true, modifie: false, prise_choisie: "A", ...extra };
}

/** Fichier de test. */
function fichier(extra: Partial<Fichier>): Fichier {
  return { id: Math.random().toString(36), espace_id: "s", episode_id: "e", plan_id: null, personnage_id: null, genre: "clip", langue: null, prise: "A", chemin: "x", duree_s: null, secondes_generation: null, cout: 0, statut: "pret", erreur: null, essais: 1, cree_le: "2026-01-01", ...extra };
}

const PERSOS: Personnage[] = [
  { id: "p1", serie_id: "s", nom: "Élodie", description: "", source_voix: "elevenlabs", voix_id: "v", accord_clone: false, fiche_chemin: null, fiche_statut: "prete", position: 0 },
  { id: "p2", serie_id: "s", nom: "Brutus", description: "", source_voix: "grok", voix_id: "", accord_clone: false, fiche_chemin: null, fiche_statut: "a_faire", position: 1 },
];

describe("rendu", () => {
  it("bande annonce : accroches et climax, 5 s chacun, 60 s au plus", () => {
    const plans = [plan("a", "accroche"), plan("b", "decor"), ...Array.from({ length: 14 }, (_, i) => plan(`c${i}`, "climax"))];
    const durees = new Map(plans.map((p) => [p.id, p.type === "accroche" ? 3 : 8]));
    const s = selectionBandeAnnonce(plans, durees);
    expect(s[0]).toEqual({ plan: plans[0], duree: 3 });
    expect(s.every((x) => x.duree <= 5)).toBe(true);
    expect(s.reduce((t, x) => t + x.duree, 0)).toBe(60);
    expect(s.some((x) => x.plan.type === "decor")).toBe(false);
  });
  it("prise choisie, sinon prise A", () => {
    const p = plan("a", "action", { prise_choisie: "B" });
    const avecB = indexerFichiers([fichier({ plan_id: "a", prise: "A" }), fichier({ plan_id: "a", prise: "B", chemin: "b" })]);
    expect(clipDuPlan(avecB, p)?.chemin).toBe("b");
    const sansB = indexerFichiers([fichier({ plan_id: "a", prise: "A", chemin: "a" }), fichier({ plan_id: "a", prise: "B", statut: "echec", chemin: null })]);
    expect(clipDuPlan(sansB, p)?.chemin).toBe("a");
  });
  it("unité prête seulement si le fichier le plus récent est prêt", () => {
    const f = [fichier({ plan_id: "a", genre: "image", cree_le: "2026-01-01" }), fichier({ plan_id: "a", genre: "image", statut: "echec", chemin: null, cree_le: "2026-01-02" })];
    expect(unitePrete(f, "a:image")).toBe(false);
    expect(fichierPret(f, "a:image")?.chemin).toBe("x");
  });
});

describe("scénario, storyboard, clips", () => {
  it("retrouve un personnage par son nom sans casse ni accents", () => {
    expect(trouverPersonnage(PERSOS, "  élodie ")?.id).toBe("p1");
    expect(trouverPersonnage(PERSOS, "ELODIE")?.id).toBe("p1");
    expect(trouverPersonnage(PERSOS, "Inconnu")).toBeNull();
    expect(trouverPersonnage(PERSOS, null)).toBeNull();
  });
  it("personnages présents : celui qui parle et ceux nommés dans le plan", () => {
    expect(personnagesPresents({ personnage_id: "p1", texte: "Brutus grogne" }, PERSOS).map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(personnagesPresents({ personnage_id: null, texte: "Une forêt" }, PERSOS)).toEqual([]);
  });
  it("formats d'image et de clip", () => {
    expect(tailleImage("court")).toBe("1024x1536");
    expect(tailleImage("long")).toBe("1536x1024");
    expect(ratioClips("court")).toBe("9:16");
    expect(ratioClips("long")).toBe("16:9");
  });
  it("audio Grok seulement pour un dialogue d'un personnage à voix Grok", () => {
    expect(audioGrok(plan("a", "dialogue", { personnage_id: "p2", replique: "Grr" }), PERSOS)).toBe(true);
    expect(audioGrok(plan("a", "dialogue", { personnage_id: "p1", replique: "Salut" }), PERSOS)).toBe(false);
    expect(audioGrok(plan("a", "action", { personnage_id: "p2", replique: "Grr" }), PERSOS)).toBe(false);
  });
  it("traductions manquantes : voix et sous-titres", () => {
    const ep = { langue: "fr", langues: ["fr", "en"], sous_titres: { fr: "ja", en: "aucun" }, titres_traduits: { en: "The bridge", ja: "橋" } } as unknown as Episode;
    const plans = [plan("a", "dialogue", { replique: "Bonjour", repliques_traduites: { en: "Hello" } })];
    expect(traductionsManquantes(ep, plans)).toEqual(["ja"]);
    expect(traductionsManquantes(ep, [plan("a", "dialogue", { replique: "Bonjour", repliques_traduites: { en: "Hello", ja: "こんにちは" } })])).toEqual([]);
  });
});

describe("mémoire, publication, statistiques", () => {
  it("ferme les mystères résolus par comparaison souple", () => {
    const ouverts = [{ id: "m1", texte: "Qui a volé la clé du phare ?" }, { id: "m2", texte: "Où est passé le chat ?" }] as Pick<FaitMemoire, "id" | "texte">[];
    expect(mysteresResolus(ouverts, ["qui a vole la cle du phare ?"])).toEqual(["m1"]);
    expect(mysteresResolus(ouverts, [])).toEqual([]);
  });
  it("fichier publié selon le livrable", () => {
    expect(cleLivrable({ livrable: "court", langue: "ja" })).toBe("rendu:ja");
    expect(cleLivrable({ livrable: "film", langue: "fr" })).toBe("rendu:fr");
    expect(cleLivrable({ livrable: "bande_annonce", langue: "fr" })).toBe("bande_annonce");
    expect(statutTiktok("SELF_ONLY")).toBe("privee");
    expect(statutTiktok("PUBLIC_TO_EVERYONE")).toBe("publiee");
  });
  it("lignes videos_reseau : publication reliée et revenus YouTube", () => {
    const v = { idExterne: "abc", titre: "T", url: null, miniatureUrl: null, publieeLe: null, dureeS: 60, vues: 5, jaime: 1, commentaires: 0, partages: 0 };
    const maintenant = new Date("2026-11-09T00:00:00Z");
    const [yt] = lignesVideos("c1", [v], new Map([["abc", "pub1"]]), new Map([["abc", 1.234]]), maintenant);
    expect(yt).toMatchObject({ reseau_connecte_id: "c1", id_externe: "abc", publication_id: "pub1", revenu_estime: 1.23, devise: "EUR", vues: 5 });
    const [tk] = lignesVideos("c2", [v], new Map(), null, maintenant);
    expect(tk).not.toHaveProperty("revenu_estime");
    expect(tk?.publication_id).toBeNull();
  });
});

describe("configuration", () => {
  const base = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "a".repeat(40), ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") };
  it("valeurs par défaut, dont WORKER_CONCURRENCY et INSTAGRAM_API_VERSION", () => {
    const c = lireConfig({ ...base, WORKER_TMP_DIR: "", FFMPEG_PATH: "" });
    expect(c.concurrence).toBe(2);
    expect(c.versionInstagram).toBe("v25.0");
    expect(c.ffmpeg).toBe("ffmpeg");
    expect(c.modeles.resolutionVideo).toBe("720p");
  });
  it("message clair listant les variables manquantes", () => {
    const e = (() => {
      try {
        lireConfig({ ENCRYPTION_KEY: "court" });
      } catch (x) {
        return x;
      }
      return null;
    })();
    expect(e).toBeInstanceOf(ErreurConfig);
    const msg = (e as ErreurConfig).message;
    expect(msg).toContain("NEXT_PUBLIC_SUPABASE_URL : manquante");
    expect(msg).toContain("SUPABASE_SERVICE_ROLE_KEY : manquante");
    expect(msg).toContain("ENCRYPTION_KEY");
  });
  it("refuse une concurrence hors limites", () => {
    expect(() => lireConfig({ ...base, WORKER_CONCURRENCY: "50" })).toThrow(ErreurConfig);
  });
  it("lit un fichier .env", () => {
    expect(analyserEnv("# commentaire\nA=1\nB=\"deux mots\"\nC=x # fin\nexport D='y'\nVIDE=\n")).toEqual({ A: "1", B: "deux mots", C: "x", D: "y", VIDE: "" });
  });
});

describe("outils", () => {
  it("parallélisme borné", async () => {
    let actifs = 0;
    let max = 0;
    const vus: number[] = [];
    await enParallele([1, 2, 3, 4, 5], 2, async (x) => {
      actifs++;
      max = Math.max(max, actifs);
      await new Promise((r) => setTimeout(r, 5));
      vus.push(x);
      actifs--;
    });
    expect(max).toBe(2);
    expect(vus.sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it("une relance automatique, jamais pour le plafond", async () => {
    let n = 0;
    const r = await avecRelance(async () => {
      if (++n === 1) throw new Error("passager");
      return "ok";
    });
    expect(r).toEqual({ valeur: "ok", essais: 2 });
    let m = 0;
    await expect(
      avecRelance(async () => {
        m++;
        throw new ErreurPlafond();
      }),
    ).rejects.toBeInstanceOf(ErreurPlafond);
    expect(m).toBe(1);
  });
  it("tableau du diagnostic", () => {
    const points = [
      { nom: "ffmpeg", etat: "OK" as const, detail: "6.1", bloquant: true },
      { nom: "Police", etat: "ATTENTION" as const, detail: "absente", bloquant: false },
    ];
    expect(formaterTableau(points)).toContain("ffmpeg  OK         6.1");
    expect(aEchecBloquant(points)).toBe(false);
    expect(aEchecBloquant([...points, { nom: "Supabase", etat: "ÉCHEC", detail: "", bloquant: true }])).toBe(true);
  });
});
