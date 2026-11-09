"use client";
// Sélecteur d'espace (« compte ») de la barre du haut : menu déroulant accessible au clavier.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { choisirEspace } from "@/app/actions/session";
import { Icone } from "@/components/ui/Icone";
import { PastilleEspace } from "@/components/ui/elements";
import styles from "./coquille.module.scss";

/** Option affichée dans le menu. */
export type OptionEspace = { id: string; nom: string; detail: string; couleur: string | null };

/** Bouton + menu de choix de l'espace. */
export function SelecteurEspace({ options, courant }: { options: OptionEspace[]; courant: string }) {
  const [ouvert, setOuvert] = useState(false);
  const boite = useRef<HTMLDivElement>(null);
  const actuel = options.find((o) => o.id === courant) ?? options[0];

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
      <button type="button" className="btn" aria-expanded={ouvert} aria-haspopup="true" onClick={() => setOuvert(!ouvert)}>
        {actuel?.couleur ? <PastilleEspace couleur={actuel.couleur} /> : <span className="pastille pastille--espace" aria-hidden="true" />}
        <span className="gras">{actuel?.nom ?? "Tous mes comptes"}</span>
        <span className={`tres-petit doux ${styles.masqueMobile}`}>{actuel?.detail}</span>
        <Icone nom="chevron" taille={14} />
      </button>
      {ouvert ? (
        <div className={`${styles.menu} ${styles.menuGauche}`}>
          <p className="surtitre">Comptes</p>
          {options.map((o) => (
            <form key={o.id} action={choisirEspace} onSubmit={() => setOuvert(false)}>
              <input type="hidden" name="espace" value={o.id} />
              <button type="submit" className={styles.elementMenu} aria-current={o.id === courant}>
                {o.couleur ? <PastilleEspace couleur={o.couleur} /> : <span className="pastille pastille--espace" aria-hidden="true" />}
                <span className={styles.elementTexte}>
                  <span className="gras">{o.nom}</span>
                  <span className="tres-petit doux">{o.detail}</span>
                </span>
                {o.id === courant ? <span className="tres-petit texte-attention">actif</span> : null}
              </button>
            </form>
          ))}
          <hr className={styles.separateur} />
          <Link className={styles.elementMenu} href="/reglages?onglet=comptes" onClick={() => setOuvert(false)}>
            Gérer les comptes et réseaux
          </Link>
        </div>
      ) : null}
    </div>
  );
}
