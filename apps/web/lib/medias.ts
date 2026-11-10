// Accès aux médias (dossier local des données) : adresses signées pour le navigateur, écriture, suppression.
// Les chemins viennent de lignes déjà lues avec les règles d'accès : ils appartiennent à l'utilisateur.
import "server-only";
import { base } from "./bdd";

/** Adresses signées (1 h par défaut) d'une liste de chemins ; chemin → adresse « /api/medias/… ». */
export async function urlsSignees(chemins: readonly (string | null | undefined)[], dureeSecondes = 3600): Promise<Map<string, string>> {
  const uniques = [...new Set(chemins.filter((c): c is string => !!c))];
  const m = new Map<string, string>();
  if (!uniques.length) return m;
  const { depot } = await base();
  for (const c of uniques) {
    try {
      m.set(c, depot.adresseSignee(c, dureeSecondes));
    } catch {
      // Chemin invalide : l'interface affiche un cadre vide, sans bloquer la page.
    }
  }
  return m;
}

/** Écrit un média. */
export async function ecrireMedia(chemin: string, octets: Uint8Array): Promise<void> {
  await (await base()).depot.ecrire(chemin, octets);
}

/** Supprime des médias (sans erreur si certains n'existent plus). */
export async function supprimerObjets(chemins: readonly (string | null | undefined)[]): Promise<void> {
  const liste = [...new Set(chemins.filter((c): c is string => !!c))];
  if (!liste.length) return;
  await (await base()).depot.supprimer(liste);
}
