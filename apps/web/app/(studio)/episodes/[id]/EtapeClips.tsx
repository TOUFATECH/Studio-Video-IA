// Étape 3 : clips Grok et voix ElevenLabs. Progression, temps, coût, prises, lecture, échecs et pause.
import { NOMS_LANGUES, unitesClips } from "@studio-video-ia/core";
import Link from "next/link";
import { choisirPrise, choisirPrises, lancerClips, mettreEnPause } from "@/app/actions/episodes";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Jauge, Kpi } from "@/components/ui/elements";
import { lienEpisode } from "@/lib/episodes";
import { dureeLisible, euros } from "@/lib/format";
import type { DonneesEpisode } from "./chargement";
import styles from "./episode.module.scss";

/** Étape Clips et voix. */
export function EtapeClips({ d }: { d: DonneesEpisode }) {
  const { episode, plans, personnages, index, urls, etat } = d;
  const unites = unitesClips(episode, plans, personnages);
  const tache = d.taches.find((t) => t.type === "clips");
  const clips = unites.filter((u) => u.genre === "clip");
  const voix = unites.filter((u) => u.genre === "voix");
  const compter = (liste: typeof unites) => liste.filter((u) => index.get(u.cle)?.statut === "pret").length;
  const generes = d.fichiers.filter((f) => f.genre === "clip" || f.genre === "voix");
  const secondes = generes.reduce((a, f) => a + (f.secondes_generation ?? 0), 0);
  const cout = generes.reduce((a, f) => a + f.cout, 0);
  const pret = plans.length > 0 && plans.every((p) => p.valide && index.get(`${p.id}:image`)?.statut === "pret");
  const champ = <input type="hidden" name="episode_id" value={episode.id} />;
  const fait = compter(unites);

  return (
    <div className="pile">
      <div className="grille-kpi">
        <Kpi libelle="Clips Grok" valeur={`${compter(clips)}/${clips.length}`} />
        {episode.genre === "clip" ? <Kpi libelle="Son" valeur="La chanson" /> : <Kpi libelle="Voix ElevenLabs" valeur={`${compter(voix)}/${voix.length}`} />}
        <Kpi libelle="Échecs" valeur={String(etat.clips.echec)} />
        <Kpi libelle="Temps de génération" valeur={dureeLisible(secondes)} />
        <Kpi libelle="Coût" valeur={euros(cout)} />
      </div>
      <section className="carte ligne">
        <div className="extensible" style={{ flex: "999 1 300px" }}>
          <p className="gras">{tache ? (tache.statut === "en_pause" ? "En pause : plafond du mois atteint" : tache.statut === "en_file" ? "En file d’attente" : "Génération en cours") : fait === unites.length && unites.length ? "Clips et voix prêts" : "Clips et voix"}</p>
          <p className="tres-petit doux">
            {tache?.progression.etape ?? (pret ? "Chaque plan devient un clip Grok à partir de son image validée ; les répliques sont dites par ElevenLabs dans chaque langue." : "Valide d’abord toutes les images du storyboard.")}
          </p>
          <div className="marge-haut">
            <Jauge pourcentage={unites.length ? (100 * fait) / unites.length : 0} ton="info" libelle="Clips et voix générés" />
          </div>
        </div>
        <div className="ligne">
          <form action={choisirPrises} className="ligne ligne--serree" aria-label="Prises par plan">
            {champ}
            <span className="tres-petit doux">Prises par plan</span>
            <button type="submit" name="prises" value="1" className="segment" aria-pressed={episode.prises === 1}>
              1
            </button>
            <button type="submit" name="prises" value="2" className="segment" aria-pressed={episode.prises === 2}>
              2
            </button>
          </form>
          {tache && tache.statut === "en_file" ? (
            <form action={mettreEnPause}>
              {champ}
              <BoutonEnvoi>Pause</BoutonEnvoi>
            </form>
          ) : tache ? null : (
            <form action={lancerClips}>
              {champ}
              <BoutonEnvoi variante="principal" desactive={!pret || fait === unites.length}>
                {fait ? "Compléter les clips" : "Lancer les clips"}
              </BoutonEnvoi>
            </form>
          )}
        </div>
      </section>
      <section aria-label="Plans" className="carte">
        {plans.length === 0 ? <p className="petit doux">Aucun plan.</p> : null}
        <ul className="liste-nue">
          {plans.map((p, i) => {
            const siennes = unites.filter((u) => u.plan?.id === p.id);
            const echecs = siennes.map((u) => index.get(u.cle)).filter((f) => f?.statut === "echec");
            const personnage = personnages.find((c) => c.id === p.personnage_id);
            const lecteurs = (episode.prises === 2 ? (["A", "B"] as const) : (["A"] as const)).map((prise) => {
              const f = index.get(`${p.id}:clip:${prise}`);
              return { prise, url: f?.statut === "pret" && f.chemin ? urls.get(f.chemin) : undefined };
            });
            return (
              <li key={p.id} className="liste-ligne liste-ligne--haut">
                <span className="mono">P{i + 1}</span>
                <div className="extensible">
                  <p className="petit">{p.texte}</p>
                  {p.type === "dialogue" && p.replique ? (
                    <p className="tres-petit texte-violet">
                      {personnage?.nom ?? "?"} : « {p.replique} »
                    </p>
                  ) : null}
                  <div className={`${styles.lecteurs} marge-haut`}>
                    {lecteurs
                      .filter((l) => l.url)
                      .map((l) => (
                        <video key={l.prise} src={l.url} controls preload="none" playsInline aria-label={`Clip du plan ${i + 1}, prise ${l.prise}`} />
                      ))}
                  </div>
                </div>
                <div className="ligne ligne--serree" style={{ flex: "1 1 280px" }}>
                  {siennes.map((u) => {
                    const f = index.get(u.cle);
                    const classe = f?.statut === "pret" ? styles.unitePrete : f?.statut === "echec" ? styles.uniteEchec : tache ? styles.uniteEnCours : "";
                    const nom = u.genre === "clip" ? `Clip ${u.prise}` : `Voix ${u.langue?.toUpperCase() ?? ""}`;
                    const etatTexte = f?.statut === "pret" ? "prêt" : f?.statut === "echec" ? "échec" : tache ? "en attente" : "à faire";
                    return (
                      <span key={u.cle} className={`${styles.unite} ${classe}`} title={u.langue ? NOMS_LANGUES[u.langue] : undefined}>
                        {nom} · {etatTexte}
                      </span>
                    );
                  })}
                </div>
                {episode.prises === 2 ? (
                  <form action={choisirPrise} className="ligne ligne--serree" aria-label={`Prise retenue pour le plan ${i + 1}`}>
                    <input type="hidden" name="plan_id" value={p.id} />
                    <button type="submit" name="prise" value="A" className="segment" aria-pressed={p.prise_choisie === "A"}>
                      Prise A
                    </button>
                    <button type="submit" name="prise" value="B" className="segment" aria-pressed={p.prise_choisie === "B"}>
                      Prise B
                    </button>
                  </form>
                ) : null}
                {echecs.length ? (
                  <div className="bandeau bandeau--erreur ligne" style={{ flexBasis: "100%" }}>
                    <span className="petit extensible">{echecs.map((f) => f?.erreur ?? "Erreur inconnue").join(" · ")}</span>
                    <form action={lancerClips}>
                      {champ}
                      <input type="hidden" name="plan_ids" value={p.id} />
                      <BoutonEnvoi desactive={!!tache}>Réessayer</BoutonEnvoi>
                    </form>
                    <Link href={`${lienEpisode(episode, "scenario")}#plan-${p.id}`} className="btn">
                      Réécrire le plan
                    </Link>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
