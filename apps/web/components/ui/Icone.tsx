// Icônes SVG inline (aucune librairie) : décoratives, donc masquées aux lecteurs d'écran.
import type { ReactNode } from "react";

/** Noms des icônes disponibles. */
export type NomIcone = "plus" | "chevron" | "copier" | "lecture" | "actualiser" | "fleche-gauche" | "fleche-droite" | "lien-externe" | "verrou";

/** Tracés de chaque icône (grille 24 × 24, trait de la couleur du texte). */
const TRACES: Record<NomIcone, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  copier: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </>
  ),
  lecture: <path d="M8 5v14l11-7z" />,
  actualiser: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  "fleche-gauche": <path d="M15 18l-6-6 6-6" />,
  "fleche-droite": <path d="m9 18 6-6-6-6" />,
  "lien-externe": <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  verrou: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
};

/** Icône décorative. */
export function Icone({ nom, taille = 16 }: { nom: NomIcone; taille?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {TRACES[nom]}
    </svg>
  );
}

/** Logo de Studio Vidéo IA (pellicule stylisée). */
export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" focusable="false">
      <rect x="1" y="5" width="24" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7" cy="13" r="2.4" fill="var(--couleur-accent)" />
      <path d="M12 10h9M12 13h7M12 16h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
