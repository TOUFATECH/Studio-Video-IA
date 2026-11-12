// Story de l'épisode (accroche, déroulé, fin vers la suite, rappel), validation du scénario et scènes (lieu, moment,
// personnages). Le storyboard détaillé de chaque plan est dans PlanDetaille.
import { controleDuree, formaterDuree, STATUTS_PRODUCTION } from "@studio-video-ia/core";
import { ajouterScene, modifierScene, modifierStory, supprimerScene, validerScenario } from "@/app/actions/studio";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Puce } from "@/components/ui/elements";
import type { DonneesEpisode } from "./chargement";

/** Durées ajoutées au montage : rappel de l'épisode précédent (2 s) et carte de fin (3 s). */
export function dureeMontage(d: DonneesEpisode, total: number): { total: number; detail: string } {
  const rappel = d.episode.rappel && d.episode.genre === "episode" && d.position > 0 ? 2 : 0;
  const carte = d.episode.carte_fin && d.elements.some((e) => e.genre === "marque") ? 3 : 0;
  const extra = [rappel ? "rappel 2 s" : "", carte ? "carte de fin 3 s" : ""].filter(Boolean).join(" + ");
  return { total: total + rappel + carte, detail: extra };
}

/** Bandeau des 9 statuts de production, l'étape actuelle en gras. */
export function FriseStatuts({ rang }: { rang: number }) {
  return (
    <ol className="ligne ligne--serree tres-petit" aria-label="Statut de production" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {STATUTS_PRODUCTION.map((s, i) => (
        <li key={s} className={i === rang ? "gras" : i < rang ? "texte-succes" : "doux"} aria-current={i === rang ? "step" : undefined}>
          {i < rang ? "✓ " : ""}
          {s}
          {i < STATUTS_PRODUCTION.length - 1 ? <span aria-hidden="true" className="doux"> → </span> : null}
        </li>
      ))}
    </ol>
  );
}

