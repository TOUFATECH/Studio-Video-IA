// Étape 2 : storyboard. Une image par plan (ChatGPT), en 1 à 4 propositions, contrôlée automatiquement ; on la valide,
// la refait (avec une consigne corrigée), la retouche, la remplace par son fichier, ou revient à une version précédente.
// Les commentaires d'un plan sont repris à la prochaine image. Les clips partent quand tout est validé.
import { versionsDe } from "@studio-video-ia/core";
import { genererImages, lancerClips, toutValider, validerImage } from "@/app/actions/episodes";
import { choisirVersion, commenterPlan, refaireImage, refaireLot, retirerCommentaire, retoucherImage } from "@/app/actions/studio";
import { ImportFichier } from "@/components/ImportFichier";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Jauge, Puce } from "@/components/ui/elements";
import { euros } from "@/lib/format";
import type { DonneesEpisode } from "./chargement";
import styles from "./episode.module.scss";

/** Case de confirmation de la dépense (exigée au-delà du plafond par épisode). */
export function CaseConfirmer({ id }: { id: string }) {
  return (
    <label className="case tres-petit" htmlFor={id}>
      <input id={id} type="checkbox" name="confirmer" />
      <span>Je confirme la dépense</span>
    </label>
  );
}

/** Étape Storyboard. */
export function EtapeStoryboard({ d }: { d: DonneesEpisode }) {
  const { episode, plans, index, urls, etat } = d;
  const n = plans.length;
  const tache = d.taches.find((t) => t.type === "storyboard");
  const images = plans.map((p) => index.get(`${p.id}:image`));
  const pretes = images.filter((f) => f?.statut === "pret").length;
  const douteux = images.filter((f) => f?.controle?.statut === "douteux").length;
  const tousValides = n > 0 && pretes === n && plans.every((p) => p.valide);
  const manquantes = n - pretes;
  const plafond = d.reglages.preferences.plafond_episode;
  const champ = <input type="hidden" name="episode_id" value={episode.id} />;
  return (
    <div className="pile">
      <section className="carte ligne">
        <div className="extensible" style={{ flex: "999 1 300px" }}>
          <p className="gras">
            Storyboard · {pretes}/{n} images · {etat.valides} validées{douteux ? ` · ${douteux} douteuse${douteux > 1 ? "s" : ""}` : ""}
          </p>
          <p className="tres-petit doux">
            {tache
              ? (tache.progression.etape ?? (tache.statut === "en_file" ? "En file d’attente" : "Génération en cours…"))
              : `Une image ChatGPT par plan, à partir des mêmes références (personnages, vrai décor) · ${d.reglages.preferences.propositions} proposition${d.reglages.preferences.propositions > 1 ? "s" : ""} par plan · contrôle qualité ${d.reglages.preferences.controle_qualite ? "actif" : "désactivé"} · plafond ${euros(plafond)} par épisode.`}
          </p>
          <div className="marge-haut">
            <Jauge pourcentage={n ? (100 * pretes) / n : 0} ton="info" libelle="Images générées" />
          </div>
        </div>
        <div className="pile pile--serree">
          <div className="ligne">
            {manquantes > 0 && !tache ? (
              <form action={genererImages} className="ligne ligne--serree">
                {champ}
                <BoutonEnvoi>{pretes ? `Générer les ${manquantes} images manquantes` : "Générer les images"}</BoutonEnvoi>
                <CaseConfirmer id="conf-images" />
              </form>
            ) : null}
            <form action={toutValider}>
              {champ}
              <BoutonEnvoi desactive={pretes === 0}>Tout valider</BoutonEnvoi>
            </form>
            <form action={lancerClips} className="ligne ligne--serree">
              {champ}
              <BoutonEnvoi variante="principal" desactive={!tousValides || !!d.taches.find((t) => t.type === "clips")}>
                Valider et lancer les clips
              </BoutonEnvoi>
              <CaseConfirmer id="conf-clips" />
            </form>
          </div>
          <form action={refaireLot} className="ligne ligne--serree">
            {champ}
            <input type="hidden" name="etape" value="images" />
            <select name="portee" aria-label="Plans à refaire" defaultValue="erreurs">
              <option value="erreurs">Plans en erreur ou douteux</option>
              <option value="tous">Tous les plans</option>
            </select>
            <select name="scene_id" aria-label="Scène" defaultValue="">
              <option value="">Tout l’épisode</option>
              {d.scenes.map((s, i) => (
                <option key={s.id} value={s.id}>
                  S{i + 1} · {s.titre || "sans titre"}
                </option>
              ))}
            </select>
            <BoutonEnvoi variante="discret" desactive={!n || !!tache}>
              Refaire les images
            </BoutonEnvoi>
            <CaseConfirmer id="conf-lot" />
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
          const versions = versionsDe(d.fichiers, `${p.id}:image`);
          const douteuse = f?.controle?.statut === "douteux";
          const ouverts = p.commentaires.filter((c) => !c.pris);
          return (
            <article key={p.id} className={`${styles.vignette} ${p.valide && f?.statut === "pret" ? styles.vignetteValidee : ""}`} style={douteuse ? { outline: "2px solid var(--couleur-attention, #e8a33d)" } : undefined}>
              <div className={styles.cadre}>
                {url ? <img src={url} alt={`Image du plan ${i + 1} : ${p.texte}`} loading="lazy" /> : null}
                <span className={styles.cadreHaut}>
                  <span className={`mono tres-petit ${styles.etiquetteImage}`}>P{i + 1}</span>
                  <span className={`tres-petit ${styles.etiquetteImage}`}>{libelleEtat}</span>
                </span>
                {f?.statut === "echec" ? <span className={`tres-petit ${styles.etiquetteImage} texte-erreur`}>{f.erreur ?? "Erreur inconnue"}</span> : null}
              </div>
              {douteuse ? (
                <p className="tres-petit texte-attention" role="status">
                  <Puce ton="attention">Douteuse</Puce> {f?.controle?.raisons.join(" ; ")}
                </p>
              ) : null}
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
              <details>
                <summary className="tres-petit">
                  Versions ({versions.length}) · retouche · commentaires{ouverts.length ? ` (${ouverts.length})` : ""}
                </summary>
                <div className={`marge-haut ${styles.outilsPlan}`}>
                  {versions.length > 1 ? (
                    <div className="ligne ligne--serree" role="list" aria-label={`Versions de l’image du plan ${i + 1}`}>
                      {versions.map((v, k) => {
                        const u = v.chemin ? urls.get(v.chemin) : undefined;
                        const retenue = v.id === f?.id;
                        return (
                          <form key={v.id} action={choisirVersion} role="listitem" className="pile pile--serree" style={{ width: 72 }}>
                            <input type="hidden" name="fichier_id" value={v.id} />
                            {u ? <img src={u} alt={`Version ${versions.length - k}`} loading="lazy" style={{ width: 72, borderRadius: 6, outline: retenue ? "2px solid var(--couleur-accent, #FF6A3D)" : undefined }} /> : null}
                            <BoutonEnvoi variante="discret" desactive={retenue} libelleAria={`Choisir la version ${versions.length - k}`}>
                              {retenue ? "Retenue" : "Choisir"}
                            </BoutonEnvoi>
                            {v.controle?.statut === "douteux" ? <span className="tres-petit texte-attention">douteuse</span> : null}
                            {v.fournisseur === "import" ? <span className="tres-petit doux">ton fichier</span> : null}
                          </form>
                        );
                      })}
                    </div>
                  ) : null}
                  <form action={refaireImage} className="pile pile--serree">
                    <input type="hidden" name="plan_id" value={p.id} />
                    <label className="etiquette" htmlFor={`rf-${p.id}`}>
                      Refaire avec une consigne corrigée
                    </label>
                    <input id={`rf-${p.id}`} name="consigne" type="text" maxLength={1000} placeholder="La capuche doit cacher tous les cheveux" />
                    <div className="ligne ligne--serree">
                      <select name="propositions" aria-label="Nombre de propositions" defaultValue="">
                        <option value="">{d.reglages.preferences.propositions} proposition(s)</option>
                        {[1, 2, 3, 4].map((k) => (
                          <option key={k} value={k}>
                            {k} proposition{k > 1 ? "s" : ""}
                          </option>
                        ))}
                      </select>
                      <BoutonEnvoi variante="discret" desactive={!!tache}>
                        Refaire
                      </BoutonEnvoi>
                      <CaseConfirmer id={`conf-rf-${p.id}`} />
                    </div>
                  </form>
                  <form action={retoucherImage} className="pile pile--serree">
                    <input type="hidden" name="plan_id" value={p.id} />
                    <label className="etiquette" htmlFor={`rt-${p.id}`}>
                      Retoucher cette image
                    </label>
                    <input id={`rt-${p.id}`} name="consigne" type="text" minLength={3} maxLength={1000} required placeholder="T-shirt noir au lieu de blanc" />
                    <div className="ligne ligne--serree">
                      <BoutonEnvoi variante="discret" desactive={f?.statut !== "pret" || !!tache}>
                        Retoucher
                      </BoutonEnvoi>
                      <CaseConfirmer id={`conf-rt-${p.id}`} />
                    </div>
                  </form>
                  <ImportFichier genre="remplacement_image" cible={p.id} libelle="Remplacer par mon image" accepte="image/png,image/jpeg,image/webp" aide="PNG, JPG ou WebP, 15 Mo maximum. L’image actuelle reste dans les versions." />
                  <div className="pile pile--serree">
                    <span className="etiquette">Commentaires</span>
                    {p.commentaires.length ? (
                      <ul className="liste-nue pile pile--serree">
                        {p.commentaires.map((c) => (
                          <li key={c.id} className="ligne ligne--entre tres-petit">
                            <span className={c.pris ? "doux" : ""}>
                              {c.texte} {c.pris ? "· pris en compte" : "· à la prochaine image"}
                            </span>
                            <form action={retirerCommentaire}>
                              <input type="hidden" name="plan_id" value={p.id} />
                              <input type="hidden" name="commentaire_id" value={c.id} />
                              <BoutonEnvoi variante="discret" libelleAria="Retirer le commentaire">
                                ×
                              </BoutonEnvoi>
                            </form>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <form action={commenterPlan} className="ligne ligne--serree">
                      <input type="hidden" name="plan_id" value={p.id} />
                      <input name="texte" type="text" minLength={2} maxLength={500} required placeholder="Trop sombre" aria-label={`Commentaire sur le plan ${i + 1}`} className="extensible" />
                      <BoutonEnvoi variante="discret">Ajouter</BoutonEnvoi>
                    </form>
                  </div>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </div>
  );
}
