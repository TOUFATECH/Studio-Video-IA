// Planificateur (toutes les 30 s) : crée les tâches de publication à l'heure, clôt les publications YouTube programmées,
// relance les tâches en pause quand le budget le permet. Ne crée jamais deux tâches pour la même publication.
import type { Reseau, StatutPublication } from "@studio-video-ia/core";
import { plafondAtteint, type AccesBudget } from "./budget";
import { ErreurBase, lignes, ecrire, type Base } from "./supabase";

/** Ce que le planificateur doit savoir d'une publication programmée. */
export type PublicationAPlanifier = {
  id: string;
  episode_id: string;
  espace_id: string;
  reseau: Reseau;
  statut: StatutPublication;
  programmee_le: string;
  id_externe: string | null;
};

/** Décisions prises pour un lot de publications. */
export type Decisions = { aCreer: PublicationAPlanifier[]; aMarquerPubliees: PublicationAPlanifier[] };

/**
 * Décide, sans effet de bord, quoi faire de chaque publication `programmee` :
 * - YouTube sans id_externe : tâche tout de suite (YouTube programme lui-même à la date voulue) ;
 * - Instagram et TikTok dont l'heure est venue : tâche (ces API ne programment pas) ;
 * - YouTube déjà envoyé dont la date est passée : marquée publiée.
 * Une publication qui a déjà une tâche active n'en reçoit jamais une seconde.
 */
export function deciderPublications(publications: readonly PublicationAPlanifier[], avecTacheActive: ReadonlySet<string>, maintenant: Date): Decisions {
  const aCreer: PublicationAPlanifier[] = [];
  const aMarquerPubliees: PublicationAPlanifier[] = [];
  const dejaPrises = new Set(avecTacheActive);
  for (const p of publications) {
    if (p.statut !== "programmee") continue;
    const due = new Date(p.programmee_le).getTime() <= maintenant.getTime();
    if (p.reseau === "youtube") {
      if (p.id_externe) {
        if (due) aMarquerPubliees.push(p);
        continue;
      }
    } else if (!due) continue;
    if (dejaPrises.has(p.id)) continue;
    dejaPrises.add(p.id);
    aCreer.push(p);
  }
  return { aCreer, aMarquerPubliees };
}

/** Accès du planificateur à la base (remplaçable par un faux dans les tests). */
export type AccesPlanificateur = AccesBudget & {
  maintenant: () => Date;
  publicationsProgrammees: () => Promise<PublicationAPlanifier[]>;
  publicationsAvecTacheActive: (ids: readonly string[]) => Promise<Set<string>>;
  creerTachePublication: (p: PublicationAPlanifier) => Promise<void>;
  marquerPubliee: (p: PublicationAPlanifier) => Promise<void>;
  tachesEnPause: () => Promise<{ id: string; espace_id: string }[]>;
  remettreEnFile: (ids: readonly string[]) => Promise<void>;
};

/** Bilan d'un passage du planificateur. */
export type BilanPlanification = { tachesCreees: number; publiees: number; reprises: number };

/** Un passage du planificateur. */
export async function planifier(acces: AccesPlanificateur): Promise<BilanPlanification> {
  const maintenant = acces.maintenant();
  const publications = await acces.publicationsProgrammees();
  const actives = await acces.publicationsAvecTacheActive(publications.map((p) => p.id));
  const d = deciderPublications(publications, actives, maintenant);
  for (const p of d.aCreer) await acces.creerTachePublication(p);
  for (const p of d.aMarquerPubliees) await acces.marquerPubliee(p);

  // Tâches en pause : reprises espace par espace dès que le plafond n'est plus atteint.
  const enPause = await acces.tachesEnPause();
  const parEspace = new Map<string, string[]>();
  for (const t of enPause) parEspace.set(t.espace_id, [...(parEspace.get(t.espace_id) ?? []), t.id]);
  let reprises = 0;
  for (const [espace, ids] of parEspace) {
    if (await plafondAtteint(acces, espace)) continue;
    await acces.remettreEnFile(ids);
    reprises += ids.length;
  }
  return { tachesCreees: d.aCreer.length, publiees: d.aMarquerPubliees.length, reprises };
}

/** Statuts d'une tâche considérée comme active (empêche d'en créer une seconde). */
export const STATUTS_ACTIFS = ["en_file", "en_cours", "en_pause"] as const;

/** Accès réel du planificateur dans Supabase. */
export function accesPlanificateurSupabase(db: Base, budget: AccesBudget): AccesPlanificateur {
  return {
    ...budget,
    maintenant: () => new Date(),
    publicationsProgrammees: async () => {
      type Rang = { id: string; episode_id: string; statut: StatutPublication; programmee_le: string; id_externe: string | null; reseaux_connectes: { reseau: Reseau; espace_id: string } | null };
      const rangs = await lignes<Rang>(
        db.from("publications").select("id, episode_id, statut, programmee_le, id_externe, reseaux_connectes(reseau, espace_id)").eq("statut", "programmee").limit(500),
        "publications programmées",
      );
      return rangs
        .filter((r) => r.reseaux_connectes)
        .map((r) => ({ id: r.id, episode_id: r.episode_id, statut: r.statut, programmee_le: r.programmee_le, id_externe: r.id_externe, reseau: r.reseaux_connectes?.reseau ?? "youtube", espace_id: r.reseaux_connectes?.espace_id ?? "" }));
    },
    publicationsAvecTacheActive: async (ids) => {
      if (ids.length === 0) return new Set();
      const rangs = await lignes<{ publication_id: string | null }>(
        db.from("taches").select("publication_id").in("publication_id", [...ids]).in("statut", [...STATUTS_ACTIFS]),
        "tâches de publication actives",
      );
      return new Set(rangs.map((r) => r.publication_id ?? "").filter(Boolean));
    },
    creerTachePublication: async (p) => {
      const { error } = await db.from("taches").insert({ espace_id: p.espace_id, episode_id: p.episode_id, publication_id: p.id, type: "publication", priorite: 10, donnees: { publication_id: p.id } });
      // 23505 : un autre worker vient de créer la même tâche (index unique conseillé) ; ce n'est pas une erreur.
      if (error && error.code !== "23505") throw new ErreurBase("création d'une tâche de publication", error.message, error.code);
    },
    marquerPubliee: async (p) => {
      await ecrire(db.from("publications").update({ statut: "publiee", publiee_le: p.programmee_le }).eq("id", p.id).eq("statut", "programmee"), "publication YouTube publiée");
    },
    tachesEnPause: async () => lignes<{ id: string; espace_id: string }>(db.from("taches").select("id, espace_id").eq("statut", "en_pause"), "tâches en pause"),
    remettreEnFile: async (ids) => {
      await ecrire(db.from("taches").update({ statut: "en_file", erreur: null, verrouille_par: null, modifie_le: new Date().toISOString() }).in("id", [...ids]).eq("statut", "en_pause"), "reprise des tâches en pause");
    },
  };
}
