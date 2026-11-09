// Registre des tâches : chaque type de la file correspond à une fonction d'exécution.
import type { TypeTache } from "@studio-video-ia/core";
import type { Contexte } from "../contexte";
import { tacheClips } from "./clips";
import { tacheCloneVoix } from "./clone_voix";
import { tacheFichePersonnage } from "./fiche_personnage";
import { tacheMemoire } from "./memoire";
import { tachePublication } from "./publication";
import { tacheRendu } from "./rendu";
import { tacheScenario } from "./scenario";
import { tacheStats } from "./stats";
import { tacheStoryboard } from "./storyboard";
import { tacheTestComplet } from "./test_complet";

/** Fonction qui exécute une tâche. */
export type Executant = (ctx: Contexte) => Promise<void>;

/** Exécutant de chaque type de tâche. */
export const EXECUTANTS: Record<TypeTache, Executant> = {
  scenario: tacheScenario,
  storyboard: tacheStoryboard,
  clips: tacheClips,
  rendu: tacheRendu,
  publication: tachePublication,
  stats: tacheStats,
  fiche_personnage: tacheFichePersonnage,
  memoire: tacheMemoire,
  clone_voix: tacheCloneVoix,
  test_complet: tacheTestComplet,
};
