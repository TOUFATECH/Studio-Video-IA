// Calendrier : publications de J-3 à J+13, regroupées par jour dans le fuseau de leur espace, filtrables par réseau.
import { NOMS_RESEAUX, RESEAUX, ajouterJours, dateLocale } from "@studio-video-ia/core";
import type { Metadata } from "next";
import Link from "next/link";
import { BadgeReseau, Puce } from "@/components/ui/elements";
import { chargerProduction } from "@/lib/donnees";
import { codeEpisode, lienEpisode, nomEpisode } from "@/lib/episodes";
import { fuseauReference } from "@/lib/espace-courant";
import { cleJour, compact, heure, jourCourt } from "@/lib/format";
import { statutPublication } from "@/lib/libelles";
import { parametre, schemaFiltreReseau } from "@/lib/schemas";

export const metadata: Metadata = { title: "Calendrier" };

/** Page Calendrier. */
export default async function PageCalendrier({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const filtre = schemaFiltreReseau.parse(parametre(p.reseau));
  const prod = await chargerProduction();
  const fuseau = fuseauReference(prod.portee);
  const aujourdhui = dateLocale(new Date(), fuseau);
  const jours = Array.from({ length: 17 }, (_, i) => ajouterJours(aujourdhui, i - 3));
  const comptes = new Map(prod.reseaux.map((r) => [r.id, r]));
  const episodes = new Map(prod.episodes.map((e) => [e.id, e]));
  const series = new Map(prod.series.map((s) => [s.id, s]));
  const saisons = new Map(prod.saisons.map((s) => [s.id, s]));
  const espaces = new Map(prod.portee.espaces.map((e) => [e.id, e]));

  // Chaque publication est rangée au jour local de son propre espace.
  const parJour = new Map<string, typeof prod.publications>();
  for (const pub of prod.publications) {
    if (pub.statut === "annulee") continue;
    const compte = comptes.get(pub.reseau_connecte_id);
    if (!compte || (filtre !== "tous" && compte.reseau !== filtre)) continue;
    const f = espaces.get(compte.espace_id)?.fuseau ?? fuseau;
    const jour = cleJour(pub.publiee_le ?? pub.programmee_le, f);
    if (!jours.includes(jour)) continue;
    parJour.set(jour, [...(parJour.get(jour) ?? []), pub]);
  }

  return (
    <div className="pile pile--large">
      <header className="ligne ligne--entre ligne--bas">
        <div>
          <p className="surtitre">{prod.portee.courant?.nom ?? "Tous mes comptes"}</p>
          <h1 className="h1">Calendrier</h1>
        </div>
        <nav className="ligne ligne--serree" aria-label="Filtrer par réseau">
          {(["tous", ...RESEAUX] as const).map((r) => (
            <Link key={r} href={r === "tous" ? "/calendrier" : `/calendrier?reseau=${r}`} className="segment" aria-current={filtre === r ? "true" : undefined}>
              {r === "tous" ? "Tous" : NOMS_RESEAUX[r]}
            </Link>
          ))}
        </nav>
      </header>
      {jours.map((jour) => {
        const liste = (parJour.get(jour) ?? []).sort((a, b) => (a.publiee_le ?? a.programmee_le).localeCompare(b.publiee_le ?? b.programmee_le));
        const passe = jour < aujourdhui;
        const midi = new Date(`${jour}T12:00:00Z`);
        return (
          <section key={jour} aria-labelledby={`j-${jour}`} className={jour === aujourdhui ? "carte carte--accent" : "carte"} style={passe ? { opacity: 0.75 } : undefined}>
            <div className="ligne ligne--entre">
              <h2 id={`j-${jour}`} className="h3">
                {jour === aujourdhui ? "Aujourd’hui · " : ""}
                {jourCourt(midi, "UTC")}
              </h2>
              <span className="tres-petit doux">{liste.length ? `${liste.length} publication${liste.length > 1 ? "s" : ""}` : "rien"}</span>
            </div>
            <ul className="liste-nue">
              {liste.map((pub) => {
                const compte = comptes.get(pub.reseau_connecte_id);
                const ep = episodes.get(pub.episode_id);
                if (!compte || !ep) return null;
                const serie = series.get(ep.serie_id);
                const saison = saisons.get(ep.saison_id);
                const st = statutPublication(pub);
                const f = espaces.get(compte.espace_id)?.fuseau ?? fuseau;
                return (
                  <li key={pub.id} className="liste-ligne">
                    <span className="mono petit">{heure(pub.publiee_le ?? pub.programmee_le, f)}</span>
                    <BadgeReseau reseau={compte.reseau} />
                    <Link href={lienEpisode(ep, "publication")} className="lien-ligne petit">
                      <span className="gras">
                        {serie?.nom} · {codeEpisode(ep, saison)} {nomEpisode(ep, saison)}
                      </span>
                      <span className="tres-petit doux">
                        {compte.nom_compte} · {pub.langue.toUpperCase()} · {espaces.get(compte.espace_id)?.nom}
                      </span>
                    </Link>
                    <Puce ton={st.ton}>{st.texte}</Puce>
                    <span className="mono tres-petit">{pub.stats.vues !== undefined ? `${compact(pub.stats.vues)} vues` : ""}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
