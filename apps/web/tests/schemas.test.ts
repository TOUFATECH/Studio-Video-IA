// Tests des schémas Zod des Server Actions et du passage FormData → objet.
import { describe, expect, it } from "vitest";
import {
  schemaArc,
  schemaCodeTotp,
  schemaPlanDetaille,
  cheminSur,
  formulaire,
  schemaCle,
  schemaPersonnage,
  schemaPlanFormulaire,
  schemaPreferencesFormulaire,
  schemaPublier,
  schemaRythmeFormulaire,
  schemaSousTitresFormulaire,
  schemaModifEspace,
  schemaOngletSerie,
} from "../lib/schemas";

const ID = "6f1c2a7e-3b9d-4c55-8e0a-2d4b6f8a1c3e";
const ID2 = "0b8c3d1e-2f4a-4b6c-9d8e-7f6a5b4c3d2e";

/** Construit un FormData à partir de paires clé/valeur. */
function fd(paires: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of paires) f.append(k, v);
  return f;
}

describe("formulaire", () => {
  it("regroupe les champs multiples et ignore les champs internes de Next", () => {
    const o = formulaire(fd([["comptes", ID], ["comptes", ID2], ["$ACTION_ID_x", "1"], ["langue", "fr"]]), ["comptes", "plan_ids"]);
    expect(o).toEqual({ comptes: [ID, ID2], plan_ids: [], langue: "fr" });
  });
});

describe("schemaPublier", () => {
  it("accepte une publication immédiate", () => {
    const r = schemaPublier.safeParse({ episode_id: ID, langue: "fr", comptes: [ID2], quand: "maintenant" });
    expect(r.success).toBe(true);
  });
  it("exige une date pour une publication à date précise", () => {
    expect(schemaPublier.safeParse({ episode_id: ID, langue: "fr", comptes: [ID2], quand: "date" }).success).toBe(false);
    expect(schemaPublier.safeParse({ episode_id: ID, langue: "fr", comptes: [ID2], quand: "date", date: "2026-11-12T18:30" }).success).toBe(true);
  });
  it("refuse une liste de comptes vide et une langue inconnue", () => {
    expect(schemaPublier.safeParse({ episode_id: ID, langue: "fr", comptes: [], quand: "maintenant" }).success).toBe(false);
    expect(schemaPublier.safeParse({ episode_id: ID, langue: "de", comptes: [ID2], quand: "maintenant" }).success).toBe(false);
  });
});

describe("schemaCle", () => {
  it("distingue clé simple et application OAuth", () => {
    expect(schemaCle.safeParse({ fournisseur: "openai", valeur: "sk-test-1234567890" }).success).toBe(true);
    expect(schemaCle.safeParse({ fournisseur: "google", client_id: "abcd.apps", client_secret: "secret-123" }).success).toBe(true);
    expect(schemaCle.safeParse({ fournisseur: "google", valeur: "sk-test-1234567890" }).success).toBe(false);
    expect(schemaCle.safeParse({ fournisseur: "snapchat", valeur: "sk-test-1234567890" }).success).toBe(false);
  });
});

describe("schemaPlanFormulaire", () => {
  it("convertit la durée « auto » en null et une durée en nombre", () => {
    const base = { id: ID, type: "dialogue", texte: "Kaï parle à la lune.", personnage_id: "", replique: "Je reviendrai." };
    const auto = schemaPlanFormulaire.parse({ ...base, duree: "auto" });
    expect(auto.duree).toBeNull();
    expect(auto.personnage_id).toBeNull();
    expect(schemaPlanFormulaire.parse({ ...base, duree: "8", personnage_id: ID2 }).duree).toBe(8);
  });
  it("refuse une durée que Grok n'accepte pas", () => {
    expect(schemaPlanFormulaire.safeParse({ id: ID, type: "action", texte: "x", replique: "", duree: "7" }).success).toBe(false);
  });
});

