// Statistiques : vue d'ensemble et un onglet par réseau, filtre par compte, abonnés, vidéos, revenus.
import { NOMS_LANGUES, NOMS_RESEAUX, RESEAUX, type Langue, type Reseau, type StatsCompte } from "@feuilleton/core";
import type { Metadata } from "next";
import Link from "next/link";
import { synchroniserStats } from "@/app/actions/statistiques";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Courbe } from "@/components/ui/Courbe";
import { BadgeReseau, Jauge, Kpi, Puce } from "@/components/ui/elements";
import { chargerProduction } from "@/lib/donnees";
import { chargerRevenus, chargerStatsComptes, chargerVideos } from "@/lib/donnees-stats";
import { codeEpisode, nomEpisode } from "@/lib/episodes";
import { fuseauReference } from "@/lib/espace-courant";
import { compact, ilYa, pourcent } from "@/lib/format";
import { statutCompte } from "@/lib/libelles";
import { id as schemaId, parametre, schemaOngletStats, schemaPeriode } from "@/lib/schemas";
import { abonnesEtVariation, decalerJour, douzeDerniersMois, engagement, schemaSens, schemaTriVideos } from "@/lib/statistiques";
import { SectionRevenus } from "./SectionRevenus";
import styles from "./statistiques.module.scss";
import { TableauVideos } from "./TableauVideos";

export const metadata: Metadata = { title: "Statistiques" };

/** Barres horizontales « libellé · valeur ». */
function Barres({ titre, lignes }: { titre: string; lignes: { cle: string; libelle: string; valeur: number }[] }) {
  const max = Math.max(1, ...lignes.map((l) => l.valeur));
  return (
    <section aria-label={titre} className="carte">
      <h2 className="h2">{titre}</h2>
      {lignes.length === 0 ? <p className="petit doux marge-haut">Pas encore de chiffres.</p> : null}
      {lignes.map((l) => (
        <div key={l.cle} className={styles.barre}>
          <div className="ligne ligne--entre petit">
            <span>{l.libelle}</span>
            <span className="mono">{compact(l.valeur)}</span>
          </div>
          <Jauge pourcentage={(100 * l.valeur) / max} ton="info" epaisse libelle={`${l.libelle} : ${l.valeur}`} />
        </div>
      ))}
    </section>
  );
}

