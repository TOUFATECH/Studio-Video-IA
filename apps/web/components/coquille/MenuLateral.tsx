"use client";
// Menu latéral : navigation principale, badge « À faire » sur l'accueil, carte de l'épisode ouvert.
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./coquille.module.scss";

/** Entrées du menu. */
const ENTREES = [
  { href: "/", libelle: "Accueil", actif: (c: string) => c === "/" },
  { href: "/series", libelle: "Séries", actif: (c: string) => c.startsWith("/series") || c.startsWith("/episodes") },
  { href: "/clips", libelle: "Clips", actif: (c: string) => c.startsWith("/clips") },
  { href: "/calendrier", libelle: "Calendrier", actif: (c: string) => c.startsWith("/calendrier") },
  { href: "/statistiques", libelle: "Statistiques", actif: (c: string) => c.startsWith("/statistiques") },
  { href: "/reglages", libelle: "Réglages", actif: (c: string) => c.startsWith("/reglages") },
  { href: "/diagnostic", libelle: "Diagnostic", actif: (c: string) => c.startsWith("/diagnostic") },
];

/** Menu de navigation. */
export function MenuLateral({ aFaire, episodeOuvert }: { aFaire: number; episodeOuvert: { lien: string; titre: string; detail: string } | null }) {
  const chemin = usePathname();
  return (
    <nav aria-label="Navigation principale" className={styles.lateral}>
      <ul className={styles.liste}>
        {ENTREES.map((e) => (
          <li key={e.href}>
            <Link href={e.href} className={styles.lienNav} aria-current={e.actif(chemin) ? "page" : undefined}>
              <span>{e.libelle}</span>
              {e.href === "/" && aFaire > 0 ? (
                <span className={styles.badge}>
                  {aFaire}
                  <span className="invisible"> à faire</span>
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      {episodeOuvert && !chemin.startsWith("/episodes") && !chemin.startsWith("/clips/") ? (
        <Link href={episodeOuvert.lien} className={styles.episodeOuvert}>
          <span className="surtitre">Épisode ouvert</span>
          <span className="gras">{episodeOuvert.titre}</span>
          <span className="tres-petit doux">{episodeOuvert.detail}</span>
        </Link>
      ) : null}
    </nav>
  );
}
