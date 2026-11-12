// Page du code de double authentification (après le mot de passe).
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui/Icone";
import { cheminSur, parametre } from "@/lib/schemas";
import styles from "../connexion.module.scss";
import { FormulaireCode } from "./FormulaireCode";

export const metadata: Metadata = { title: "Code de connexion" };
export const dynamic = "force-dynamic";

/** Écran du code. */
export default async function PageCode({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  return (
    <main className={styles.page}>
      <div className={styles.boite}>
        <p className={styles.marque}>
          <Logo />
          <span className="h2">Studio Vidéo IA</span>
        </p>
        <h1 className="h1">Double authentification</h1>
        <p className="petit doux">Ouvre ton appli d’authentification (Google Authenticator, Microsoft Authenticator…) et tape le code de Studio Vidéo IA.</p>
        <FormulaireCode suite={cheminSur(parametre(p.suite))} />
        <Link href="/connexion" className="tres-petit doux">
          Revenir au mot de passe
        </Link>
      </div>
    </main>
  );
}
