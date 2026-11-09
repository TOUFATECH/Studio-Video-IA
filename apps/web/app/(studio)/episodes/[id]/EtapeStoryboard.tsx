// Étape 2 : storyboard. Une image 9:16 par plan, à valider ou refaire ; les clips partent quand tout est validé.
import { genererImages, lancerClips, toutValider, validerImage } from "@/app/actions/episodes";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Jauge } from "@/components/ui/elements";
import type { DonneesEpisode } from "./chargement";
import styles from "./episode.module.scss";

/** Étape Storyboard. */
export function EtapeStoryboard({ d }: { d: DonneesEpisode }) {
  const { episode, plans, index, urls, etat } = d;
  const n = plans.length;
  const tache = d.taches.find((t) => t.type === "storyboard");
  const images = plans.map((p) => index.get(`${p.id}:image`));
  const pretes = images.filter((f) => f?.statut === "pret").length;
  const tousValides = n > 0 && pretes === n && plans.every((p) => p.valide);
  const manquantes = n - pretes;
  const champ = <input type="hidden" name="episode_id" value={episode.id} />;
  return (
    <div className="pile">
      <section className="carte ligne">
        <div className="extensible" style={{ flex: "999 1 300px" }}>
          <p className="gras">
            Storyboard · {pretes}/{n} images · {etat.valides} validées
          </p>
          <p className="tres-petit doux">{tache ? (tache.progression.etape ?? (tache.statut === "en_file" ? "En file d’attente" : "Génération en cours…")) : "Une image ChatGPT par plan, avec les fiches de référence des personnages."}</p>
          <div className="marge-haut">
            <Jauge pourcentage={n ? (100 * pretes) / n : 0} ton="info" libelle="Images générées" />
          </div>
        </div>
        <div className="ligne">
          {manquantes > 0 && !tache ? (
            <form action={genererImages}>
              {champ}
              <BoutonEnvoi>{pretes ? `Générer les ${manquantes} images manquantes` : "Générer les images"}</BoutonEnvoi>
            </form>
          ) : null}
          <form action={toutValider}>
            {champ}
            <BoutonEnvoi desactive={pretes === 0}>Tout valider</BoutonEnvoi>
          </form>
          <form action={lancerClips}>
            {champ}
            <BoutonEnvoi variante="principal" desactive={!tousValides || !!d.taches.find((t) => t.type === "clips")}>
              Valider et lancer les clips
            </BoutonEnvoi>
          </form>
        </div>
      </section>
      {n === 0 ? <p className="carte vide petit doux">Écris d’abord le scénario.</p> : null}
      <div className={styles.vignettes}>
        {plans.map((p, i) => {
          const f = images[i];
          const url = f?.statut === "pret" && f.chemin ? urls.get(f.chemin) : undefined;
          const enAttente = !!tache && !f;
          const libelleEtat = f?.statut === "echec" ? "Échec" : f?.statut === "pret" ? (p.valide ? "Validée" : "À valider") : enAttente ? "En file" : "À générer";
          return (
            <article key={p.id} className={`${styles.vignette} ${p.valide && f?.statut === "pret" ? styles.vignetteValidee : ""}`}>
              <div className={styles.cadre}>
                {url ? <img src={url} alt={`Image du plan ${i + 1} : ${p.texte}`} loading="lazy" /> : null}
                <span className={styles.cadreHaut}>
                  <span className={`mono tres-petit ${styles.etiquetteImage}`}>P{i + 1}</span>
                  <span className={`tres-petit ${styles.etiquetteImage}`}>{libelleEtat}</span>
                </span>
                {f?.statut === "echec" ? <span className={`tres-petit ${styles.etiquetteImage} texte-erreur`}>{f.erreur ?? "Erreur inconnue"}</span> : null}
              </div>
              <p className="tres-petit doux coupe-2">{p.texte}</p>
              <div className="ligne ligne--serree ligne--sans-retour">
                <form action={validerImage} style={{ flex: 1 }}>
                  <input type="hidden" name="plan_id" value={p.id} />
                  <input type="hidden" name="valide" value={p.valide ? "" : "on"} />
                  <button type="submit" className={`segment ${styles.boutonValider}`} aria-pressed={p.valide} disabled={f?.statut !== "pret"} style={{ width: "100%" }}>
                    {p.valide ? "Validée" : "Valider"}
                  </button>
                </form>
                <form action={genererImages} style={{ flex: 1 }}>
                  {champ}
                  <input type="hidden" name="plan_ids" value={p.id} />
                  <BoutonEnvoi variante="discret" desactive={!f || !!tache} libelleAria={`Refaire l’image du plan ${i + 1}`}>
                    Refaire
                  </BoutonEnvoi>
                </form>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
