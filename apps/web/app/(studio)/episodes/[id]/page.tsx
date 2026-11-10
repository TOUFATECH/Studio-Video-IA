// Page d'un épisode en 5 étapes : scénario, storyboard, clips et voix, montage, publication.
import { formaterDuree, DUREE_GENERIQUES, NOMS_FORMATS_CLIP } from "@studio-video-ia/core";
import type { Metadata } from "next";
import Link from "next/link";
import { decouperClip, synchroniserParoles } from "@/app/actions/clips";
import { genererImages, lancerClips, lancerRendu } from "@/app/actions/episodes";
import { ecrireSuite } from "@/app/actions/series";
import { RafraichissementDirect } from "@/components/RafraichissementDirect";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Puce } from "@/components/ui/elements";
import { codeEpisode, lienEpisode, nomEpisode } from "@/lib/episodes";
import { euros } from "@/lib/format";
import { languesCourtes } from "@/lib/libelles";
import { parametre, schemaEtape } from "@/lib/schemas";
import { chargerEpisode, type DonneesEpisode } from "./chargement";
import { EtapeClips } from "./EtapeClips";
import { EtapeDecoupage } from "./EtapeDecoupage";
import { EtapeMontage } from "./EtapeMontage";
import { EtapePublication } from "./EtapePublication";
import { EtapeScenario } from "./EtapeScenario";
import { EtapeSon } from "./EtapeSon";
import { EtapeStoryboard } from "./EtapeStoryboard";
import { MemoriserEpisode } from "./MemoriserEpisode";
import styles from "./episode.module.scss";

export const metadata: Metadata = { title: "Épisode" };

/** Durée totale calculée de l'épisode (génériques compris pour un film). */
function dureeCalculee(d: DonneesEpisode): number {
  let total = 0;
  for (const v of d.durees.values()) total += v;
  return total + (d.episode.format === "long" && d.episode.genre === "episode" ? DUREE_GENERIQUES : 0);
}

/** Bouton de l'action suivante : un formulaire quand l'action lance une tâche, un lien sinon. */
function ActionSuivante({ d }: { d: DonneesEpisode }) {
  const { etat, episode, serie } = d;
  const champ = <input type="hidden" name="episode_id" value={episode.id} />;
  if (etat.action === "Générer le storyboard")
    return (
      <form action={genererImages}>
        {champ}
        <BoutonEnvoi variante="principal">Générer le storyboard</BoutonEnvoi>
      </form>
    );
  if (etat.action === "Lancer les clips")
    return (
      <form action={lancerClips}>
        {champ}
        <BoutonEnvoi variante="principal">Lancer les clips</BoutonEnvoi>
      </form>
    );
  if (etat.action === "Lancer le rendu")
    return (
      <form action={lancerRendu}>
        {champ}
        <BoutonEnvoi variante="principal">Lancer le rendu</BoutonEnvoi>
      </form>
    );
  if (etat.action === "Synchroniser les paroles")
    return (
      <form action={synchroniserParoles}>
        {champ}
        <BoutonEnvoi variante="principal">Synchroniser les paroles</BoutonEnvoi>
      </form>
    );
  if (etat.action === "Découper le clip")
    return (
      <form action={decouperClip}>
        {champ}
        <BoutonEnvoi variante="principal">Découper le clip</BoutonEnvoi>
      </form>
    );
  if (etat.action === "Nouveau clip")
    return (
      <Link href="/clips?nouveau=1" className="btn btn--principal">
        Nouveau clip
      </Link>
    );
  if (etat.action === "Écrire la suite" && episode.genre === "episode")
    return (
      <form action={ecrireSuite}>
        <input type="hidden" name="serie_id" value={serie.id} />
        <BoutonEnvoi variante="principal">Écrire la suite</BoutonEnvoi>
      </form>
    );
  const lien = etat.action === "Voir le budget" ? "/reglages?onglet=budget" : lienEpisode(episode, etat.etape);
  return (
    <Link href={lien} className="btn btn--principal">
      {etat.action}
    </Link>
  );
}

