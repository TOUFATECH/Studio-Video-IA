"use client";
// Bouton « Nouveau » : série, épisode (suite de la dernière série ouverte) ou compte.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icone } from "@/components/ui/Icone";
import styles from "./coquille.module.scss";

/** Menu de création. `serie` : dernière série ouverte, pour proposer un épisode. */
export function MenuNouveau({ serie }: { serie: { id: string; nom: string } | null }) {
  const [ouvert, setOuvert] = useState(false);
  const boite = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    /** Ferme le menu au clic à l'extérieur ou sur Échap. */
    const fermer = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !boite.current?.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", fermer);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", fermer);
    };
  }, [ouvert]);
  return (
    <div className={styles.menuConteneur} ref={boite}>
      <button type="button" className="btn btn--principal" aria-expanded={ouvert} aria-haspopup="true" onClick={() => setOuvert(!ouvert)}>
        <Icone nom="plus" />
        Nouveau
      </button>
      {ouvert ? (
        <div className={`${styles.menu} ${styles.menuDroite}`}>
          <Link className={styles.elementMenu} href="/series?nouvelle=1" onClick={() => setOuvert(false)}>
            <span className={styles.elementTexte}>
              <span className="gras">Série</span>
              <span className="tres-petit doux">Une nouvelle histoire, avec sa bible et ses saisons</span>
            </span>
          </Link>
          <Link className={styles.elementMenu} href={serie ? `/series/${serie.id}?onglet=episodes` : "/series"} onClick={() => setOuvert(false)}>
            <span className={styles.elementTexte}>
              <span className="gras">Épisode</span>
              <span className="tres-petit doux">{serie ? `Dans « ${serie.nom} », avec la continuité` : "Dans une série existante"}</span>
            </span>
          </Link>
          <Link className={styles.elementMenu} href="/reglages?onglet=comptes#nouveau-compte" onClick={() => setOuvert(false)}>
            <span className={styles.elementTexte}>
              <span className="gras">Compte</span>
              <span className="tres-petit doux">Un espace avec ses propres réseaux et son budget</span>
            </span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
