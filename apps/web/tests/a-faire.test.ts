// Tests de la construction de la liste « À faire » avec des données factices.
import { etatEpisode, type Episode, type Espace, type Fichier, type Personnage, type Plan, type Publication, type ReseauConnecte, type Saison, type Serie, type Tache } from "@studio-video-ia/core";
import { describe, expect, it } from "vitest";
import { construireAFaire, type EntreeAFaire } from "../lib/a-faire";

const espace: Espace = { id: "esp1", proprietaire: "u1", nom: "Chaîne FR", couleur: "#FF6A3D", plafond_mensuel: 50, fuseau: "Europe/Paris", cree_le: "2026-01-01T00:00:00Z" };
const serie: Serie = {
  id: "ser1",
  espace_id: "esp1",
  nom: "Le renard",
  style_visuel: "Anime",
  langue: "fr",
  univers: "",
  fil_rouge: "",
  rythme: { tous_les_jours: 2, heure: "18:00", reseaux: [], auto: false },
  hashtags: {},
  genre: "serie",
  cree_le: "2026-01-01T00:00:00Z",
};
const saison: Saison = { id: "sai1", serie_id: "ser1", numero: 1, opening_id: null, ending_id: null };

/** Épisode factice. */
function episode(id: string, numero: number): Episode {
  return {
    id,
    serie_id: "ser1",
    saison_id: "sai1",
    genre: "episode",
    numero,
    titre: `Titre ${numero}`,
    idee: "",
    format: "court",
    duree_cible: 75,
    langue: "fr",
    langues: ["fr"],
    sous_titres: {},
    prises: 1,
    enchainer: true,
    musique: true,
    bruitages: true,
    chapitres: [],
    titres_traduits: {},
    choix_titres: {},
    miniature: null,
    memoire_faite: false,
    hashtags: {},
    style_visuel: "",
    paroles: "",
    paroles_alignees: null,
    paroles_traduites: {},
    bpm: null,
    extrait_debut: 0,
    extrait_fin: null,
    musique_style: "",
    instrumental: false,
    fournisseur_texte: "openai",
    cree_le: "2026-01-01T00:00:00Z",
  };
}

/** Plan factice. */
function plan(id: string, episodeId: string, valide: boolean): Plan {
  return { id, episode_id: episodeId, position: 0, section: "principal", type: "action", texte: "x", personnage_id: null, replique: "", repliques_traduites: {}, duree_fixee: null, valide, modifie: false, prise_choisie: "A", debut: null, fin: null };
}

/** Fichier factice prêt ou en échec. */
function fichier(id: string, episodeId: string, planId: string | null, genre: Fichier["genre"], statut: Fichier["statut"] = "pret", langue: Fichier["langue"] = null): Fichier {
  return { id, espace_id: "esp1", episode_id: episodeId, plan_id: planId, personnage_id: null, genre, langue, prise: genre === "clip" ? "A" : null, chemin: `esp1/${id}`, duree_s: null, secondes_generation: null, cout: 0, statut, erreur: null, essais: 0, cree_le: "2026-01-02T00:00:00Z" };
}

const tiktok: ReseauConnecte = { id: "res1", espace_id: "esp1", reseau: "tiktok", nom_compte: "@renard", langue: "fr", id_externe: "x", jeton_expire_le: null, statut: "connecte", audit_tiktok_valide: false, infos: {}, cree_le: "2026-01-01T00:00:00Z" };
const youtube: ReseauConnecte = { ...tiktok, id: "res2", reseau: "youtube", nom_compte: "Renard TV", statut: "expire" };

/** Construit l'entrée complète à partir d'épisodes et de leurs plans et fichiers. */
function entree(params: { episodes: Episode[]; plans: Plan[]; fichiers: Fichier[]; publications?: Publication[]; taches?: Tache[]; personnages?: Personnage[]; depense?: number; reseaux?: ReseauConnecte[]; tachesRecentes?: Tache[] }): EntreeAFaire {
  const etats = new Map(
    params.episodes.map((ep) => [
      ep.id,
      etatEpisode({
        episode: ep,
        plans: params.plans.filter((p) => p.episode_id === ep.id),
        personnages: params.personnages ?? [],
        fichiers: params.fichiers.filter((f) => f.episode_id === ep.id),
        taches: (params.taches ?? []).filter((t) => t.episode_id === ep.id),
        publications: (params.publications ?? []).filter((p) => p.episode_id === ep.id),
      }),
    ]),
  );
  return {
    espaces: [espace],
    series: [serie],
    saisons: [saison],
    episodes: params.episodes,
    etats,
    personnages: params.personnages ?? [],
    publications: params.publications ?? [],
    reseaux: params.reseaux ?? [],
    depenses: new Map([["esp1", params.depense ?? 0]]),
    taches: params.taches,
    tachesRecentes: params.tachesRecentes,
  };
}

