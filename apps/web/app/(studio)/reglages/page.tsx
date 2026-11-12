// Réglages : comptes et réseaux, clés API, budget, préférences.
import type { Metadata } from "next";
import Link from "next/link";
import { porteeCourante } from "@/lib/espace-courant";
import { parametre, schemaOngletReglages } from "@/lib/schemas";
import { OngletBudget } from "./OngletBudget";
import { OngletCles } from "./OngletCles";
import { OngletComptes } from "./OngletComptes";
import { OngletPreferences } from "./OngletPreferences";
import { OngletSecurite } from "./OngletSecurite";

export const metadata: Metadata = { title: "Réglages" };

/** Onglets des réglages. */
const ONGLETS = [
  { cle: "comptes", libelle: "Comptes et réseaux" },
  { cle: "cles", libelle: "Clés API" },
  { cle: "budget", libelle: "Budget" },
  { cle: "preferences", libelle: "Préférences" },
  { cle: "securite", libelle: "Sécurité" },
] as const;

/** Page Réglages. */
export default async function PageReglages({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const onglet = schemaOngletReglages.parse(parametre(p.onglet));
  const portee = await porteeCourante();
  const titre = ONGLETS.find((o) => o.cle === onglet)?.libelle ?? "Réglages";
  return (
    <div className="pile pile--large">
      <header>
        <p className="surtitre">Réglages</p>
        <h1 className="h1">{titre}</h1>
      </header>
      <nav className="onglets" aria-label="Sections des réglages">
        {ONGLETS.map((o) => (
          <Link key={o.cle} href={`/reglages?onglet=${o.cle}`} className="onglet" aria-current={onglet === o.cle ? "page" : undefined}>
            {o.libelle}
          </Link>
        ))}
      </nav>
      {onglet === "comptes" ? <OngletComptes portee={portee} espaceDemande={parametre(p.espace)} /> : null}
      {onglet === "cles" ? <OngletCles /> : null}
      {onglet === "budget" ? <OngletBudget portee={portee} /> : null}
      {onglet === "preferences" ? <OngletPreferences /> : null}
      {onglet === "securite" ? <OngletSecurite /> : null}
    </div>
  );
}
