// Plafond mensuel de dépense : contrôle avant une tâche payante et reprise des tâches mises en pause.
import type { TypeTache } from "@feuilleton/core";
import type { Base } from "./supabase";
import { ligne } from "./supabase";

/** Tâches qui coûtent de l'argent chez un fournisseur d'IA. */
export const TYPES_PAYANTS: ReadonlySet<TypeTache> = new Set<TypeTache>(["scenario", "storyboard", "clips", "fiche_personnage", "memoire", "clone_voix", "test_complet"]);

/** Vrai si ce type de tâche est payant. */
export function estPayante(type: TypeTache): boolean {
  return TYPES_PAYANTS.has(type);
}

/** Accès nécessaires au contrôle du budget (remplaçable par un faux dans les tests). */
export type AccesBudget = {
  depenseDuMois: (espaceId: string) => Promise<number>;
  plafond: (espaceId: string) => Promise<number>;
};

/** Vrai si la dépense du mois a atteint le plafond de l'espace. */
export async function plafondAtteint(acces: AccesBudget, espaceId: string): Promise<boolean> {
  const [depense, plafond] = await Promise.all([acces.depenseDuMois(espaceId), acces.plafond(espaceId)]);
  return depense >= plafond;
}

/** Accès réel au budget dans Supabase (fonction depense_du_mois et colonne plafond_mensuel). */
export function accesBudgetSupabase(db: Base): AccesBudget {
  return {
    depenseDuMois: async (espaceId) => {
      const { data, error } = await db.rpc("depense_du_mois", { e: espaceId });
      if (error) throw new Error(`Dépense du mois illisible : ${error.message}`);
      return Number(data ?? 0);
    },
    plafond: async (espaceId) => {
      const e = await ligne<{ plafond_mensuel: number | string }>(db.from("espaces").select("plafond_mensuel").eq("id", espaceId).limit(1), "plafond");
      return Number(e.plafond_mensuel);
    },
  };
}
