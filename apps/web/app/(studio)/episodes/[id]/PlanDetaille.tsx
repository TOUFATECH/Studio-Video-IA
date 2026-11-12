// Storyboard détaillé d'un plan : scène, durée (1 à 8 s), décor, activité, personnages, variantes, cadrage,
// consigne de mouvement, transition, effet, texte à l'écran et son.
import { DUREE_PLAN, EFFETS, TRANSITIONS, type Element, type Personnage, type Plan, type Scene } from "@studio-video-ia/core";
import { modifierPlanDetaille } from "@/app/actions/studio";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";

/** Formulaire détaillé d'un plan, replié par défaut. */
export function PlanDetaille({
  plan,
  numero,
  duree,
  scenes,
  elements,
  personnages,
  dureeLibre,
}: {
  plan: Plan;
  numero: number;
  duree: number;
  scenes: readonly Scene[];
  elements: readonly Element[];
  personnages: readonly Personnage[];
  /** Vrai pour un épisode court : durée libre de 1 à 8 s. */
  dureeLibre: boolean;
}) {
  const decors = elements.filter((e) => e.genre === "decor");
  const activites = elements.filter((e) => e.genre === "activite");
  const variantes = elements.filter((e) => e.genre === "variante");
  const p = plan.id;
  const decor = decors.find((e) => e.id === plan.decor_id)?.nom;
  const resume = [plan.cadrage, decor, plan.effet !== "aucun" ? EFFETS[plan.effet].toLowerCase() : "", plan.transition !== "coupe" ? TRANSITIONS[plan.transition].toLowerCase() : ""].filter(Boolean).join(" · ");
  return (
    <details style={{ flex: "1 1 100%" }}>
      <summary className="petit">
        Storyboard du plan {numero}
        {resume ? <span className="tres-petit doux"> · {resume}</span> : null}
      </summary>
      <form action={modifierPlanDetaille} className="pile pile--serree marge-haut">
        <input type="hidden" name="id" value={p} />
        <div className="ligne ligne--bas">
          <div className="champ">
            <label className="etiquette" htmlFor={`pd-sc-${p}`}>
              Scène
            </label>
            <select id={`pd-sc-${p}`} name="scene_id" defaultValue={plan.scene_id ?? ""}>
              <option value="">Sans scène</option>
              {scenes.map((s, i) => (
                <option key={s.id} value={s.id}>
                  S{i + 1} · {s.titre || "sans titre"}
                </option>
              ))}
            </select>
          </div>
          {dureeLibre ? (
            <div className="champ">
              <label className="etiquette" htmlFor={`pd-du-${p}`}>
                Durée (s) · vide = auto ({duree} s)
              </label>
              <input id={`pd-du-${p}`} name="duree" type="number" min={DUREE_PLAN.min} max={DUREE_PLAN.max} step={0.5} defaultValue={plan.duree ?? ""} inputMode="decimal" style={{ width: 120 }} />
            </div>
          ) : (
            <input type="hidden" name="duree" value="" />
          )}
          <div className="champ">
            <label className="etiquette" htmlFor={`pd-de-${p}`}>
              Décor
            </label>
            <select id={`pd-de-${p}`} name="decor_id" defaultValue={plan.decor_id ?? ""}>
              <option value="">Celui de la scène</option>
              {decors.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nom}
                </option>
              ))}
            </select>
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor={`pd-ac-${p}`}>
              Activité
            </label>
            <select id={`pd-ac-${p}`} name="activite_id" defaultValue={plan.activite_id ?? ""}>
              <option value="">Aucune</option>
              {activites.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nom}
                </option>
              ))}
            </select>
          </div>
        </div>
        {personnages.length ? (
          <fieldset className="ligne ligne--serree">
            <legend className="etiquette">Personnages à l’image</legend>
            {personnages.map((c) => (
              <label key={c.id} className="case tres-petit">
                <input type="checkbox" name="personnages" value={c.id} defaultChecked={plan.personnages.includes(c.id) || plan.personnage_id === c.id} />
                <span>{c.nom}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {variantes.length ? (
          <fieldset className="ligne ligne--serree">
            <legend className="etiquette">Variantes</legend>
            {variantes.map((v) => (
              <label key={v.id} className="case tres-petit">
                <input type="checkbox" name="variantes" value={v.id} defaultChecked={plan.variantes.includes(v.id)} />
                <span>
                  {personnages.find((c) => c.id === v.personnage_id)?.nom ?? "?"} · {v.nom}
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="ligne ligne--bas">
          <div className="champ extensible">
            <label className="etiquette" htmlFor={`pd-ca-${p}`}>
              Cadrage
            </label>
            <input id={`pd-ca-${p}`} name="cadrage" type="text" maxLength={200} defaultValue={plan.cadrage} placeholder="gros plan, plan moyen, plan large…" />
          </div>
          <div className="champ extensible">
            <label className="etiquette" htmlFor={`pd-mo-${p}`}>
              Consigne de mouvement
            </label>
            <input id={`pd-mo-${p}`} name="mouvement" type="text" maxLength={500} defaultValue={plan.mouvement} placeholder="lent zoom avant, caméra à l’épaule…" />
          </div>
        </div>
        <div className="ligne ligne--bas">
          <div className="champ">
            <label className="etiquette" htmlFor={`pd-tr-${p}`}>
              Transition d’entrée
            </label>
            <select id={`pd-tr-${p}`} name="transition" defaultValue={plan.transition}>
              {Object.entries(TRANSITIONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor={`pd-ef-${p}`}>
              Effet
            </label>
            <select id={`pd-ef-${p}`} name="effet" defaultValue={plan.effet}>
              {Object.entries(EFFETS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="champ extensible">
            <label className="etiquette" htmlFor={`pd-te-${p}`}>
              Texte à l’écran
            </label>
            <input id={`pd-te-${p}`} name="texte_ecran" type="text" maxLength={200} defaultValue={plan.texte_ecran} />
          </div>
          <div className="champ extensible">
            <label className="etiquette" htmlFor={`pd-so-${p}`}>
              Son
            </label>
            <input id={`pd-so-${p}`} name="son" type="text" maxLength={300} defaultValue={plan.son} placeholder="bourdonnement de tondeuse, beat d’intro…" />
          </div>
        </div>
        <div>
          <BoutonEnvoi>Enregistrer le storyboard du plan</BoutonEnvoi>
        </div>
      </form>
    </details>
  );
}
