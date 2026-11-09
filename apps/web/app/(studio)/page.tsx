// Accueil : chiffres clés, liste « À faire », générations en cours, publications, réseaux et séries.
import { NOMS_RESEAUX, RESEAUX, type Reseau } from "@studio-video-ia/core";
import type { Metadata } from "next";
import Link from "next/link";
import { RafraichissementDirect } from "@/components/RafraichissementDirect";
import { BadgeReseau, Jauge, Kpi, Pastille, Puce } from "@/components/ui/elements";
import { construireAFaire } from "@/lib/a-faire";
import { chargerProduction } from "@/lib/donnees";
import { chargerRevenus, chargerStatsComptes, chargerVideos } from "@/lib/donnees-stats";
import { codeEpisode, nomEpisode } from "@/lib/episodes";
import { fuseauReference } from "@/lib/espace-courant";
import { compact, dureeLisible, euros, jourHeure, jourLong } from "@/lib/format";
import { statutPublication } from "@/lib/libelles";
import { estPretAPublier, resumeSerie } from "@/lib/resumes";
import { abonnesEtVariation, agregerRevenus, decalerJour, texteParDevise, vuesSurPeriode } from "@/lib/statistiques";

export const metadata: Metadata = { title: "Accueil" };

/** Page d'accueil. */
export default async function PageAccueil() {
  const prod = await chargerProduction();
  const { portee } = prod;
  const fuseau = fuseauReference(portee);
  const maintenant = new Date();
  const il30j = maintenant.getTime() - 30 * 86_400_000;
  const aujourdhui = maintenant.toISOString().slice(0, 10);
  const moisCourant = aujourdhui.slice(0, 7);

  const series = new Map(prod.series.map((s) => [s.id, s]));
  const saisons = new Map(prod.saisons.map((s) => [s.id, s]));
  const episodes = new Map(prod.episodes.map((e) => [e.id, e]));
  const comptes = new Map(prod.reseaux.map((r) => [r.id, r]));
  const espaces = portee.courant ? [portee.courant] : portee.espaces;

  // Chiffres des comptes connectés : historique sur 31 jours, vidéos des 30 jours, revenus du mois.
  const idsComptes = prod.reseaux.map((r) => r.id);
  const [historique, videos30, revenus] = await Promise.all([
    chargerStatsComptes(idsComptes, decalerJour(aujourdhui, -31)),
    chargerVideos(idsComptes, { depuis: new Date(il30j).toISOString(), limite: 300 }),
    chargerRevenus(idsComptes, `${moisCourant}-01`),
  ]);

  const publiees30 = prod.publications.filter((p) => (p.statut === "publiee" || p.statut === "privee") && Date.parse(p.publiee_le ?? p.programmee_le) >= il30j);
  const aVenir = prod.publications.filter((p) => ["attend_rendu", "programmee", "envoi", "traitement"].includes(p.statut)).sort((a, b) => a.programmee_le.localeCompare(b.programmee_le));
  const recentes = prod.publications.filter((p) => p.statut === "publiee" || p.statut === "privee").sort((a, b) => (b.publiee_le ?? b.programmee_le).localeCompare(a.publiee_le ?? a.programmee_le));
  const prets = prod.episodes.filter((e) => estPretAPublier(e, prod.etats.get(e.id))).length;
  const depense = espaces.reduce((a, e) => a + (prod.depenses.get(e.id) ?? 0), 0);
  const plafond = espaces.reduce((a, e) => a + e.plafond_mensuel, 0);
  const aFaire = construireAFaire({ ...prod, espaces });
  const enCours = prod.taches.filter((t) => t.statut === "en_cours").length;
  const enFile = prod.taches.filter((t) => t.statut === "en_file").length;

  // Abonnés : somme de la dernière valeur de chaque compte, variation sur 7 jours.
  const parCompte = prod.reseaux.map((r) => ({ compte: r, ...abonnesEtVariation(historique.filter((h) => h.reseau_connecte_id === r.id), 7), vues30: vuesSurPeriode(historique.filter((h) => h.reseau_connecte_id === r.id), 30) }));
  const abonnes = parCompte.reduce((a, c) => a + (c.abonnes ?? 0), 0);
  const variation = parCompte.reduce((a, c) => a + (c.variation ?? 0), 0);
  const aDesAbonnes = parCompte.some((c) => c.abonnes !== null);
  const agregat = agregerRevenus(revenus, prod.reseaux, moisCourant);

  /** Ligne d'un réseau : abonnés, vues sur 30 jours, meilleure vidéo. */
  const ligneReseau = (reseau: Reseau) => {
    const ceux = parCompte.filter((c) => c.compte.reseau === reseau);
    const ids = new Set(ceux.map((c) => c.compte.id));
    const vids = videos30.filter((v) => ids.has(v.reseau_connecte_id));
    const meilleure = vids[0] ?? null;
    const vuesHist = ceux.some((c) => c.vues30 !== null) ? ceux.reduce((a, c) => a + (c.vues30 ?? 0), 0) : null;
    return { reseau, comptes: ceux.length, abonnes: ceux.some((c) => c.abonnes !== null) ? ceux.reduce((a, c) => a + (c.abonnes ?? 0), 0) : null, vues: vuesHist ?? vids.reduce((a, v) => a + v.vues, 0), meilleure };
  };
  const lignesReseaux = RESEAUX.map(ligneReseau).filter((l) => l.comptes > 0);

  /** Ligne d'une publication (prochaine ou dernière). */
  const lignePub = (p: (typeof prod.publications)[number], avecVues: boolean) => {
    const ep = episodes.get(p.episode_id);
    const compte = comptes.get(p.reseau_connecte_id);
    if (!ep || !compte) return null;
    const serie = series.get(ep.serie_id);
    const st = statutPublication(p);
    return (
      <li key={p.id} className="liste-ligne">
        {!avecVues ? <span className="mono tres-petit doux">{jourHeure(p.programmee_le, fuseau)}</span> : null}
        <BadgeReseau reseau={compte.reseau} />
        <Link href={`/episodes/${ep.id}?etape=publication`} className="lien-ligne petit">
          <span className="gras">
            {serie?.nom} · {codeEpisode(ep, saisons.get(ep.saison_id))}
          </span>
          <span className="tres-petit doux">
            {compte.nom_compte} · {p.langue.toUpperCase()}
            {avecVues ? ` · ${jourHeure(p.publiee_le ?? p.programmee_le, fuseau)}` : ""}
          </span>
        </Link>
        {avecVues ? <span className="mono petit">{p.stats.vues !== undefined ? `${compact(p.stats.vues)} vues` : "—"}</span> : <Puce ton={st.ton}>{st.texte}</Puce>}
      </li>
    );
  };

  return (
    <div className="pile pile--large">
      <RafraichissementDirect actif={enCours + enFile > 0} intervalleMs={5000} />
      <header className="ligne ligne--entre ligne--bas">
        <div>
          <p className="surtitre">{jourLong(maintenant, fuseau)}</p>
          <h1 className="h1">{portee.courant?.nom ?? "Tous mes comptes"}</h1>
        </div>
        <Link href="/calendrier" className="btn">
          Calendrier de publication
        </Link>
      </header>

      <section aria-label="Chiffres clés" className="grille-kpi">
        <Kpi libelle="Publications · 30 jours" valeur={String(publiees30.length)} detail={`${aVenir.length} programmées`} />
        <Kpi libelle="Vues · 30 jours" valeur={compact(publiees30.reduce((a, p) => a + (p.stats.vues ?? 0), 0))} detail="publications de l’app" />
        <Kpi libelle="Abonnés" valeur={aDesAbonnes ? compact(abonnes) : "—"} detail={aDesAbonnes ? `${variation >= 0 ? "+" : "−"}${compact(Math.abs(variation))} sur 7 jours` : "synchronise les statistiques"} />
        <Kpi libelle="Revenus du mois" valeur={texteParDevise(agregat.moisCourant)} detail="YouTube et saisies manuelles" />
        <Kpi libelle="Générations" valeur={String(enCours)} detail={`${enFile} en file`} />
        <Kpi libelle="Prêts à publier" valeur={String(prets)} detail="épisodes rendus" />
        <Kpi libelle="Budget du mois" valeur={euros(depense)} detail={`sur ${euros(plafond)}`}>
          <p className="tres-petit" style={{ marginTop: 8 }}>
            <Jauge pourcentage={plafond ? (100 * depense) / plafond : 0} ton={plafond && depense >= plafond * 0.8 ? "attention" : "succes"} libelle="Budget du mois utilisé" />
          </p>
        </Kpi>
      </section>

      {lignesReseaux.length ? (
        <section aria-labelledby="reseaux-h" className="carte">
          <div className="ligne ligne--entre">
            <h2 id="reseaux-h" className="h2">
              Réseaux
            </h2>
            <Link href="/statistiques" className="btn btn--discret">
              Statistiques
            </Link>
          </div>
          <ul className="liste-nue">
            {lignesReseaux.map((l) => (
              <li key={l.reseau} className="liste-ligne">
                <BadgeReseau reseau={l.reseau} />
                <span className="petit gras" style={{ flex: "0 0 90px" }}>
                  {NOMS_RESEAUX[l.reseau]}
                </span>
                <span className="petit">
                  <span className="mono">{l.abonnes !== null ? compact(l.abonnes) : "—"}</span> <span className="doux">abonnés</span>
                </span>
                <span className="petit">
                  <span className="mono">{compact(l.vues)}</span> <span className="doux">vues sur 30 jours</span>
                </span>
                <span className="petit extensible">
                  {l.meilleure ? (
                    <>
                      <span className="doux">Meilleure vidéo : </span>
                      {l.meilleure.url ? (
                        <a href={l.meilleure.url} target="_blank" rel="noopener noreferrer">
                          {l.meilleure.titre || "sans titre"}
                        </a>
                      ) : (
                        l.meilleure.titre || "sans titre"
                      )}{" "}
                      <span className="mono doux">({compact(l.meilleure.vues)} vues)</span>
                    </>
                  ) : (
                    <span className="doux">Aucune vidéo sur 30 jours</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="colonnes">
        <section aria-labelledby="afaire-h" className="carte principale">
          <div className="ligne ligne--entre">
            <h2 id="afaire-h" className="h2">
              À faire
            </h2>
            <span className="tres-petit doux">{aFaire.length > 8 ? `8 sur ${aFaire.length}` : `${aFaire.length} action${aFaire.length > 1 ? "s" : ""}`}</span>
          </div>
          {aFaire.length === 0 ? <p className="petit doux" style={{ marginTop: 14 }}>Tout est à jour.</p> : null}
          <ul className="liste-nue">
            {aFaire.slice(0, 8).map((x) => (
              <li key={x.cle} className="liste-ligne">
                <Pastille ton={x.ton} />
                <div className="extensible">
                  <p className="petit gras">{x.titre}</p>
                  <p className="tres-petit doux">{x.detail}</p>
                </div>
                <Link href={x.lien} className="btn">
                  {x.action}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="gen-h" className="carte">
          <h2 id="gen-h" className="h2">
            En génération
          </h2>
          {prod.taches.length === 0 ? <p className="petit doux" style={{ marginTop: 14 }}>Rien en cours.</p> : null}
          <ul className="liste-nue">
            {prod.taches.map((t) => {
              const ep = t.episode_id ? episodes.get(t.episode_id) : undefined;
              const serie = ep ? series.get(ep.serie_id) : undefined;
              const etat = ep ? prod.etats.get(ep.id) : undefined;
              const fait = t.progression.fait ?? 0;
              const total = t.progression.total ?? 0;
              const contenu = (
                <>
                  <span className="ligne ligne--entre">
                    <span className="petit gras">{ep && serie ? `${serie.nom} · ${codeEpisode(ep, saisons.get(ep.saison_id))}` : "Tâche du compte"}</span>
                    <Puce ton={t.statut === "en_cours" ? "info" : t.statut === "en_pause" ? "erreur" : "attention"}>{etat?.statut ?? (t.statut === "en_cours" ? "En cours" : "En file")}</Puce>
                  </span>
                  <span className="tres-petit doux">{t.statut === "en_pause" ? "En pause : plafond du mois atteint" : (t.progression.etape ?? (t.statut === "en_file" ? "Attend une place libre" : "Démarrage…"))}</span>
                  <Jauge pourcentage={total ? (100 * fait) / total : 0} ton="info" />
                  <span className="ligne ligne--entre tres-petit doux">
                    <span>{total ? `${fait}/${total}` : ""}</span>
                    <span className="mono">{t.progression.secondes ? dureeLisible(t.progression.secondes) : ""}</span>
                  </span>
                </>
              );
              return (
                <li key={t.id} className="liste-ligne">
                  {ep ? (
                    <Link href={`/episodes/${ep.id}`} className="lien-ligne pile--serree" style={{ display: "flex", gap: 8 }}>
                      {contenu}
                    </Link>
                  ) : (
                    <div className="extensible pile--serree" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {contenu}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="colonnes">
        <section aria-labelledby="proch-h" className="carte">
          <div className="ligne ligne--entre">
            <h2 id="proch-h" className="h2">
              Prochaines publications
            </h2>
            <Link href="/calendrier" className="btn btn--discret">
              Tout voir
            </Link>
          </div>
          {aVenir.length === 0 ? <p className="petit doux" style={{ marginTop: 10 }}>Rien de programmé.</p> : null}
          <ul className="liste-nue">{aVenir.slice(0, 5).map((p) => lignePub(p, false))}</ul>
        </section>
        <section aria-labelledby="dern-h" className="carte">
          <div className="ligne ligne--entre">
            <h2 id="dern-h" className="h2">
              Dernières publications
            </h2>
            <Link href="/statistiques" className="btn btn--discret">
              Statistiques
            </Link>
          </div>
          {recentes.length === 0 ? <p className="petit doux" style={{ marginTop: 10 }}>Aucune publication pour l’instant.</p> : null}
          <ul className="liste-nue">{recentes.slice(0, 6).map((p) => lignePub(p, true))}</ul>
        </section>
      </div>

      <section aria-labelledby="series-h" className="carte">
        <div className="ligne ligne--entre">
          <h2 id="series-h" className="h2">
            Séries
          </h2>
          <Link href="/series" className="btn btn--discret">
            Toutes les séries
          </Link>
        </div>
        {prod.series.length === 0 ? (
          <div className="ligne" style={{ paddingTop: 14 }}>
            <p className="petit doux">Ce compte n’a pas encore de série.</p>
            <Link href="/series?nouvelle=1" className="btn btn--principal">
              Créer une série
            </Link>
          </div>
        ) : null}
        <ul className="liste-nue">
          {prod.series.map((s) => {
            const r = resumeSerie(s, prod);
            const prochaineEp = r.prochaine ? episodes.get(r.prochaine.episode_id) : undefined;
            return (
              <li key={s.id} className="liste-ligne">
                <Link href={`/series/${s.id}`} className="lien-ligne">
                  <span className="gras">{s.nom}</span>
                  <span className="tres-petit doux">
                    {r.saisons} saison{r.saisons > 1 ? "s" : ""} · {r.total} épisode{r.total > 1 ? "s" : ""}
                  </span>
                </Link>
                <div className="extensible">
                  <Jauge pourcentage={r.pourcentage} libelle={`Avancement de ${s.nom}`} />
                  <p className="tres-petit doux" style={{ marginTop: 6 }}>
                    {r.pourcentage} % · {r.publies} publiés sur {r.total}
                  </p>
                </div>
                <span className="tres-petit doux extensible">
                  {r.prochaine && prochaineEp ? `Prochaine sortie : ${jourHeure(r.prochaine.programmee_le, fuseau)} · ${codeEpisode(prochaineEp, saisons.get(prochaineEp.saison_id))} ${nomEpisode(prochaineEp, saisons.get(prochaineEp.saison_id))}` : "Aucune sortie programmée"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
