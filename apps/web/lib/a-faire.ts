// Construction de la liste « À faire » de l'accueil (et du badge du menu), à partir des données déjà chargées.
// Fonction pure : testée avec des données factices dans tests/a-faire.test.ts.
import { NOMS_RESEAUX, etapeDeTache, type Episode, type EtatEpisode, type Espace, type Personnage, type Publication, type ReseauConnecte, type Saison, type Serie, type Tache, type Ton, type TypeTache } from "@studio-video-ia/core";
import { codeEpisode, lienEpisode, nomEpisode } from "./episodes";
import { euros } from "./format";

/** Une ligne de la liste « À faire ». */
export type AFaire = {
  cle: string;
  /** Plus petit = plus urgent. */
  poids: number;
  ton: Ton;
  titre: string;
  detail: string;
  action: string;
  lien: string;
};

/** Données nécessaires (déjà filtrées sur l'espace choisi). */
export type EntreeAFaire = {
  espaces: readonly Espace[];
  series: readonly Serie[];
  saisons: readonly Saison[];
  episodes: readonly Episode[];
  etats: ReadonlyMap<string, EtatEpisode>;
  personnages: readonly Personnage[];
  publications: readonly Publication[];
  reseaux: readonly ReseauConnecte[];
  /** Dépense du mois par espace (fonction SQL depense_du_mois). */
  depenses: ReadonlyMap<string, number>;
  /** Tâches actives et tâches finies récemment : une tâche en échec sans tâche plus récente du même genre est signalée. */
  taches?: readonly Tache[];
  tachesRecentes?: readonly Tache[];
};

/** Nom des tâches dans les messages d'échec. */
const NOMS_TACHES: Record<TypeTache, string> = {
  scenario: "écriture du scénario",
  storyboard: "génération des images",
  clips: "génération des clips et des voix",
  rendu: "rendu",
  publication: "publication",
  stats: "synchronisation des statistiques",
  fiche_personnage: "fiche de référence",
  memoire: "mise à jour de la mémoire",
  clone_voix: "clonage de voix",
  test_complet: "test complet",
  paroles: "écriture des paroles",
  musique: "composition de la musique",
  synchro: "synchronisation des paroles",
};

