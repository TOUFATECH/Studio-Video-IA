// Programmation des épisodes prêts d'une série : un créneau par épisode, en suivant le rythme de la série.
// Fonction pure, testée dans tests/programmation.test.ts.
import { prochainCreneau, type Rythme } from "@feuilleton/core";

/** Un épisode et la date de sortie proposée. */
export type Creneau<E> = { episode: E; instant: Date };

/**
 * Enchaîne les créneaux : le premier épisode prend le prochain créneau après la dernière sortie déjà programmée,
 * chaque suivant prend le créneau N jours après le précédent.
 */
export function enchainerCreneaux<E>(
  episodes: readonly E[],
  rythme: Pick<Rythme, "tous_les_jours" | "heure">,
  derniere: Date | null,
  maintenant: Date,
  fuseau: string,
): Creneau<E>[] {
  const out: Creneau<E>[] = [];
  let precedent = derniere;
  for (const episode of episodes) {
    const instant = prochainCreneau(rythme, precedent, maintenant, fuseau);
    out.push({ episode, instant });
    precedent = instant;
  }
  return out;
}
