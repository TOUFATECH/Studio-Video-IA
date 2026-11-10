// Tests de la base : schéma, comptes, règles d'accès (un utilisateur ne voit et ne touche que ses données),
// déclencheurs, file de tâches, conversions de valeurs. Exécutés sur SQLite, et sur PostgreSQL si
// TEST_DATABASE_URL est fourni (la CI démarre un PostgreSQL pour ça).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creerUtilisateur, fermerSession, ouvrirBase, ouvrirSession, TABLES, utilisateurDeSession, verifierIdentifiants, type Base } from "../src/index";
import { migrer } from "../src/migrations";

const MOTEURS: { nom: string; url: (dossier: string) => string }[] = [{ nom: "SQLite", url: (d) => `sqlite:${join(d, "test.db")}` }];
if (process.env.TEST_DATABASE_URL) MOTEURS.push({ nom: "PostgreSQL", url: () => process.env.TEST_DATABASE_URL ?? "" });

describe.each(MOTEURS)("base $nom", ({ url }) => {
  let base: Base;
  let dossier: string;
  let A: string;
  let B: string;
  // Données d'A.
  let espaceA: string;
  let serieA: string;
  let saisonA: string;
  let episodeA: string;

  beforeAll(async () => {
    dossier = mkdtempSync(join(tmpdir(), "svi-base-"));
    process.env.ENCRYPTION_KEY = "";
    base = await ouvrirBase({ url: url(dossier), dossierDonnees: dossier, dossierMedias: join(dossier, "medias") });
    if (base.moteur.dialecte === "postgres") {
      // Base de test PostgreSQL : on repart d'une base vide.
      await base.moteur.script(`truncate utilisateurs, espaces, workers_etat cascade`);
    }
    const sel = Math.random().toString(36).slice(2, 8);
    A = (await creerUtilisateur(base.moteur, `a-${sel}@exemple.fr`, "motdepasse-a-123")).id;
    B = (await creerUtilisateur(base.moteur, `b-${sel}@exemple.fr`, "motdepasse-b-123")).id;
    const a = base.pour(A);
    espaceA = (await a.from("espaces").insert({ nom: "Compte A" }).select("id").single()).data.id;
    serieA = (await a.from("series").insert({ espace_id: espaceA, nom: "Série A", rythme: { tous_les_jours: 1, heure: "18:00", reseaux: [], auto: false } }).select("id").single()).data.id;
    saisonA = (await a.from("saisons").insert({ serie_id: serieA, numero: 1 }).select("id").single()).data.id;
    const ep = await a.from("episodes").insert({ serie_id: serieA, saison_id: saisonA, titre: "Pilote", langues: ["fr", "en"], sous_titres: { fr: "aucun" }, enchainer: false }).select("*").single();
    expect(ep.error).toBeNull();
    episodeA = ep.data.id;
  });

  afterAll(async () => {
    await base?.fermer();
    rmSync(dossier, { recursive: true, force: true });
  });

  it("crée le schéma une seule fois, avec les colonnes décrites", async () => {
    expect(base.migration.version).toBe(1);
    expect((await migrer(base.moteur)).appliquees).toEqual([]);
    for (const [table, info] of Object.entries(TABLES)) {
      const colonnes =
        base.moteur.dialecte === "sqlite"
          ? (await base.moteur.lire(`select name from pragma_table_info('${table}')`)).map((l) => String(l.name))
          : (await base.moteur.lire(`select column_name as name from information_schema.columns where table_name = ?`, [table])).map((l) => String(l.name));
      expect(colonnes.sort(), table).toEqual(Object.keys(info.colonnes).sort());
    }
  });

  it("gère les comptes et les sessions", async () => {
    expect(await verifierIdentifiants(base.moteur, "inconnu@exemple.fr", "x")).toBeNull();
    const u = await creerUtilisateur(base.moteur, "Session@Exemple.fr", "un-mot-de-passe");
    await expect(creerUtilisateur(base.moteur, "session@exemple.fr", "un-mot-de-passe")).rejects.toThrow("existe déjà");
    await expect(creerUtilisateur(base.moteur, "court@exemple.fr", "court")).rejects.toThrow("trop court");
    expect(await verifierIdentifiants(base.moteur, "session@exemple.fr", "mauvais")).toBeNull();
    expect((await verifierIdentifiants(base.moteur, "SESSION@exemple.fr", "un-mot-de-passe"))?.id).toBe(u.id);
    const { jeton } = await ouvrirSession(base.moteur, u.id);
    expect((await utilisateurDeSession(base.moteur, jeton))?.email).toBe("session@exemple.fr");
    const [stocke] = await base.moteur.lire(`select id from sessions where utilisateur_id = ?`, [u.id]);
    expect(stocke?.id).not.toBe(jeton);
    await fermerSession(base.moteur, jeton);
    expect(await utilisateurDeSession(base.moteur, jeton)).toBeNull();
  });

  it("convertit JSON, tableaux, booléens, nombres et dates", async () => {
    const { data } = await base.pour(A).from("episodes").select("*").eq("id", episodeA).single();
    expect(data.langues).toEqual(["fr", "en"]);
    expect(data.sous_titres).toEqual({ fr: "aucun" });
    expect(data.enchainer).toBe(false);
    expect(data.musique).toBe(true);
    expect(data.chapitres).toEqual([]);
    expect(data.miniature).toBeNull();
    expect(typeof data.duree_cible).toBe("number");
    expect(data.cree_le).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const { data: s } = await base.pour(A).from("series").select("rythme, hashtags, genre").eq("id", serieA).single();
    expect(s).toEqual({ rythme: { tous_les_jours: 1, heure: "18:00", reseaux: [], auto: false }, hashtags: {}, genre: "serie" });
  });

  it("un utilisateur ne voit ni ne modifie les données d'un autre", async () => {
    const b = base.pour(B);
    expect((await b.from("episodes").select("*")).data).toEqual([]);
    expect((await b.from("espaces").select("*")).data).toEqual([]);
    expect((await b.from("episodes").select("id", { count: "exact", head: true })).count).toBe(0);
    // Écrire dans l'espace d'A : refusé.
    const r = await b.from("series").insert({ espace_id: espaceA, nom: "Intrus" });
    expect(r.error?.code).toBe("42501");
    // Modifier ou supprimer l'épisode d'A : aucune ligne touchée.
    const maj = await b.from("episodes").update({ titre: "Piraté" }).eq("id", episodeA).select("id");
    expect(maj.data).toEqual([]);
    await b.from("episodes").delete().eq("id", episodeA);
    expect((await base.pour(A).from("episodes").select("titre").eq("id", episodeA).single()).data.titre).toBe("Pilote");
    // Déplacer son propre épisode dans la série d'un autre : refusé et annulé.
    const espaceB = (await b.from("espaces").insert({ nom: "Compte B" }).select("id").single()).data.id;
    const serieB = (await b.from("series").insert({ espace_id: espaceB, nom: "Série B" }).select("id").single()).data.id;
    const vol = await b.from("series").update({ espace_id: espaceA }).eq("id", serieB);
    expect(vol.error?.code).toBe("42501");
    expect((await b.from("series").select("espace_id").eq("id", serieB).single()).data.espace_id).toBe(espaceB);
    // Le propriétaire d'un espace est toujours l'utilisateur qui le crée.
    const e2 = await b.from("espaces").insert({ nom: "Autre", proprietaire: A }).select("proprietaire").single();
    expect(e2.data.proprietaire).toBe(B);
  });

  it("protège les clés, les jetons, les fichiers et les tâches", async () => {
    const a = base.pour(A);
    await base.admin.from("cles_api").insert({ proprietaire: A, fournisseur: "openai", valeur_chiffree: "v1.secret", apercu: "1234" });
    expect((await a.from("cles_api").select("fournisseur, apercu")).data).toEqual([{ fournisseur: "openai", apercu: "1234" }]);
    expect((await a.from("cles_api").select("*")).data![0].valeur_chiffree).toBeUndefined();
    expect((await a.from("cles_api").select("valeur_chiffree")).error?.code).toBe("42501");
    expect((await a.from("cles_api").insert({ fournisseur: "xai", valeur_chiffree: "x", apercu: "x" })).error?.code).toBe("42501");
    const reseau = (await base.admin.from("reseaux_connectes").insert({ espace_id: espaceA, reseau: "youtube", nom_compte: "Chaîne", jeton_acces_chiffre: "v1.jeton" }).select("id").single()).data.id;
    expect((await a.from("reseaux_connectes").select("*").eq("id", reseau).single()).data.jeton_acces_chiffre).toBeUndefined();
    expect((await a.from("reseaux_connectes").update({ jeton_acces_chiffre: "x" }).eq("id", reseau)).error?.code).toBe("42501");
    expect((await a.from("reseaux_connectes").update({ nom_compte: "Ma chaîne" }).eq("id", reseau)).error).toBeNull();
    expect((await a.from("fichiers").insert({ espace_id: espaceA, genre: "image", chemin: `${espaceA}/x.png` })).error?.code).toBe("42501");
    expect((await a.from("taches").insert({ espace_id: espaceA, type: "scenario" })).error?.code).toBe("42501");
    expect((await a.rpc("prendre_tache", { p_worker: "pirate" })).error?.code).toBe("42501");
    // Revenus : saisie manuelle permise, revenus « api » réservés au worker.
    expect((await a.from("revenus").insert({ reseau_connecte_id: reseau, mois: "2026-10-01", montant: 12.5, source: "manuel" })).error).toBeNull();
    expect((await a.from("revenus").insert({ reseau_connecte_id: reseau, mois: "2026-10-01", montant: 99, source: "api" })).error?.code).toBe("42501");
    const up = await a.from("revenus").upsert({ reseau_connecte_id: reseau, mois: "2026-10-01", montant: 20, source: "manuel" }, { onConflict: "reseau_connecte_id,mois,source" });
    expect(up.error).toBeNull();
    expect((await a.from("revenus").select("montant").eq("source", "manuel").single()).data.montant).toBe(20);
    // Utilisateurs et sessions : jamais lisibles par un utilisateur.
    expect((await a.from("utilisateurs").select("*")).error?.code).toBe("42501");
  });

  it("vérifie la cohérence des liens et des chemins (déclencheurs)", async () => {
    const a = base.pour(A);
    const autreSerie = (await a.from("series").insert({ espace_id: espaceA, nom: "Autre série" }).select("id").single()).data.id;
    const r1 = await a.from("episodes").insert({ serie_id: autreSerie, saison_id: saisonA, titre: "x" });
    expect(r1.error?.message).toContain("même série");
    const r2 = await a.from("episodes").update({ miniature: { chemins: ["autre-espace/x.png"], numero: 0 } }).eq("id", episodeA);
    expect(r2.error?.message).toContain("miniature");
    const r3 = await a.from("episodes").update({ langue: "ja" }).eq("id", episodeA);
    expect(r3.error).not.toBeNull();
    const r4 = await a.from("personnages").insert({ serie_id: serieA, nom: "X", fiche_chemin: "ailleurs/fiche.png" });
    expect(r4.error?.message).toContain("fiche");
    const r5 = await a.from("plans").insert({ episode_id: episodeA, position: 0, type: "action", debut: 1, fin: 30 });
    expect(r5.error).not.toBeNull();
  });

  it("journalise les dépenses et calcule celle du mois", async () => {
    await base.admin.from("fichiers").insert({ espace_id: espaceA, episode_id: episodeA, genre: "image", chemin: `${espaceA}/a.png`, cout: 0.07 });
    const f = (await base.admin.from("fichiers").insert({ espace_id: espaceA, episode_id: episodeA, genre: "clip", chemin: `${espaceA}/a.mp4`, cout: 0.4 }).select("id").single()).data.id;
    await base.admin.from("fichiers").delete().eq("id", f);
    expect((await base.pour(A).rpc("depense_du_mois", { e: espaceA })).data).toBeCloseTo(0.47);
    expect((await base.pour(B).rpc("depense_du_mois", { e: espaceA })).data).toBe(0);
  });

  it("file de tâches : une tâche active par type, prise par priorité, libération des tâches abandonnées", async () => {
    const t1 = await base.admin.from("taches").insert({ espace_id: espaceA, episode_id: episodeA, type: "storyboard" }).select("id").single();
    const doublon = await base.admin.from("taches").insert({ espace_id: espaceA, episode_id: episodeA, type: "storyboard" });
    expect(doublon.error?.code).toBe("23505");
    await base.admin.from("taches").insert({ espace_id: espaceA, type: "stats", priorite: 5, donnees: { complet: true } });
    const p1 = await base.admin.rpc("prendre_tache", { p_worker: "w1" });
    expect(p1.data).toHaveLength(1);
    expect(p1.data![0].type).toBe("stats");
    expect(p1.data![0].donnees).toEqual({ complet: true });
    expect(p1.data![0].essais).toBe(1);
    const p2 = await base.admin.rpc("prendre_tache", { p_worker: "w2", p_types: ["storyboard"] });
    expect(p2.data![0].id).toBe(t1.data.id);
    expect((await base.admin.rpc("prendre_tache", { p_worker: "w3" })).data).toEqual([]);
    const vieux = new Date(Date.now() - 3600_000).toISOString();
    await base.admin.from("taches").update({ verrouille_le: vieux }).eq("id", t1.data.id);
    await base.admin.from("taches").update({ verrouille_le: vieux, essais: 3 }).eq("id", p1.data![0].id);
    expect((await base.admin.rpc("liberer_taches_bloquees")).data).toBe(1);
    expect((await base.admin.from("taches").select("statut").eq("id", t1.data.id).single()).data.statut).toBe("en_file");
    expect((await base.admin.from("taches").select("statut, erreur").eq("id", p1.data![0].id).single()).data.statut).toBe("echec");
  });

  it("filtres, tri, comptage, single et upsert", async () => {
    const a = base.pour(A);
    for (const n of [2, 3]) await a.from("saisons").insert({ serie_id: serieA, numero: n });
    const tri = await a.from("saisons").select("numero").eq("serie_id", serieA).order("numero", { ascending: false }).limit(2);
    expect(tri.data!.map((x: { numero: number }) => x.numero)).toEqual([3, 2]);
    expect((await a.from("saisons").select("id").in("numero", [])).data).toEqual([]);
    expect((await a.from("saisons").select("id").eq("serie_id", serieA).single()).error?.code).toBe("PGRST116");
    expect((await a.from("saisons").select("id").eq("numero", 99).maybeSingle()).data).toBeNull();
    const ou = await base.admin.from("taches").select("type").eq("espace_id", espaceA).or(`statut.in.(en_file,en_cours),cree_le.gte."2999-01-01"`);
    expect(ou.data!.map((x: { type: string }) => x.type)).toEqual(["storyboard"]);
    expect((await a.from("saisons").select("colonne_inconnue")).error?.code).toBe("42703");
    await base.admin.from("workers_etat").upsert({ nom: "w1", vu_le: new Date().toISOString(), infos: { etat: "actif" } }, { onConflict: "nom" });
    await base.admin.from("workers_etat").upsert({ nom: "w1", vu_le: new Date().toISOString(), infos: { etat: "pause" } }, { onConflict: "nom" });
    expect((await a.from("workers_etat").select("infos").eq("nom", "w1").single()).data.infos).toEqual({ etat: "pause" });
    await a.from("reglages").upsert({ proprietaire: A }, { onConflict: "proprietaire", ignoreDuplicates: true });
    await a.from("reglages").upsert({ proprietaire: A }, { onConflict: "proprietaire", ignoreDuplicates: true });
    expect((await a.from("reglages").select("tarifs").single()).data.tarifs.musique_minute).toBe(0.5);
  });

  it("un seul espace Clips par compte", async () => {
    const a = base.pour(A);
    expect((await a.from("series").insert({ espace_id: espaceA, nom: "Clips", genre: "clips" })).error).toBeNull();
    expect((await a.from("series").insert({ espace_id: espaceA, nom: "Clips 2", genre: "clips" })).error?.code).toBe("23505");
  });
});
