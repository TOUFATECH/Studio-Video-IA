// Courbe SVG simple (sans librairie) : évolution d'une valeur sur quelques semaines.
import { traceCourbe } from "@/lib/statistiques";
import styles from "./courbe.module.scss";

/** Petite courbe décrite par son libellé pour les lecteurs d'écran. */
export function Courbe({ valeurs, libelle, largeur = 240, hauteur = 56 }: { valeurs: readonly number[]; libelle: string; largeur?: number; hauteur?: number }) {
  if (valeurs.length < 2) return <p className="tres-petit doux">Pas encore assez de jours pour une courbe.</p>;
  return (
    <svg className={styles.courbe} viewBox={`0 0 ${largeur} ${hauteur}`} role="img" aria-label={libelle} preserveAspectRatio="none">
      <path d={traceCourbe(valeurs, largeur, hauteur)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