/** Story, validation du scénario et scènes. */
export function StoryEtScenes({ d, total }: { d: DonneesEpisode; total: number }) {
  const { episode, scenes, personnages } = d;
  const decors = d.elements.filter((e) => e.genre === "decor");
  const vertical = episode.genre === "episode" && episode.format === "court";
  const montage = dureeMontage(d, total);
  const controle = vertical ? controleDuree(total) : { niveau: "ok" as const, message: null };
  const n = d.plans.length;
  return (
    <div className="pile">
      <section aria-labelledby="story-h" className="carte pile">
        <div className="ligne ligne--entre">
          <h2 id="story-h" className="h2">
            Story
          </h2>
          <Puce ton={episode.scenario_valide ? "succes" : "neutre"}>{episode.scenario_valide ? "Scénario validé" : "Brouillon"}</Puce>
        </div>
        <FriseStatuts rang={d.production.rang} />
        <form action={modifierStory} className="pile">
          <input type="hidden" name="episode_id" value={episode.id} />
          <div className="champ">
            <label className="etiquette" htmlFor="s-accroche">
              Accroche des 3 premières secondes
            </label>
            <input id="s-accroche" name="accroche" type="text" maxLength={500} defaultValue={episode.accroche} placeholder="Il entre caché… il ressort méconnaissable." />
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor="s-deroule">
              Déroulé
            </label>
            <textarea id="s-deroule" name="deroule" rows={4} maxLength={20000} defaultValue={episode.deroule} />
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor="s-fin">
              Fin qui donne envie de voir la suite
            </label>
            <input id="s-fin" name="fin_suite" type="text" maxLength={500} defaultValue={episode.fin_suite} />
          </div>
          {episode.genre === "episode" ? (
            <label className="case">
              <input type="checkbox" name="rappel" defaultChecked={episode.rappel} />
              <span>Commencer par un rappel de 2 s de l’épisode précédent</span>
            </label>
          ) : (
            <input type="hidden" name="rappel" value="" />
          )}
          <div>
            <BoutonEnvoi>Enregistrer la story</BoutonEnvoi>
          </div>
        </form>
        <div className="ligne ligne--entre" style={{ borderTop: "1px solid var(--couleur-bordure)", paddingTop: 12 }}>
          <div className="pile pile--serree">
            <p className="petit">
              Durée des plans <span className="mono gras">{formaterDuree(total)}</span>
              {montage.detail ? (
                <span className="doux">
                  {" "}
                  · vidéo finale {formaterDuree(montage.total)} ({montage.detail})
                </span>
              ) : null}
            </p>
            {controle.message ? (
              <p className={`bandeau ${controle.niveau === "bloque" ? "bandeau--erreur" : "bandeau--attention"}`} role="status">
                {controle.message}
              </p>
            ) : vertical && n ? (
              <p className="tres-petit texte-succes">Dans la limite : 60 s conseillé, 90 s au plus.</p>
            ) : null}
          </div>
          <form action={validerScenario}>
            <input type="hidden" name="episode_id" value={episode.id} />
            <input type="hidden" name="valide" value={episode.scenario_valide ? "" : "on"} />
            <BoutonEnvoi variante={episode.scenario_valide ? "discret" : "principal"} desactive={!n || controle.niveau === "bloque"}>
              {episode.scenario_valide ? "Repasser en brouillon" : "Valider le scénario"}
            </BoutonEnvoi>
          </form>
        </div>
      </section>

      <section aria-labelledby="scenes-h" className="pile">
        <div className="ligne ligne--entre">
          <div>
            <h2 id="scenes-h" className="h2">
              Scènes
            </h2>
            <p className="tres-petit doux">Un lieu, un moment, des personnages. Le décor de la scène sert de référence à ses plans.</p>
          </div>
          <form action={ajouterScene}>
            <input type="hidden" name="episode_id" value={episode.id} />
            <BoutonEnvoi>+ Scène</BoutonEnvoi>
          </form>
        </div>
        {scenes.length === 0 ? <p className="carte petit doux vide">Pas encore de scène. L’IA en crée en écrivant le scénario ; tu peux aussi en ajouter.</p> : null}
        <div className="grille-cartes">
          {scenes.map((sc, i) => {
            const plansScene = d.plans.filter((p) => p.scene_id === sc.id);
            const duree = plansScene.reduce((a, p) => a + (d.durees.get(p.id) ?? 0), 0);
            return (
              <article key={sc.id} className="carte pile pile--serree">
                <form action={modifierScene} className="pile pile--serree">
                  <input type="hidden" name="id" value={sc.id} />
                  <div className="ligne ligne--entre">
                    <span className="mono tres-petit doux">
                      S{i + 1} · {plansScene.length} plan{plansScene.length > 1 ? "s" : ""} · {formaterDuree(duree)}
                    </span>
                  </div>
                  <div className="champ">
                    <label className="etiquette" htmlFor={`sc-t-${sc.id}`}>
                      Titre
                    </label>
                    <input id={`sc-t-${sc.id}`} name="titre" type="text" maxLength={200} defaultValue={sc.titre} />
                  </div>
                  <div className="ligne ligne--bas">
                    <div className="champ extensible">
                      <label className="etiquette" htmlFor={`sc-l-${sc.id}`}>
                        Lieu
                      </label>
                      <select id={`sc-l-${sc.id}`} name="lieu_id" defaultValue={sc.lieu_id ?? ""}>
                        <option value="">Aucun décor</option>
                        {decors.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.nom}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="champ">
                      <label className="etiquette" htmlFor={`sc-m-${sc.id}`}>
                        Moment
                      </label>
                      <input id={`sc-m-${sc.id}`} name="moment" type="text" maxLength={80} defaultValue={sc.moment} placeholder="jour, nuit…" />
                    </div>
                  </div>
                  <div className="champ">
                    <label className="etiquette" htmlFor={`sc-r-${sc.id}`}>
                      Résumé
                    </label>
                    <textarea id={`sc-r-${sc.id}`} name="resume" rows={2} maxLength={2000} defaultValue={sc.resume} />
                  </div>
                  {personnages.length ? (
                    <fieldset className="ligne ligne--serree">
                      <legend className="etiquette">Personnages présents</legend>
                      {personnages.map((c) => (
                        <label key={c.id} className="case tres-petit">
                          <input type="checkbox" name="personnages" value={c.id} defaultChecked={sc.personnages.includes(c.id)} />
                          <span>{c.nom}</span>
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                  <div>
                    <BoutonEnvoi>Enregistrer</BoutonEnvoi>
                  </div>
                </form>
                <form action={supprimerScene}>
                  <input type="hidden" name="scene_id" value={sc.id} />
                  <BoutonEnvoi variante="danger" libelleAria={`Supprimer la scène ${i + 1}`}>
                    Supprimer
                  </BoutonEnvoi>
                </form>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
