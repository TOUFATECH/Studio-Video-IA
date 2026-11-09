"use client";
// Écran d'erreur des pages connectées : message simple, nouvel essai, lien vers le diagnostic.
import Link from "next/link";

/** Erreur inattendue pendant l'affichage d'une page. */
export default function Erreur({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="carte vide" role="alert">
      <h1 className="h2">Cette page n’a pas pu s’afficher</h1>
      <p className="petit doux">La base ou un service ne répond peut-être pas. Réessaie, ou ouvre le diagnostic pour voir ce qui bloque.</p>
      <div className="ligne">
        <button type="button" className="btn btn--principal" onClick={reset}>
          Réessayer
        </button>
        <Link href="/diagnostic" className="btn">
          Diagnostic
        </Link>
      </div>
    </div>
  );
}
