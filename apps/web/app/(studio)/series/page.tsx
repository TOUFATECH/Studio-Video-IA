// Liste des séries de la portée choisie, et formulaire de création.
import type { Metadata } from "next";
import Link from "next/link";
import { creerSerie, ecrireSuite } from "@/app/actions/series";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Jauge, PastilleEspace } from "@/components/ui/elements";
import { chargerProduction } from "@/lib/donnees";
import { codeEpisode } from "@/lib/episodes";
import { fuseauReference } from "@/lib/espace-courant";
import { compact, jourHeure } from "@/lib/format";
import { OPTIONS_LANGUES } from "@/lib/libelles";
import { resumeSerie } from "@/lib/resumes";
import { parametre, STYLES_VISUELS } from "@/lib/schemas";

export const metadata: Metadata = { title: "Séries" };

/** Page « Séries ». */
export default async function PageSeries({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const prod = await chargerProduction();
  const { portee } = prod;
  const fuseau = fuseauReference(portee);
  const creation = parametre(p.nouvelle) === "1";
  const espaces = new Map(portee.espaces.map((e) => [e.id, e]));
  const saisons = new Map(prod.saisons.map((s) => [s.id, s]));
  const episodes = new Map(prod.episodes.map((e) => [e.id, e]));
  // L'espace Clips a sa propre page : seules les séries d'histoires sont listées ici.
  const series = prod.series.filter((s) => s.genre === "serie");

  return (
    <div className="pile pile--large">
      <header className="ligne ligne--entre ligne--bas">
        <div>
          <p className="surtitre">{portee.courant?.nom ?? "Tous mes comptes"}</p>
          <h1 className="h1">Séries</h1>
        </div>
        {!creation ? (
          <Link href="/series?nouvelle=1" className="btn btn--principal">
            Nouvelle série
          </Link>
        ) : null}
      </header>

      {creation ? (
        <section aria-labelledby="ns-h" className="carte carte--accent">
          <form action={creerSerie} className="pile">
            <h2 id="ns-h" className="h2">
              Nouvelle série
            </h2>
            <div className="ligne ligne--bas">
              <div className="champ champ--large">
                <label className="etiquette" htmlFor="ns-nom">
                  Nom
                </label>
                <input id="ns-nom" name="nom" type="text" required maxLength={120} placeholder="Ex. : Les gardiens du phare" />
              </div>
              <div className="champ">
                <label className="etiquette" htmlFor="ns-espace">
                  Compte
                </label>
                <select id="ns-espace" name="espace_id" defaultValue={portee.courant?.id ?? portee.espaces[0]?.id}>
                  {portee.espaces.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nom}
                    </option>
                  ))}
                </select>
              </div>
              <div className="champ">
                <label className="etiquette" htmlFor="ns-style">
                  Style visuel
                </label>
                <select id="ns-style" name="style_visuel" defaultValue="Cinématique">
                  {STYLES_VISUELS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="champ">
                <label className="etiquette" htmlFor="ns-langue">
                  Langue d’origine
                </label>
                <select id="ns-langue" name="langue" defaultValue="fr">
                  {OPTIONS_LANGUES.map((l) => (
                    <option key={l.valeur} value={l.valeur}>
                      {l.libelle}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="ligne">
              <BoutonEnvoi variante="principal" enCours="Création…">
                Créer et ouvrir la bible
              </BoutonEnvoi>
              <Link href="/series" className="btn btn--discret">
                Annuler
              </Link>
            </div>
          </form>
        </section>
      ) : null}

      {series.length === 0 && !creation ? (
        <div className="carte vide">
          <p className="h2">Aucune série sur ce compte</p>
          <p className="petit doux">Une série regroupe une histoire, ses personnages, ses saisons et ses épisodes. Tu peux en avoir plusieurs par compte.</p>
          <Link href="/series?nouvelle=1" className="btn btn--principal">
            Créer une série
          </Link>
        </div>
      ) : null}

      <div className="grille-cartes">
        {series.map((s) => {
          const r = resumeSerie(s, prod);
          const espace = espaces.get(s.espace_id);
          const prochaineEp = r.prochaine ? episodes.get(r.prochaine.episode_id) : undefined;
          return (
            <article key={s.id} className="carte pile">
              <div className="ligne ligne--entre ligne--haut">
                <div>
                  <h2 className="h2">{s.nom}</h2>
                  <p className="tres-petit doux">
                    {r.saisons} saison{r.saisons > 1 ? "s" : ""} · {r.total} épisode{r.total > 1 ? "s" : ""} · {s.style_visuel}
                  </p>
                </div>
                {espace ? (
                  <span className="puce">
                    <PastilleEspace couleur={espace.couleur} />
                    &nbsp;{espace.nom}
                  </span>
                ) : null}
              </div>
              <div>
                <Jauge pourcentage={r.pourcentage} libelle={`Avancement de ${s.nom}`} />
                <p className="tres-petit doux" style={{ marginTop: 6 }}>
                  {r.pourcentage} % · {r.publies} publiés sur {r.total}
                </p>
              </div>
              <dl className="trio">
                <div>
                  <dt className="etiquette">Publiés</dt>
                  <dd className="mono">{r.publies}</dd>
                </div>
                <div>
                  <dt className="etiquette">Vues</dt>
                  <dd className="mono">{compact(r.vues)}</dd>
                </div>
                <div>
                  <dt className="etiquette">Langues</dt>
                  <dd className="mono petit">{r.langues.map((l) => l.toUpperCase()).join(" ") || "—"}</dd>
                </div>
              </dl>
              <p className="tres-petit doux">{r.prochaine && prochaineEp ? `Prochaine sortie : ${jourHeure(r.prochaine.programmee_le, fuseau)} · ${codeEpisode(prochaineEp, saisons.get(prochaineEp.saison_id))}` : "Aucune sortie programmée"}</p>
              <div className="ligne">
                <Link href={`/series/${s.id}`} className="btn btn--principal">
                  Ouvrir
                </Link>
                <Link href={`/series/${s.id}?onglet=bible`} className="btn">
                  Bible
                </Link>
                <form action={ecrireSuite}>
                  <input type="hidden" name="serie_id" value={s.id} />
                  <BoutonEnvoi variante="discret">Écrire la suite</BoutonEnvoi>
                </form>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
