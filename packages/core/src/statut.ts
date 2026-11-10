// État d'avancement d'un épisode, calculé de la même façon dans le tableau de bord, la fiche série et le worker.
import { indexerFichiers, unitesClips, unitesRendu, unitesStoryboard, type Unite } from "./unites";
import type { Episode, Fichier, Personnage, Plan, Publication, Tache } from "./types";

/** Couleur sémantique d'un statut (traduite en couleur par l'interface). */
export type Ton = "neutre" | "info" | "attention" | "erreur" | "succes" | "secondaire";

/** Étape de l'épisode où se trouve l'action suivante. */
export type Etape = "son" | "scenario" | "storyboard" | "clips" | "montage" | "publication";

/** Compteurs d'une famille d'unités : faites, en échec, total. */
export type Compte = { fait: number; echec: number; total: number };

/** Résultat du calcul d'état d'un épisode. */
export type EtatEpisode = {
  statut: string;
  ton: Ton;
  etape: Etape;
  pourcentage: number;
  storyboard: Compte;
  valides: number;
  clips: Compte;
  rendus: Compte;
  publiees: number;
  programmees: number;
  echecs: number;
  tacheEnCours: Tache | null;
  /** Libellé de la prochaine action proposée à l'utilisateur. */
  action: string;
};

/** Compte les unités produites (fichier prêt) ou en échec. */
function compter(unites: readonly Unite[], index: Map<string, Fichier>): Compte {
  let fait = 0;
  let echec = 0;
  for (const u of unites) {
    const f = index.get(u.cle);
    if (f?.statut === "pret") fait++;
    else if (f?.statut === "echec") echec++;
  }
  return { fait, echec, total: unites.length };
}

