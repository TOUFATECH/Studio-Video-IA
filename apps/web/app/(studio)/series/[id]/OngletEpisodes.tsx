// Onglet « Épisodes » : une carte par saison avec ses épisodes, son opening et son ending.
import { NOMS_RESEAUX, type Episode } from "@feuilleton/core";
import Link from "next/link";
import { ajouterEpisode, ajouterSaison, ecrireSuite } from "@/app/actions/series";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Jauge, Pastille, Puce } from "@/components/ui/elements";
import { codeEpisode, nomEpisode } from "@/lib/episodes";
import type { DonneesSerie } from "./chargement";

/** Liste des saisons et des épisodes. */
export function OngletEpisodes({ d }: { d: DonneesSerie }) {
  const comptes = new Map(d.comptes.map((c) => [c.id, c]));
  /** Réseaux où l'épisode est en ligne : « TikTok · YouTube ». */
  const enLigne = (ep: Episode) =>
    [...new Set((d.pubsPar.get(ep.id) ?? []).filter((p) => p.statut === "publiee" || p.statut === "privee").map((p) => comptes.get(p.reseau_connecte_id)?.reseau).filter((r) => !!r))]
      .map((r) => (r ? NOMS_RESEAUX[r] : ""))
      .join(" · ");
  return (
    <div className="pile">
      {d.saisons.map((s) => {
        const eps = d.episodes.filter((e) => e.saison_id === s.id && e.genre === "episode").sort((a, b) => a.numero - b.numero);
        const generiques = [d.episodes.find((e) => e.id === s.opening_id), d.episodes.find((e) => e.id === s.ending_id)].filter((e): e is Episode => !!e);
        const publies = eps.filter((e) => (d.etats.get(e.id)?.publiees ?? 0) > 0).length;
        return (
          <section key={s.id} className="carte" aria-labelledby={`saison-${s.id}`}>
            <div className="ligne ligne--entre">
              <div className="ligne">
                <h2 id={`saison-${s.id}`} className="h2">
                  Saison {s.numero}
                </h2>
                <span className="tres-petit doux">
                  {eps.length} épisode{eps.length > 1 ? "s" : ""} · {publies} publié{publies > 1 ? "s" : ""}
                </span>
              </div>
              <div className="ligne ligne--serree">
                {generiques.map((g) => {
                  const etat = d.etats.get(g.id);
                  return (
                    <Link key={g.id} href={`/episodes/${g.id}`} className="btn btn--discret">
                      <Pastille ton={etat?.ton ?? "neutre"} />
                      {g.genre === "opening" ? "Opening" : "Ending"} · {etat?.statut ?? "—"}
                    </Link>
                  );
                })}
                <form action={ajouterEpisode}>
                  <input type="hidden" name="saison_id" value={s.id} />
                  <BoutonEnvoi>+ Épisode</BoutonEnvoi>
                </form>
              </div>
            </div>
            {eps.length === 0 ? <p className="petit doux marge-haut">Aucun épisode dans cette saison.</p> : null}
            <ul className="liste-nue">
              {eps.map((e) => {
                const etat = d.etats.get(e.id);
                const reseaux = enLigne(e);
                return (
                  <li key={e.id} className="liste-ligne">
                    <span className="mono petit doux">{codeEpisode(e, s)}</span>
                    <Link href={`/episodes/${e.id}`} className="lien-ligne">
                      <span className="gras">{nomEpisode(e, s)}</span>
                      <span className="tres-petit doux coupe-2">{e.idee || "Pas encore d’idée."}</span>
                    </Link>
                    {etat ? <Puce ton={etat.ton}>{etat.statut}</Puce> : null}
                    <div style={{ flex: "0 1 160px", minWidth: 100 }}>
                      <Jauge pourcentage={etat?.pourcentage ?? 0} libelle={`Avancement de ${nomEpisode(e, s)}`} />
                      <p className="tres-petit doux mono">{etat?.pourcentage ?? 0} %</p>
                    </div>
                    <span className="tres-petit doux">{reseaux || "—"}</span>
                    {etat?.action === "Écrire la suite" ? (
                      <form action={ecrireSuite}>
                        <input type="hidden" name="serie_id" value={d.serie.id} />
                        <BoutonEnvoi>Écrire la suite</BoutonEnvoi>
                      </form>
                    ) : (
                      <Link href={`/episodes/${e.id}?etape=${etat?.etape ?? "scenario"}`} className={`btn${etat && etat.ton !== "succes" && etat.ton !== "info" ? " btn--principal" : ""}`}>
                        {etat?.action ?? "Ouvrir"}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <form action={ajouterSaison}>
        <input type="hidden" name="serie_id" value={d.serie.id} />
        <BoutonEnvoi enCours="Création…">+ Nouvelle saison</BoutonEnvoi>
      </form>
    </div>
  );
}
