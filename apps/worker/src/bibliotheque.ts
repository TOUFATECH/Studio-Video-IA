// Bibliothèque d'un épisode : qui est à l'image, quel décor, quelles photos de référence envoyer aux IA.
// « Toujours partir des mêmes références » : une image de chaque personnage et une photo du vrai décor, données ensemble.
import type { Element, Fichier, Personnage, Plan, Scene } from "@studio-video-ia/core";
import type { ImageReference } from "@studio-video-ia/integrations";
import type { Stockage } from "./stockage";

/** Extensions d'images acceptées comme références par les IA d'images et de vidéos. */
const EXTENSIONS_IMAGE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Type MIME d'une image de référence d'après son chemin, ou null si ce n'est pas une image utilisable. */
export function typeImage(chemin: string | null): string | null {
  const ext = (chemin ?? "").split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONS_IMAGE[ext] ?? null;
}

/**
 * Personnages à l'image : ceux cochés sur le plan, celui qui parle, et ceux dont le nom apparaît dans la description.
 * Ordre stable : celui de la bibliothèque.
 */
export function personnagesDuPlan(plan: Pick<Plan, "personnage_id" | "texte"> & Partial<Pick<Plan, "personnages">>, personnages: readonly Personnage[]): Personnage[] {
  const coches = new Set(plan.personnages ?? []);
  const texte = plan.texte.toLowerCase();
  return personnages.filter((p) => coches.has(p.id) || p.id === plan.personnage_id || (p.nom.trim().length > 1 && texte.includes(p.nom.trim().toLowerCase())));
}

/** Décor du plan : le sien, sinon le lieu de sa scène. */
export function decorDuPlan(plan: Pick<Plan, "decor_id" | "scene_id">, scenes: readonly Scene[], elements: readonly Element[]): Element | null {
  const id = plan.decor_id ?? scenes.find((s) => s.id === plan.scene_id)?.lieu_id ?? null;
  return elements.find((e) => e.id === id && e.genre === "decor") ?? null;
}

/** Activité du plan, s'il en a une. */
export function activiteDuPlan(plan: Pick<Plan, "activite_id">, elements: readonly Element[]): Element | null {
  return elements.find((e) => e.id === plan.activite_id && e.genre === "activite") ?? null;
}

/** Variantes choisies pour le plan (« capuche cachant tous les cheveux »). */
export function variantesDuPlan(plan: Pick<Plan, "variantes">, elements: readonly Element[]): Element[] {
  const ids = new Set(plan.variantes ?? []);
  return elements.filter((e) => e.genre === "variante" && ids.has(e.id));
}

/** Photos de référence d'un personnage ou d'un élément (images seulement), de la plus récente à la plus ancienne. */
export function photosDe(references: readonly Fichier[], cible: { personnage_id?: string; element_id?: string }): Fichier[] {
  return references
    .filter((f) => f.statut === "pret" && typeImage(f.chemin) && (cible.personnage_id ? f.personnage_id === cible.personnage_id : f.element_id === cible.element_id))
    .sort((a, b) => b.cree_le.localeCompare(a.cree_le));
}

/** Une référence à envoyer : son chemin dans les médias et son libellé pour le prompt vidéo. */
export type ReferencePrevue = { chemin: string; type: string; libelle: string };

/**
 * Références d'un plan, dans l'ordre : pour chaque personnage, sa variante ou sa fiche validée ou sa photo la plus récente ;
 * puis la photo du vrai décor. `max` limite le nombre total (les IA en acceptent un nombre limité).
 */
export function referencesDuPlan(params: {
  personnages: readonly Personnage[];
  variantes: readonly Element[];
  decor: Element | null;
  references: readonly Fichier[];
  max: number;
}): ReferencePrevue[] {
  const out: ReferencePrevue[] = [];
  for (const p of params.personnages) {
    const variante = params.variantes.find((v) => v.personnage_id === p.id);
    const photoVariante = variante ? photosDe(params.references, { element_id: variante.id })[0] : undefined;
    if (photoVariante?.chemin) {
      out.push({ chemin: photoVariante.chemin, type: typeImage(photoVariante.chemin) ?? "image/png", libelle: `${p.nom} (${variante?.nom ?? "variante"})` });
      continue;
    }
    if (p.fiche_statut === "prete" && p.fiche_chemin) {
      out.push({ chemin: p.fiche_chemin, type: typeImage(p.fiche_chemin) ?? "image/png", libelle: p.nom });
      continue;
    }
    const photo = photosDe(params.references, { personnage_id: p.id })[0];
    if (photo?.chemin) out.push({ chemin: photo.chemin, type: typeImage(photo.chemin) ?? "image/png", libelle: p.nom });
  }
  if (params.decor) {
    const photo = photosDe(params.references, { element_id: params.decor.id })[0];
    if (photo?.chemin) out.push({ chemin: photo.chemin, type: typeImage(photo.chemin) ?? "image/png", libelle: `le décor « ${params.decor.nom} »` });
  }
  return out.slice(0, params.max);
}

/** Lit les références prévues dans le stockage ; une photo illisible est ignorée (journalisée). */
export async function lireReferences(stockage: Stockage, prevues: readonly ReferencePrevue[], journal: (m: string) => void): Promise<(ImageReference & { libelle: string; chemin: string })[]> {
  const out: (ImageReference & { libelle: string; chemin: string })[] = [];
  for (const [i, r] of prevues.entries()) {
    try {
      out.push({ nom: `reference-${i}.${r.type.split("/")[1] ?? "png"}`, donnees: await stockage.lire(r.chemin), type: r.type, libelle: r.libelle, chemin: r.chemin });
    } catch (e) {
      journal(`référence illisible (${r.libelle}), ignorée : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

/** Logo de la marque de la série (photo de référence de l'élément « marque »), ou null. */
export function logoDeLaSerie(elements: readonly Element[], references: readonly Fichier[]): { chemin: string; couleur: string | null } | null {
  for (const m of elements.filter((e) => e.genre === "marque")) {
    const photo = photosDe(references, { element_id: m.id })[0];
    if (photo?.chemin) return { chemin: photo.chemin, couleur: m.couleurs?.principale ?? null };
  }
  return null;
}
