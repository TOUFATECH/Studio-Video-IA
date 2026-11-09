// Accès aux fichiers du bucket privé « medias » : URL signées et suppression.
// Les chemins viennent de lignes déjà lues avec la RLS : ils appartiennent à l'utilisateur.
import "server-only";
import { clientAdmin } from "./supabase/admin";

/** Nom du bucket des médias. */
export const BUCKET = "medias";

/** URL signées (1 h par défaut) d'une liste de chemins ; chemin → URL. */
export async function urlsSignees(chemins: readonly (string | null | undefined)[], dureeSecondes = 3600): Promise<Map<string, string>> {
  const uniques = [...new Set(chemins.filter((c): c is string => !!c))];
  const m = new Map<string, string>();
  if (!uniques.length) return m;
  try {
    const { data } = await clientAdmin().storage.from(BUCKET).createSignedUrls(uniques, dureeSecondes);
    for (const d of data ?? []) if (d.path && d.signedUrl) m.set(d.path, d.signedUrl);
  } catch (e) {
    // Sans URL, l'interface affiche un cadre vide : on ne bloque pas la page.
    console.warn("URL signées indisponibles :", e);
  }
  return m;
}

/** Supprime des objets du bucket (sans erreur si certains n'existent plus). */
export async function supprimerObjets(chemins: readonly (string | null | undefined)[]): Promise<void> {
  const liste = [...new Set(chemins.filter((c): c is string => !!c))];
  if (!liste.length) return;
  const { error } = await clientAdmin().storage.from(BUCKET).remove(liste);
  if (error) console.warn("Suppression de médias incomplète :", error.message);
}