/** Construit et trie la liste des actions à mener. */
export function construireAFaire(e: EntreeAFaire): AFaire[] {
  const out: AFaire[] = [];
  const series = new Map(e.series.map((s) => [s.id, s]));
  const saisons = new Map(e.saisons.map((s) => [s.id, s]));
  const espaces = new Map(e.espaces.map((s) => [s.id, s]));
  const episodes = new Map(e.episodes.map((x) => [x.id, x]));
  const reseaux = new Map(e.reseaux.map((r) => [r.id, r]));

  for (const ep of e.episodes) {
    const etat = e.etats.get(ep.id);
    const serie = series.get(ep.serie_id);
    if (!etat || !serie) continue;
    const saison = saisons.get(ep.saison_id);
    const libelle = `${serie.nom} · ${codeEpisode(ep, saison)} · ${nomEpisode(ep, saison)}`;
    const lien = (etape: string) => lienEpisode(ep, etape);
    const tache = etat.tacheEnCours;
    const echecGeneration = etat.storyboard.echec + etat.clips.echec + etat.rendus.echec;
    const n = etat.storyboard.total;
    if (tache?.statut === "en_pause") {
      out.push({ cle: `pause:${ep.id}`, poids: 1, ton: "erreur", titre: "Budget du mois atteint : file en pause", detail: libelle, action: "Budget", lien: "/reglages?onglet=budget" });
    } else if (!tache && echecGeneration > 0) {
      out.push({ cle: `echec:${ep.id}`, poids: 0, ton: "erreur", titre: echecGeneration > 1 ? `${echecGeneration} échecs de génération` : "Échec de génération", detail: libelle, action: "Corriger", lien: lien(etat.etape) });
    } else if (!tache && n > 0 && etat.storyboard.fait === n && etat.valides < n) {
      out.push({ cle: `valider:${ep.id}`, poids: 2, ton: "attention", titre: `Storyboard à valider (${etat.valides}/${n})`, detail: libelle, action: "Valider", lien: lien("storyboard") });
    } else if (!tache && n > 0 && etat.clips.total > 0 && etat.clips.fait === etat.clips.total && etat.rendus.fait < etat.rendus.total) {
      out.push({ cle: `monter:${ep.id}`, poids: 3, ton: "secondaire", titre: "Prêt pour le montage", detail: libelle, action: "Monter", lien: lien("montage") });
    } else if (!tache && ep.genre === "episode" && n > 0 && etat.rendus.total > 0 && etat.rendus.fait === etat.rendus.total && etat.publiees === 0 && etat.programmees === 0 && etat.echecs === 0) {
      out.push({ cle: `publier:${ep.id}`, poids: 3, ton: "succes", titre: "Prêt à publier", detail: libelle, action: "Publier", lien: lien("publication") });
    }
  }

  for (const p of e.publications) {
    if (p.statut !== "echec") continue;
    const compte = reseaux.get(p.reseau_connecte_id);
    const ep = episodes.get(p.episode_id);
    if (!compte || !ep) continue;
    out.push({
      cle: `pub:${p.id}`,
      poids: 0,
      ton: "erreur",
      titre: `Publication échouée sur ${NOMS_RESEAUX[compte.reseau]} ${compte.nom_compte}`,
      detail: p.erreur ?? "Erreur inconnue.",
      action: "Voir",
      lien: lienEpisode(ep, "publication"),
    });
  }

  for (const r of e.reseaux) {
    const espace = espaces.get(r.espace_id);
    const lien = `/reglages?onglet=comptes&espace=${r.espace_id}`;
    if (r.statut === "expire") {
      out.push({ cle: `expire:${r.id}`, poids: 1, ton: "erreur", titre: `${NOMS_RESEAUX[r.reseau]} ${r.nom_compte} : connexion expirée`, detail: espace?.nom ?? "", action: "Reconnecter", lien });
    } else if (r.reseau === "tiktok" && r.statut === "connecte" && !r.audit_tiktok_valide) {
      out.push({
        cle: `audit:${r.id}`,
        poids: 4,
        ton: "attention",
        titre: `TikTok ${r.nom_compte} : publications en privé tant que l’audit TikTok n’est pas validé`,
        detail: espace?.nom ?? "",
        action: "Détails",
        lien,
      });
    }
  }

  for (const esp of e.espaces) {
    const depense = e.depenses.get(esp.id) ?? 0;
    if (esp.plafond_mensuel > 0 && depense >= esp.plafond_mensuel * 0.8) {
      const atteint = depense >= esp.plafond_mensuel;
      out.push({
        cle: `budget:${esp.id}`,
        poids: 1,
        ton: atteint ? "erreur" : "attention",
        titre: atteint ? `Budget de ${esp.nom} atteint` : `Budget de ${esp.nom} à ${Math.round((100 * depense) / esp.plafond_mensuel)} %`,
        detail: `${euros(depense)} sur ${euros(esp.plafond_mensuel)}`,
        action: "Budget",
        lien: "/reglages?onglet=budget",
      });
    }
  }

  for (const s of e.series) {
    const manquantes = e.personnages.filter((p) => p.serie_id === s.id && (p.fiche_statut === "a_faire" || p.fiche_statut === "echec"));
    if (manquantes.length) {
      out.push({
        cle: `fiches:${s.id}`,
        poids: 5,
        ton: "neutre",
        titre: `Fiches de référence à générer : ${manquantes.map((p) => p.nom).join(", ")}`,
        detail: s.nom,
        action: "Bible",
        lien: `/series/${s.id}?onglet=bible`,
      });
    }
  }

  // Tâches en échec : seulement la plus récente de chaque genre, et seulement si rien n'a été relancé depuis.
  const toutes = [...(e.taches ?? []), ...(e.tachesRecentes ?? [])];
  const vues = new Set<string>();
  const echecs = [...(e.tachesRecentes ?? [])].filter((t) => t.statut === "echec").sort((a, b) => b.cree_le.localeCompare(a.cree_le));
  for (const t of echecs) {
    const cleT = `${t.type}:${t.episode_id ?? t.espace_id}:${String(t.donnees.personnage_id ?? "")}`;
    if (vues.has(cleT)) continue;
    vues.add(cleT);
    const relancee = toutes.some((x) => x.id !== t.id && x.type === t.type && x.episode_id === t.episode_id && x.espace_id === t.espace_id && x.cree_le > t.cree_le);
    if (relancee) continue;
    const ep = t.episode_id ? episodes.get(t.episode_id) : undefined;
    const perso = typeof t.donnees.personnage_id === "string" ? e.personnages.find((p) => p.id === t.donnees.personnage_id) : undefined;
    let lien = "/";
    let detail = t.erreur ?? "Erreur inconnue.";
    if (ep) {
      const serie = series.get(ep.serie_id);
      const saison = saisons.get(ep.saison_id);
      lien = lienEpisode(ep, etapeDeTache(t));
      detail = `${serie?.nom ?? ""} · ${codeEpisode(ep, saison)} · ${detail}`;
    } else if (perso) lien = `/series/${perso.serie_id}?onglet=bible`;
    else if (t.type === "test_complet") lien = "/diagnostic";
    else if (t.type === "stats") lien = "/statistiques";
    else continue;
    out.push({ cle: `tache:${t.id}`, poids: 0, ton: "erreur", titre: `Échec : ${NOMS_TACHES[t.type]}`, detail, action: "Voir", lien });
  }

  // Tri stable : à poids égal, l'ordre d'insertion est conservé.
  return out.map((x, i) => ({ x, i })).sort((a, b) => a.x.poids - b.x.poids || a.i - b.i).map((y) => y.x);
}
