// Page 404 : adresse inconnue ou élément qui n'appartient pas à l'utilisateur.
import Link from "next/link";

/** Page introuvable. */
export default function Introuvable() {
  return (
    <main className="vide" style={{ minHeight: "60vh", justifyContent: "center" }}>
      <h1 className="h1">Introuvable</h1>
      <p className="petit doux">Cette page n’existe pas, ou cet élément n’est pas dans tes comptes.</p>
      <Link href="/" className="btn btn--principal">
        Retour à l’accueil
      </Link>
    </main>
  );
}