/** Calcule l'état d'un épisode à partir de ses plans, fichiers, tâches actives et publications. */
export function etatEpisode(params: {
  episode: Episode;
  plans: readonly Plan[];
  personnages: readonly Personnage[];
  fichiers: readonly Fichier[];
  taches: readonly Tache[];
  publications: readonly Publication[];
}): EtatEpisode {
  const { episode, plans, personnages, fichiers, taches, publications } = params;
  const index = indexerFichiers(fichiers);
  const storyboard = compter(unitesStoryboard(plans), index);
  const clips = compter(unitesClips(episode, plans, personnages), index);
  const rendus = compter(unitesRendu(episode), index);
  const valides = plans.filter((p) => p.valide).length;
  const n = plans.length;
  const tacheEnCours = taches.find((t) => t.statut === "en_cours" || t.statut === "en_file" || t.statut === "en_pause") ?? null;
  const publiees = publications.filter((p) => p.statut === "publiee" || p.statut === "privee").length;
  const programmees = publications.filter((p) => ["attend_rendu", "programmee", "envoi", "traitement"].includes(p.statut)).length;
  const echecsPub = publications.filter((p) => p.statut === "echec").length;
  const echecs = clips.echec + storyboard.echec + rendus.echec + echecsPub;

  const sbFini = n > 0 && storyboard.fait === storyboard.total;
  const toutValide = n > 0 && valides === n;
  const clipsFinis = n > 0 && clips.fait === clips.total;
  const rendusFinis = n > 0 && rendus.fait === rendus.total;

  let statut: string;
  let ton: Ton;
  let etape: Etape;
  let action: string;
  const chanson = fichiers.some((f) => f.genre === "chanson" && f.statut === "pret");
  const estClip = episode.genre === "clip";
  if (n === 0 && estClip && tacheEnCours && etapeDeTache(tacheEnCours) === "son")
    [statut, ton, etape, action] = [libelleTache(tacheEnCours), tacheEnCours.statut === "en_cours" ? "info" : "attention", "son", "Voir la progression"];
  else if (n === 0 && estClip && !chanson) [statut, ton, etape, action] = ["Chanson à ajouter", "neutre", "son", "Ajouter la chanson"];
  else if (n === 0 && estClip && episode.paroles_alignees === null) [statut, ton, etape, action] = ["Paroles à synchroniser", "secondaire", "son", "Synchroniser les paroles"];
  else if (n === 0 && estClip && !tacheEnCours) [statut, ton, etape, action] = ["Prêt à découper", "secondaire", "scenario", "Découper le clip"];
  else if (n === 0 && !tacheEnCours) [statut, ton, etape, action] = ["Idée", "neutre", "scenario", "Écrire le scénario"];
  else if (tacheEnCours?.statut === "en_pause") [statut, ton, etape, action] = ["Budget atteint", "erreur", etapeDeTache(tacheEnCours), "Voir le budget"];
  else if (tacheEnCours) [statut, ton, etape, action] = [libelleTache(tacheEnCours), tacheEnCours.statut === "en_cours" ? "info" : "attention", etapeDeTache(tacheEnCours), "Voir la progression"];
  else if (storyboard.echec || clips.echec || rendus.echec) [statut, ton, etape, action] = ["Échec à corriger", "erreur", clips.echec ? "clips" : storyboard.echec ? "storyboard" : "montage", "Corriger l’échec"];
  else if (!sbFini) [statut, ton, etape, action] = [storyboard.fait ? "Images à compléter" : "Scénario prêt", storyboard.fait ? "attention" : "secondaire", "storyboard", "Générer le storyboard"];
  else if (!toutValide) [statut, ton, etape, action] = ["Storyboard à valider", "attention", "storyboard", "Valider le storyboard"];
  else if (!clipsFinis) [statut, ton, etape, action] = [clips.fait ? "Clips à compléter" : "Clips à lancer", "secondaire", "clips", "Lancer les clips"];
  else if (!rendusFinis) [statut, ton, etape, action] = ["À monter", "secondaire", "montage", "Lancer le rendu"];
  else if (echecsPub) [statut, ton, etape, action] = ["Publication en échec", "erreur", "publication", "Voir la publication"];
  else if (publiees) [statut, ton, etape, action] = ["Publié", "succes", "publication", estClip ? "Nouveau clip" : "Écrire la suite"];
  else if (programmees) [statut, ton, etape, action] = ["Programmé", "info", "publication", "Voir la publication"];
  else [statut, ton, etape, action] = [episode.genre === "episode" || estClip ? "Prêt à publier" : "Prêt", "succes", "publication", "Publier"];

  // Pondération : scénario 10 %, storyboard 20 %, clips 40 %, rendu 10 %, publication 20 %.
  const part = (c: Compte): number => (c.total ? c.fait / c.total : 0);
  // Un clip compte la chanson (3 %) et la synchronisation (3 %) dans ses 10 % de départ.
  const publiable = episode.genre === "episode" || estClip;
  const pourcentage =
    n === 0
      ? estClip
        ? (chanson ? 3 : 0) + (episode.paroles_alignees !== null ? 3 : 0)
        : episode.idee
          ? 4
          : 0
      : Math.min(100, Math.round(10 + 20 * part(storyboard) * (0.5 + 0.5 * (valides / n)) + 40 * part(clips) + 10 * part(rendus) + (!publiable ? 20 : publiees ? 20 : programmees ? 10 : 0)));

  return { statut, ton, etape, pourcentage, storyboard, valides, clips, rendus, publiees, programmees, echecs, tacheEnCours, action };
}

/** Étape de l'épisode concernée par une tâche. */
export function etapeDeTache(t: Pick<Tache, "type">): Etape {
  if (t.type === "paroles" || t.type === "musique" || t.type === "synchro") return "son";
  if (t.type === "storyboard") return "storyboard";
  if (t.type === "clips") return "clips";
  if (t.type === "rendu" || t.type === "memoire") return "montage";
  if (t.type === "publication" || t.type === "stats") return "publication";
  return "scenario";
}

/** Libellé court d'une tâche active. */
export function libelleTache(t: Pick<Tache, "type" | "statut">): string {
  const noms: Record<Tache["type"], string> = {
    scenario: "Écriture",
    storyboard: "Images",
    clips: "Clips et voix",
    rendu: "Rendu",
    publication: "Publication",
    stats: "Statistiques",
    fiche_personnage: "Fiche personnage",
    memoire: "Mémoire",
    clone_voix: "Clonage de voix",
    test_complet: "Test complet",
    paroles: "Paroles",
    musique: "Musique",
    synchro: "Synchronisation",
  };
  if (t.statut === "en_file") return `${noms[t.type]} · en file`;
  if (t.statut === "en_pause") return `${noms[t.type]} · en pause`;
  return `${noms[t.type]} en cours`;
}