describe("schemaPersonnage", () => {
  it("exige l'accord pour une voix clonée", () => {
    const p = { id: ID, nom: "Kaï", description: "", source_voix: "elevenlabs_clone", voix_id: "abc" };
    expect(schemaPersonnage.safeParse(p).success).toBe(false);
    expect(schemaPersonnage.safeParse({ ...p, accord_clone: "on" }).success).toBe(true);
    expect(schemaPersonnage.safeParse({ ...p, source_voix: "elevenlabs" }).success).toBe(true);
  });
});

describe("schemaSousTitresFormulaire", () => {
  it("lit un choix par version", () => {
    const r = schemaSousTitresFormulaire.parse({ episode_id: ID, sous_titres_fr: "en", sous_titres_ja: "aucun" });
    expect(r.choix).toEqual({ fr: "en", ja: "aucun" });
  });
  it("refuse un choix inconnu", () => {
    expect(schemaSousTitresFormulaire.safeParse({ episode_id: ID, sous_titres_fr: "klingon" }).success).toBe(false);
  });
});

describe("autres schémas", () => {
  it("valide le rythme de publication", () => {
    expect(schemaRythmeFormulaire.safeParse({ id: ID, tous_les_jours: "2", heure: "18:00", reseaux: [ID2], auto: "on" }).success).toBe(true);
    expect(schemaRythmeFormulaire.safeParse({ id: ID, tous_les_jours: "2", heure: "24:00", reseaux: [] }).success).toBe(false);
  });
  it("valide les préférences", () => {
    const r = schemaPreferencesFormulaire.parse({ parallele: "3", sous_titres: "en", prises: "2" });
    expect(r).toEqual({ parallele: 3, sous_titres: "en", prises: 2, memoire_auto: false, theme: "sombre", propositions: 1, controle_qualite: false, plafond_episode: 20 });
  });
  it("valide un plan détaillé (durée 1 à 8 s, effet, transition) et l'arc de saison", () => {
    const ok = schemaPlanDetaille.safeParse({ id: ID, scene_id: "", duree: "2.5", decor_id: "", activite_id: "", personnages: [ID], variantes: [], cadrage: "gros plan", mouvement: "zoom lent", transition: "flash", effet: "zoom", texte_ecran: "", son: "" });
    expect(ok.success && ok.data.duree).toBe(2.5);
    expect(schemaPlanDetaille.safeParse({ id: ID, duree: "9", personnages: [], variantes: [], cadrage: "", mouvement: "", transition: "coupe", effet: "aucun", texte_ecran: "", son: "" }).success).toBe(false);
    expect(schemaPlanDetaille.safeParse({ id: ID, duree: "", personnages: [], variantes: [], cadrage: "", mouvement: "", transition: "coupe", effet: "explosion", texte_ecran: "", son: "" }).success).toBe(false);
    expect(schemaArc.safeParse({ saison_id: ID, idee: "Le glow-up", nombre: "12" }).success).toBe(true);
    expect(schemaArc.safeParse({ saison_id: ID, idee: "x", nombre: "31" }).success).toBe(false);
    expect(schemaCodeTotp.safeParse({ code: " 123456 " }).success).toBe(true);
    expect(schemaCodeTotp.safeParse({ code: "12345" }).success).toBe(false);
  });
  it("refuse un fuseau inconnu et une couleur invalide", () => {
    const base = { id: ID, nom: "Japon", couleur: "#47C68B", fuseau: "Asia/Tokyo", plafond_mensuel: "40" };
    expect(schemaModifEspace.safeParse(base).success).toBe(true);
    expect(schemaModifEspace.safeParse({ ...base, fuseau: "Lune/Base" }).success).toBe(false);
    expect(schemaModifEspace.safeParse({ ...base, couleur: "red" }).success).toBe(false);
  });
  it("retombe sur l'onglet par défaut pour un paramètre inconnu", () => {
    expect(schemaOngletSerie.parse("piratage")).toBe("episodes");
  });
  it("n'autorise que des chemins internes après connexion", () => {
    expect(cheminSur("/series")).toBe("/series");
    expect(cheminSur("//evil.example")).toBe("/");
    expect(cheminSur("https://evil.example")).toBe("/");
    expect(cheminSur(undefined)).toBe("/");
  });
});
