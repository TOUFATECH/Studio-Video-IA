// Contexte passé à chaque tâche : accès base et stockage, clés, progression, budget, dossier temporaire, arrêt.
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Tache } from "@feuilleton/core";
import type { Fetch } from "@feuilleton/integrations";
import { chargerCles, proprietaireEspace, type ClesProprietaire } from "./cles";
import type { Config } from "./config";
import { journal } from "./journal";
import type { Stockage } from "./stockage";
import type { Base } from "./supabase";

/** Le plafond mensuel de dépense de l'espace est atteint : la tâche est mise en pause. */
export class ErreurPlafond extends Error {
  /** Crée l'erreur avec le message affiché dans l'interface. */
  constructor() {
    super("Plafond du mois atteint");
    this.name = "ErreurPlafond";
  }
}

/** La tâche a été annulée depuis l'interface (statut changé pendant le travail). */
export class ErreurAnnulee extends Error {
  /** Crée l'erreur d'annulation. */
  constructor() {
    super("Tâche annulée");
    this.name = "ErreurAnnulee";
  }
}

/** Le worker s'arrête : la tâche sera remise en file pour être reprise plus tard. */
export class ErreurArret extends Error {
  /** Crée l'erreur d'arrêt. */
  constructor() {
    super("Arrêt du worker");
    this.name = "ErreurArret";
  }
}

/** Progression d'une tâche, suivie en temps réel par l'interface. */
export type Progression = { fait?: number; total?: number; etape?: string; secondes?: number } & Record<string, unknown>;

/** Tout ce dont une tâche a besoin. */
export type Contexte = {
  db: Base;
  config: Config;
  stockage: Stockage;
  cleMaitre: Buffer;
  tache: Tache;
  /** Déclenché à l'arrêt du worker : les tâches longues s'interrompent entre deux unités. */
  signal: AbortSignal;
  /** fetch injectable (tests). */
  f: Fetch;
  /** Met à jour la progression ; lève ErreurAnnulee si la tâche a été annulée entre-temps. */
  progression: (p: Progression) => Promise<void>;
  /** Clés du propriétaire de l'espace (lues une seule fois). */
  cles: () => Promise<ClesProprietaire>;
  proprietaire: () => Promise<string>;
  /** Lève ErreurPlafond si le plafond mensuel est atteint (contrôle entre deux générations payantes). */
  verifierBudget: () => Promise<void>;
  /** Dossier temporaire propre à la tâche (créé à la demande, supprimé à la fin). */
  dossier: () => Promise<string>;
  /** Lève ErreurArret si le worker s'arrête. */
  verifierArret: () => void;
  journal: (message: string) => void;
};

/** Paramètres pour fabriquer un contexte. */
export type DependancesContexte = {
  db: Base;
  config: Config;
  stockage: Stockage;
  cleMaitre: Buffer;
  signal: AbortSignal;
  f?: Fetch;
  plafondAtteint: (espaceId: string) => Promise<boolean>;
};

/** Fabrique le contexte d'une tâche. `nettoyer` supprime son dossier temporaire. */
export function creerContexte(d: DependancesContexte, tache: Tache): { ctx: Contexte; nettoyer: () => Promise<void> } {
  const debut = Date.now();
  let cles: ClesProprietaire | null = null;
  let proprietaire: string | null = null;
  let dossier: string | null = null;
  const ctx: Contexte = {
    db: d.db,
    config: d.config,
    stockage: d.stockage,
    cleMaitre: d.cleMaitre,
    tache,
    signal: d.signal,
    f: d.f ?? fetch,
    progression: async (p) => {
      const valeur: Progression = { ...p, secondes: Math.round((Date.now() - debut) / 1000) };
      tache.progression = valeur;
      // La condition sur le statut détecte une annulation faite depuis l'interface pendant le travail.
      const { data, error } = await d.db
        .from("taches")
        .update({ progression: valeur, modifie_le: new Date().toISOString() })
        .eq("id", tache.id)
        .eq("statut", "en_cours")
        .select("id");
      if (error) journal("attention", `progression non enregistrée : ${error.message}`, tache.type);
      else if (Array.isArray(data) && data.length === 0) throw new ErreurAnnulee();
    },
    proprietaire: async () => {
      proprietaire ??= await proprietaireEspace(d.db, tache.espace_id);
      return proprietaire;
    },
    cles: async () => {
      cles ??= await chargerCles(d.db, d.cleMaitre, await ctx.proprietaire());
      return cles;
    },
    verifierBudget: async () => {
      if (await d.plafondAtteint(tache.espace_id)) throw new ErreurPlafond();
    },
    dossier: async () => {
      if (!dossier) {
        dossier = join(d.config.dossierTemp, tache.id);
        await mkdir(dossier, { recursive: true });
      }
      return dossier;
    },
    verifierArret: () => {
      if (d.signal.aborted) throw new ErreurArret();
    },
    journal: (message) => journal("info", message, `${tache.type} ${tache.id.slice(0, 8)}`),
  };
  const nettoyer = async (): Promise<void> => {
    if (dossier) await rm(dossier, { recursive: true, force: true });
  };
  return { ctx, nettoyer };
}

/** Exécute `fn` sur chaque élément avec au plus `n` exécutions simultanées, dans l'ordre de la liste. */
export async function enParallele<T>(elements: readonly T[], n: number, fn: (e: T, i: number) => Promise<void>): Promise<void> {
  let suivant = 0;
  const travailleurs = Array.from({ length: Math.max(1, Math.min(n, elements.length)) }, async () => {
    while (suivant < elements.length) {
      const i = suivant++;
      await fn(elements[i] as T, i);
    }
  });
  await Promise.all(travailleurs);
}

/**
 * Exécute une génération avec une relance automatique en cas d'échec.
 * Les arrêts, annulations et dépassements de plafond ne sont jamais relancés.
 */
export async function avecRelance<T>(fn: (essai: number) => Promise<T>): Promise<{ valeur: T; essais: number }> {
  try {
    return { valeur: await fn(1), essais: 1 };
  } catch (e) {
    if (e instanceof ErreurArret || e instanceof ErreurAnnulee || e instanceof ErreurPlafond) throw e;
    return { valeur: await fn(2), essais: 2 };
  }
}