/** Page de l'épisode. */
export default async function PageEpisode({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const p = await searchParams;
  const d = await chargerEpisode(id);
  const { episode, etat, saison } = d;
  const choix = schemaEtape.safeParse(parametre(p.etape));
  // L'étape « son » n'existe que pour un clip.
  const etape = choix.success && (choix.data !== "son" || episode.genre === "clip") ? choix.data : etat.etape;
  const n = d.plans.length;
  const total = dureeCalculee(d);
  const sbFini = n > 0 && etat.storyboard.fait === etat.storyboard.total;
  const clip = episode.genre === "clip";
  const chanson = d.fichiers.some((f) => f.genre === "chanson" && f.statut === "pret");
  const etapesEpisode = [
    { cle: "scenario", libelle: "Scénario", detail: n ? `${n} plans · ${formaterDuree(total)}` : "à écrire", fait: n > 0 },
    { cle: "storyboard", libelle: "Storyboard", detail: n ? `${etat.valides}/${n} validés` : "—", fait: sbFini && etat.valides === n },
    { cle: "clips", libelle: "Clips et voix", detail: etat.clips.total ? `${etat.clips.fait}/${etat.clips.total}${etat.clips.echec ? ` · ${etat.clips.echec} échec${etat.clips.echec > 1 ? "s" : ""}` : ""}` : "—", fait: etat.clips.total > 0 && etat.clips.fait === etat.clips.total },
    { cle: "montage", libelle: "Montage", detail: etat.rendus.total && n ? `${etat.rendus.fait}/${etat.rendus.total} rendus` : "—", fait: n > 0 && etat.rendus.fait === etat.rendus.total },
    { cle: "publication", libelle: "Publication", detail: etat.publiees ? `${etat.publiees} en ligne` : etat.programmees ? `${etat.programmees} programmées` : "—", fait: etat.publiees > 0 },
  ];
  // Un clip commence par le son et les paroles, et son « scénario » est le découpage sur la chanson.
  const etapes = clip
    ? [
        {
          cle: "son",
          libelle: "Son et paroles",
          detail: !chanson ? "chanson à ajouter" : episode.paroles_alignees === null ? "à synchroniser" : `${episode.paroles_alignees.length} lignes placées`,
          fait: chanson && episode.paroles_alignees !== null,
        },
        { cle: "scenario", libelle: "Découpage", detail: n ? `${n} plans · ${formaterDuree(total)}` : "à faire", fait: n > 0 },
        ...etapesEpisode.slice(1).map((e) => (e.cle === "clips" ? { ...e, libelle: "Vidéos" } : e)),
      ]
    : etapesEpisode;
  const actif = !!etat.tacheEnCours || d.publications.some((x) => x.statut === "envoi" || x.statut === "traitement");
  const formatTexte = clip
    ? `Clip · ${NOMS_FORMATS_CLIP[episode.format].split(" · ")[0]}${n ? ` · ${formaterDuree(total)}` : ""}`
    : episode.genre !== "episode" ? `Générique · ${formaterDuree(episode.duree_cible)}` : episode.format === "long"
        ? `Film ${formaterDuree(total)} · 16:9 + bande annonce verticale`
        : episode.format === "moyen"
          ? `Épisode YouTube ${formaterDuree(total)} · 16:9 + bande annonce verticale`
          : `Court ${formaterDuree(total)} · vertical 9:16`;

  return (
    <div className="pile pile--large">
      <MemoriserEpisode id={episode.id} />
      <RafraichissementDirect actif={actif} />
      <header className="ligne ligne--entre ligne--bas">
        <div>
          {clip ? (
            <nav aria-label="Fil d’Ariane" className="ligne ligne--serree tres-petit doux">
              <Link href="/clips" className="doux">
                Clips
              </Link>
              <span aria-hidden="true">/</span>
              <span>
                {d.serie.nom} · {codeEpisode(episode, saison)}
              </span>
            </nav>
          ) : (
            <nav aria-label="Fil d’Ariane" className="ligne ligne--serree tres-petit doux">
              <Link href="/series" className="doux">
                {d.espace.nom}
              </Link>
              <span aria-hidden="true">/</span>
              <Link href={`/series/${d.serie.id}`} className="doux">
                {d.serie.nom}
              </Link>
              <span aria-hidden="true">/</span>
              <span>
                Saison {saison?.numero ?? "?"} · {codeEpisode(episode, saison)}
              </span>
            </nav>
          )}
          <h1 className="h1">{nomEpisode(episode, saison)}</h1>
          <div className="ligne ligne--serree marge-haut">
            <Puce ton={etat.ton}>{etat.statut}</Puce>
            <span className="tres-petit doux">{formatTexte}</span>
            <span className="tres-petit mono doux">{languesCourtes(episode.langues)}</span>
            <span className="tres-petit mono doux">
              coût {euros(d.depense)} / ~{euros(d.estimation)}
            </span>
          </div>
        </div>
        <div className="ligne">
          {d.precedent ? (
            <Link href={`/episodes/${d.precedent.id}`} className="btn btn--discret">
              ← Précédent
            </Link>
          ) : null}
          {d.suivant ? (
            <Link href={`/episodes/${d.suivant.id}`} className="btn btn--discret">
              Suivant →
            </Link>
          ) : null}
          <ActionSuivante d={d} />
        </div>
      </header>

      <nav aria-label="Étapes de l’épisode" className={styles.etapes}>
        {etapes.map((e, i) => (
          <Link key={e.cle} href={lienEpisode(episode, e.cle)} className={styles.etape} aria-current={etape === e.cle ? "page" : undefined}>
            <span className="ligne ligne--serree ligne--sans-retour">
              <span className={`${styles.numero} ${e.fait ? styles.numeroFait : ""}`} aria-hidden="true">
                {e.fait ? "✓" : i + 1}
              </span>
              <span className="gras petit">{e.libelle}</span>
              {e.fait ? <span className="invisible">(terminé)</span> : null}
            </span>
            <span className="tres-petit doux">{e.detail}</span>
          </Link>
        ))}
      </nav>

      {etape === "son" && clip ? <EtapeSon d={d} /> : null}
      {etape === "scenario" && clip ? <EtapeDecoupage d={d} /> : null}
      {etape === "scenario" && !clip ? <EtapeScenario d={d} total={total} /> : null}
      {etape === "storyboard" ? <EtapeStoryboard d={d} /> : null}
      {etape === "clips" ? <EtapeClips d={d} /> : null}
      {etape === "montage" ? <EtapeMontage d={d} /> : null}
      {etape === "publication" ? <EtapePublication d={d} version={parametre(p.version)} /> : null}
    </div>
  );
}
