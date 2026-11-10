// Tests du budget : tâches payantes, plafond atteint, pause d'une tâche et sort d'une tâche après une erreur.
import { describe, expect, it } from "vitest";
import { ErreurApi } from "@studio-video-ia/integrations";
import type { Tache } from "@studio-video-ia/core";
import { estPayante, plafondAtteint, type AccesBudget } from "../src/budget";
import type { Config } from "../src/config";
import { creerContexte, ErreurAnnulee, ErreurArret, ErreurPlafond } from "../src/contexte";
import { issueErreur } from "../src/file";
import type { Stockage } from "../src/stockage";
import type { Base } from "../src/bdd";

/** Faux accès au budget. */
function budget(depense: number, plafond: number): AccesBudget {
  return { depenseDuMois: async () => depense, plafond: async () => plafond };
}

/** Tâche minimale. */
function tache(extra: Partial<Tache> = {}): Tache {
  return {
    id: "t1", espace_id: "e1", episode_id: null, publication_id: null, type: "clips", statut: "en_cours", priorite: 0, donnees: {}, progression: {}, erreur: null, essais: 1,
    executer_apres: "", verrouille_par: "w", verrouille_le: "", cree_le: "", modifie_le: "", ...extra,
  };
}

describe("budget", () => {
  it("liste des tâches payantes", () => {
    for (const t of ["scenario", "storyboard", "clips", "fiche_personnage", "memoire", "clone_voix", "test_complet"] as const) expect(estPayante(t)).toBe(true);
    for (const t of ["rendu", "publication", "stats"] as const) expect(estPayante(t)).toBe(false);
  });
  it("plafond atteint dès que la dépense l'égale", async () => {
    expect(await plafondAtteint(budget(49.99, 50), "e")).toBe(false);
    expect(await plafondAtteint(budget(50, 50), "e")).toBe(true);
    expect(await plafondAtteint(budget(0, 0), "e")).toBe(true);
  });
  it("le contexte lève ErreurPlafond entre deux générations quand le plafond est atteint", async () => {
    const deps = { db: {} as Base, config: {} as Config, stockage: {} as Stockage, cleMaitre: Buffer.alloc(32), signal: new AbortController().signal };
    const plein = creerContexte({ ...deps, plafondAtteint: (e) => plafondAtteint(budget(60, 50), e) }, tache()).ctx;
    await expect(plein.verifierBudget()).rejects.toBeInstanceOf(ErreurPlafond);
    const libre = creerContexte({ ...deps, plafondAtteint: (e) => plafondAtteint(budget(10, 50), e) }, tache()).ctx;
    await expect(libre.verifierBudget()).resolves.toBeUndefined();
  });
});

describe("issue d'une tâche après une erreur", () => {
  it("plafond → en pause avec le message attendu", () => {
    expect(issueErreur(new ErreurPlafond(), tache(), false)).toEqual({ statut: "en_pause", erreur: "Plafond du mois atteint" });
  });
  it("arrêt du worker → remise en file", () => {
    expect(issueErreur(new ErreurArret(), tache(), false)).toEqual({ statut: "en_file", erreur: null });
    expect(issueErreur(new Error("ffmpeg interrompu"), tache(), true)).toEqual({ statut: "en_file", erreur: null });
  });
  it("annulation → rien à écrire", () => {
    expect(issueErreur(new ErreurAnnulee(), tache(), false)).toEqual({ statut: "annulee" });
  });
  it("429 → nouvel essai différé, puis échec après plusieurs essais", () => {
    const maintenant = new Date("2026-11-09T12:00:00Z");
    const i = issueErreur(new ErreurApi("TikTok", 429, "trop de requêtes"), tache({ essais: 1 }), false, maintenant);
    expect(i.statut).toBe("en_file");
    expect(i.statut === "en_file" && i.executerApres?.toISOString()).toBe("2026-11-09T12:02:00.000Z");
    expect(issueErreur(new ErreurApi("TikTok", 429, "trop"), tache({ essais: 4 }), false).statut).toBe("echec");
  });
  it("autre erreur → échec avec un message d'une ligne", () => {
    expect(issueErreur(new Error("Clé OpenAI manquante :\n ajoute-la"), tache(), false)).toEqual({ statut: "echec", erreur: "Clé OpenAI manquante : ajoute-la" });
  });
});
