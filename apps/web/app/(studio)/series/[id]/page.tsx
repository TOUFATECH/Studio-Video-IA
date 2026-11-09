// Fiche d'une série : épisodes par saison, bible, mémoire et publication (rythme, hashtags, programmation).
import { NOMS_LANGUES } from "@studio-video-ia/core";
import type { Metadata } from "next";
import Link from "next/link";
import { ecrireSuite } from "@/app/actions/series";
import { RafraichissementDirect } from "@/components/RafraichissementDirect";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { parametre, schemaOngletSerie } from "@/lib/schemas";
import { chargerSerie } from "./chargement";
import { OngletBible } from "./OngletBible";
import { OngletEpisodes } from "./OngletEpisodes";
import { OngletMemoire } from "./OngletMemoire";
import { OngletPublication } from "./OngletPublication";

export const metadata: Metadata = { title: "Série" };

/** Onglets de la fiche. */
const ONGLETS = [
  { cle: "episodes", libelle: "Épisodes" },
  { cle: "bible", libelle: "Bible et personnages" },
  { cle: "memoire", libelle: "Mémoire" },
  { cle: "publication", libelle: "Publication" },
] as const;

/** Page de la série. */
export default async function PageSerie({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const p = await searchParams;
  const onglet = schemaOngletSerie.parse(parametre(p.onglet));
  const d = await chargerSerie(id);
  const nbEpisodes = d.episodes.filter((e) => e.genre === "episode").length;
  const compteurs: Record<(typeof ONGLETS)[number]["cle"], string> = {
    episodes: String(nbEpisodes),
    bible: String(d.personnages.length),
    memoire: String(d.memoire.length),
    publication: "",
  };
  const actif = d.taches.length > 0 || d.fiches.length > 0 || d.personnages.some((x) => x.fiche_statut === "en_cours");

  return (
    <div className="pile pile--large">
      <RafraichissementDirect actif={actif} intervalleMs={4000} />
      <header className="ligne ligne--entre ligne--bas">
        <div>
          <p className="surtitre">
            {d.espace.nom} · {d.serie.style_visuel} · langue d’origine {NOMS_LANGUES[d.serie.langue].toLowerCase()}
          </p>
          <h1 className="h1">{d.serie.nom}</h1>
        </div>
        <div className="ligne">
          <Link href="/series" className="btn">
            Toutes les séries
          </Link>
          <form action={ecrireSuite}>
            <input type="hidden" name="serie_id" value={d.serie.id} />
            <BoutonEnvoi variante="principal" enCours="Création…">
              Écrire la suite
            </BoutonEnvoi>
          </form>
        </div>
      </header>
      <nav className="onglets" aria-label="Sections de la série">
        {ONGLETS.map((o) => (
          <Link key={o.cle} href={`/series/${d.serie.id}?onglet=${o.cle}`} className="onglet" aria-current={onglet === o.cle ? "page" : undefined}>
            {o.libelle}
            {compteurs[o.cle] ? <span className="tres-petit doux">{compteurs[o.cle]}</span> : null}
          </Link>
        ))}
      </nav>
      {onglet === "episodes" ? <OngletEpisodes d={d} /> : null}
      {onglet === "bible" ? <OngletBible d={d} /> : null}
      {onglet === "memoire" ? <OngletMemoire d={d} /> : null}
      {onglet === "publication" ? <OngletPublication d={d} /> : null}
    </div>
  );
}