describe("construireAFaire", () => {
  it("signale un storyboard à valider et un épisode prêt à publier", () => {
    const e1 = episode("ep1", 1);
    const e2 = episode("ep2", 2);
    const plans = [plan("p1", "ep1", true), plan("p2", "ep1", false), plan("p3", "ep2", true)];
    const fichiers = [
      fichier("f1", "ep1", "p1", "image"),
      fichier("f2", "ep1", "p2", "image"),
      fichier("f3", "ep2", "p3", "image"),
      fichier("f4", "ep2", "p3", "clip"),
      fichier("f5", "ep2", null, "rendu", "pret", "fr"),
    ];
    const liste = construireAFaire(entree({ episodes: [e1, e2], plans, fichiers }));
    expect(liste.map((x) => x.titre)).toEqual(["Storyboard à valider (1/2)", "Prêt à publier"]);
    expect(liste[0]?.lien).toBe("/episodes/ep1?etape=storyboard");
    expect(liste[1]?.detail).toBe("Le renard · S1E2 · Titre 2");
  });

  it("met les échecs en premier", () => {
    const e1 = episode("ep1", 1);
    const plans = [plan("p1", "ep1", true)];
    const fichiers = [fichier("f1", "ep1", "p1", "image"), fichier("f2", "ep1", "p1", "clip", "echec")];
    const liste = construireAFaire(entree({ episodes: [e1], plans, fichiers, reseaux: [tiktok] }));
    expect(liste[0]?.titre).toBe("Échec de génération");
    expect(liste[0]?.ton).toBe("erreur");
    expect(liste[0]?.lien).toBe("/episodes/ep1?etape=clips");
    expect(liste.at(-1)?.titre).toContain("audit TikTok");
  });

  it("signale les comptes expirés, le budget à 80 % et les fiches manquantes", () => {
    const perso: Personnage = { id: "c1", serie_id: "ser1", nom: "Héros", description: "", source_voix: "elevenlabs", voix_id: "", accord_clone: false, fiche_chemin: null, fiche_statut: "a_faire", position: 0 };
    const liste = construireAFaire(entree({ episodes: [], plans: [], fichiers: [], reseaux: [youtube], depense: 42, personnages: [perso] }));
    const titres = liste.map((x) => x.titre);
    expect(titres).toContain("YouTube Renard TV : connexion expirée");
    expect(titres).toContain("Budget de Chaîne FR à 84 %");
    expect(titres.at(-1)).toBe("Fiches de référence à générer : Héros");
  });

  it("signale une publication en échec avec son message", () => {
    const e1 = episode("ep1", 1);
    const pub: Publication = {
      id: "pub1",
      episode_id: "ep1",
      reseau_connecte_id: "res1",
      langue: "fr",
      livrable: "court",
      programmee_le: "2026-01-03T17:00:00Z",
      statut: "echec",
      id_externe: null,
      url: null,
      erreur: "Jeton expiré.",
      progression: 0,
      stats: {},
      stats_le: null,
      publiee_le: null,
      cree_le: "2026-01-02T00:00:00Z",
    };
    const liste = construireAFaire(entree({ episodes: [e1], plans: [], fichiers: [], publications: [pub], reseaux: [{ ...tiktok, audit_tiktok_valide: true }] }));
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ titre: "Publication échouée sur TikTok @renard", detail: "Jeton expiré.", lien: "/episodes/ep1?etape=publication" });
  });

  it("ignore une tâche en échec relancée depuis", () => {
    const e1 = episode("ep1", 1);
    const base: Tache = {
      id: "t1",
      espace_id: "esp1",
      episode_id: "ep1",
      publication_id: null,
      type: "scenario",
      statut: "echec",
      priorite: 0,
      donnees: {},
      progression: {},
      erreur: "OpenAI 429",
      essais: 3,
      executer_apres: "2026-01-01T00:00:00Z",
      verrouille_par: null,
      verrouille_le: null,
      cree_le: "2026-01-02T00:00:00Z",
      modifie_le: "2026-01-02T00:00:00Z",
    };
    const seule = construireAFaire(entree({ episodes: [e1], plans: [], fichiers: [], tachesRecentes: [base] }));
    expect(seule[0]).toMatchObject({ titre: "Échec : écriture du scénario", lien: "/episodes/ep1?etape=scenario" });
    const relancee = construireAFaire(entree({ episodes: [e1], plans: [], fichiers: [], tachesRecentes: [base, { ...base, id: "t2", statut: "terminee", cree_le: "2026-01-03T00:00:00Z" }] }));
    expect(relancee).toHaveLength(0);
  });
});