/** Dernière valeur non nulle d'un champ de l'historique. */
function derniere(h: readonly StatsCompte[], champ: "vues_total" | "jaime_total" | "videos"): number | null {
  for (let i = h.length - 1; i >= 0; i--) {
    const v = h[i]?.[champ];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/** Page Statistiques. */
export default async function PageStatistiques({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const onglet = schemaOngletStats.parse(parametre(p.onglet));
  const periode = schemaPeriode.parse(parametre(p.periode));
  const tri = schemaTriVideos.parse(parametre(p.tri));
  const sens = schemaSens.parse(parametre(p.sens));
  const prod = await chargerProduction();
  const fuseau = fuseauReference(prod.portee);
  const reseau: Reseau | null = onglet === "ensemble" ? null : onglet;
  const tousComptes = prod.reseaux.filter((c) => !reseau || c.reseau === reseau);
  const choixCompte = schemaId.safeParse(parametre(p.compte));
  const compte = choixCompte.success ? tousComptes.find((c) => c.id === choixCompte.data) : undefined;
  const comptes = compte ? [compte] : tousComptes;
  const ids = comptes.map((c) => c.id);
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const moisCourant = aujourdhui.slice(0, 7);
  const [historique, videos, revenus] = await Promise.all([
    chargerStatsComptes(ids, decalerJour(aujourdhui, -31)),
    reseau ? chargerVideos(ids) : chargerVideos(ids, { limite: 500 }),
    chargerRevenus(ids, `${douzeDerniersMois(moisCourant)[0]}-01`),
  ]);

  // Publications faites par l'app sur la période choisie.
  const depuis = periode === "tout" ? 0 : Date.now() - Number(periode) * 86_400_000;
  const idsComptes = new Set(ids);
  const pubs = prod.publications.filter((x) => (x.statut === "publiee" || x.statut === "privee") && idsComptes.has(x.reseau_connecte_id) && Date.parse(x.publiee_le ?? x.programmee_le) >= depuis);
  const somme = (champ: "vues" | "jaime" | "commentaires" | "partages") => pubs.reduce((a, x) => a + (x.stats[champ] ?? 0), 0);
  const totaux = { vues: somme("vues"), jaime: somme("jaime"), commentaires: somme("commentaires"), partages: somme("partages") };
  const comptesParId = new Map(prod.reseaux.map((c) => [c.id, c]));
  const parReseau = RESEAUX.map((r) => ({ cle: r, libelle: NOMS_RESEAUX[r], valeur: pubs.filter((x) => comptesParId.get(x.reseau_connecte_id)?.reseau === r).reduce((a, x) => a + (x.stats.vues ?? 0), 0) })).filter((l) => !reseau || l.cle === reseau);
  const langues = [...new Set(pubs.map((x) => x.langue))] as Langue[];
  const parLangue = langues.map((l) => ({ cle: l, libelle: NOMS_LANGUES[l], valeur: pubs.filter((x) => x.langue === l).reduce((a, x) => a + (x.stats.vues ?? 0), 0) })).sort((a, b) => b.valeur - a.valeur);
  const episodes = new Map(prod.episodes.map((e) => [e.id, e]));
  const series = new Map(prod.series.map((s) => [s.id, s]));
  const saisons = new Map(prod.saisons.map((s) => [s.id, s]));
  const parEpisode = [...new Set(pubs.map((x) => x.episode_id))]
    .map((id) => {
      const liste = pubs.filter((x) => x.episode_id === id);
      const s = { vues: liste.reduce((a, x) => a + (x.stats.vues ?? 0), 0), jaime: liste.reduce((a, x) => a + (x.stats.jaime ?? 0), 0), commentaires: liste.reduce((a, x) => a + (x.stats.commentaires ?? 0), 0), partages: liste.reduce((a, x) => a + (x.stats.partages ?? 0), 0) };
      return { id, nb: liste.length, ...s };
    })
    .sort((a, b) => b.vues - a.vues);

  // Dernière synchronisation connue : publications, vidéos ou historique des comptes.
  const dates = [...pubs.map((x) => x.stats_le), ...videos.map((v) => v.maj_le), ...historique.map((h) => h.jour)].filter((x): x is string => !!x).sort();
  const derniereSynchro = dates.at(-1);
  const enCours = prod.taches.some((t) => t.type === "stats");
  const parCompte = comptes.map((c) => {
    const h = historique.filter((x) => x.reseau_connecte_id === c.id).sort((a, b) => a.jour.localeCompare(b.jour));
    return { compte: c, h, ...abonnesEtVariation(h, 7), vues: derniere(h, "vues_total"), jaime: derniere(h, "jaime_total"), nbVideos: derniere(h, "videos") ?? videos.filter((v) => v.reseau_connecte_id === c.id).length };
  });
  const abonnes = parCompte.reduce((a, c) => a + (c.abonnes ?? 0), 0);

  /** URL de la page avec les paramètres courants modifiés. */
  const url = (changes: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const tout = { onglet, periode, compte: compte?.id, ...changes };
    for (const [k, v] of Object.entries(tout)) if (v && !(k === "onglet" && v === "ensemble") && !(k === "periode" && v === "30")) q.set(k, v);
    return `/statistiques?${q.toString()}`;
  };

  return (
    <div className="pile pile--large">
      <header className="ligne ligne--entre ligne--bas">
        <div>
          <p className="surtitre">{prod.portee.courant?.nom ?? "Tous mes comptes"}</p>
          <h1 className="h1">Statistiques</h1>
          <p className="tres-petit doux marge-haut">{enCours ? "Synchronisation en cours…" : derniereSynchro ? `Dernière synchronisation : ${ilYa(derniereSynchro)}` : "Jamais synchronisé."}</p>
        </div>
        <div className="ligne">
          <nav className="ligne ligne--serree" aria-label="Période">
            {(["7", "30", "tout"] as const).map((x) => (
              <Link key={x} href={url({ periode: x })} className="segment" aria-current={periode === x ? "true" : undefined}>
                {x === "tout" ? "Tout" : `${x} j`}
              </Link>
            ))}
          </nav>
          <form action={synchroniserStats}>
            <input type="hidden" name="reseau_connecte_id" value={compte?.id ?? ""} />
            <BoutonEnvoi desactive={enCours}>Synchroniser maintenant</BoutonEnvoi>
          </form>
        </div>
      </header>

      <nav className="onglets" aria-label="Réseaux">
        {(["ensemble", ...RESEAUX] as const).map((o) => (
          <Link key={o} href={url({ onglet: o, compte: undefined })} className="onglet" aria-current={onglet === o ? "page" : undefined}>
            {o === "ensemble" ? "Vue d’ensemble" : NOMS_RESEAUX[o]}
          </Link>
        ))}
      </nav>

      {tousComptes.length > 1 ? (
        <form method="get" action="/statistiques" className="ligne ligne--bas">
          {onglet !== "ensemble" ? <input type="hidden" name="onglet" value={onglet} /> : null}
          <input type="hidden" name="periode" value={periode} />
          <div className="champ" style={{ maxWidth: 360 }}>
            <label className="etiquette" htmlFor="f-compte">
              Compte
            </label>
            <select id="f-compte" name="compte" defaultValue={compte?.id ?? ""}>
              <option value="">Tous les comptes{reseau ? ` ${NOMS_RESEAUX[reseau]}` : ""}</option>
              {tousComptes.map((c) => (
                <option key={c.id} value={c.id}>
                  {NOMS_RESEAUX[c.reseau]} · {c.nom_compte}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn">
            Afficher
          </button>
        </form>
      ) : null}

      <section aria-label="Chiffres clés" className="grille-kpi">
        <Kpi libelle="Abonnés" valeur={parCompte.some((c) => c.abonnes !== null) ? compact(abonnes) : "—"} detail="dernière valeur par compte" />
        <Kpi libelle="Vues" valeur={compact(totaux.vues)} detail="publications de l’app" />
        <Kpi libelle="J’aime" valeur={compact(totaux.jaime)} />
        <Kpi libelle="Commentaires" valeur={compact(totaux.commentaires)} />
        <Kpi libelle="Partages" valeur={compact(totaux.partages)} />
        <Kpi libelle="Engagement" valeur={pourcent(engagement(totaux))} detail="(j’aime + commentaires + partages) / vues" />
      </section>

      {comptes.length === 0 ? (
        <p className="carte vide petit doux">
          Aucun compte {reseau ? NOMS_RESEAUX[reseau] : ""} connecté. <Link href="/reglages?onglet=comptes">Connecter un réseau</Link>
        </p>
      ) : (
        <div className="grille-cartes">
          {parCompte.map((c) => {
            const st = statutCompte(c.compte);
            const courbe = c.h.filter((x) => x.abonnes !== null).map((x) => x.abonnes ?? 0);
            return (
              <article key={c.compte.id} className="carte pile pile--serree">
                <div className="ligne ligne--entre">
                  <span className="ligne ligne--serree">
                    <BadgeReseau reseau={c.compte.reseau} />
                    <span className="gras">{c.compte.nom_compte}</span>
                  </span>
                  <Puce ton={st.ton}>{st.texte}</Puce>
                </div>
                <p>
                  <span className="mono" style={{ fontSize: 24 }}>
                    {c.abonnes !== null ? compact(c.abonnes) : "—"}
                  </span>{" "}
                  <span className="petit doux">abonnés</span>{" "}
                  {c.variation !== null ? (
                    <span className={`tres-petit mono ${c.variation >= 0 ? "texte-succes" : "texte-erreur"}`}>
                      {c.variation >= 0 ? "+" : "−"}
                      {compact(Math.abs(c.variation))} sur 7 j
                    </span>
                  ) : null}
                </p>
                <Courbe valeurs={courbe} libelle={`Abonnés de ${c.compte.nom_compte} sur 30 jours, de ${compact(courbe[0] ?? 0)} à ${compact(courbe.at(-1) ?? 0)}`} />
                <dl className="trio">
                  <div>
                    <dt className="etiquette">Vues totales</dt>
                    <dd className="mono">{c.vues !== null ? compact(c.vues) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="etiquette">J’aime</dt>
                    <dd className="mono">{c.jaime !== null ? compact(c.jaime) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="etiquette">Vidéos</dt>
                    <dd className="mono">{compact(c.nbVideos)}</dd>
                  </div>
                </dl>
                <div className="ligne">
                  {reseau ? null : (
                    <Link href={url({ onglet: c.compte.reseau, compte: c.compte.id })} className="btn btn--discret">
                      Détails
                    </Link>
                  )}
                  <form action={synchroniserStats}>
                    <input type="hidden" name="reseau_connecte_id" value={c.compte.id} />
                    <BoutonEnvoi variante="discret" desactive={enCours}>
                      Synchroniser
                    </BoutonEnvoi>
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!reseau ? (
        <div className="colonnes">
          <Barres titre="Vues par réseau" lignes={parReseau} />
          <Barres titre="Vues par langue" lignes={parLangue} />
        </div>
      ) : null}

      {reseau ? <TableauVideos videos={videos} comptes={comptes} tri={tri} sens={sens} base={url({})} fuseau={fuseau} /> : null}

      <SectionRevenus comptes={comptes} revenus={revenus} moisCourant={moisCourant} reseau={reseau} />

      <section aria-labelledby="eps-h" className="carte">
        <h2 id="eps-h" className="h2">
          Épisodes publiés par l’app
        </h2>
        {parEpisode.length === 0 ? (
          <p className="petit doux marge-haut">Aucune publication sur la période.</p>
        ) : (
          <div className="defilement-x">
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">Épisode</th>
                  <th scope="col" className="nombre">
                    Vues
                  </th>
                  <th scope="col" className="nombre">
                    J’aime
                  </th>
                  <th scope="col" className="nombre">
                    Comment.
                  </th>
                  <th scope="col" className="nombre">
                    Engagement
                  </th>
                </tr>
              </thead>
              <tbody>
                {parEpisode.map((x) => {
                  const ep = episodes.get(x.id);
                  if (!ep) return null;
                  const saison = saisons.get(ep.saison_id);
                  return (
                    <tr key={x.id}>
                      <td>
                        <Link href={`/episodes/${ep.id}?etape=publication`} className="petit">
                          {series.get(ep.serie_id)?.nom} · {codeEpisode(ep, saison)} {nomEpisode(ep, saison)}
                        </Link>
                        <br />
                        <span className="tres-petit doux">
                          {x.nb} publication{x.nb > 1 ? "s" : ""}
                        </span>
                      </td>
                      <td className="nombre">{compact(x.vues)}</td>
                      <td className="nombre">{compact(x.jaime)}</td>
                      <td className="nombre">{compact(x.commentaires)}</td>
                      <td className="nombre">{pourcent(engagement(x))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
