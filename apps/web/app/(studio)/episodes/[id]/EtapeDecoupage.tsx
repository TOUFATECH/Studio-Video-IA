// Étape 2 d'un clip : découpage. Plans calés sur la chanson (début, fin, paroles chantées), scènes modifiables.
import { LISTE_TYPES_PLAN, NOMS_FOURNISSEURS_TEXTE, TYPES_PLAN, formaterTemps, parolesEntre } from "@studio-video-ia/core";
import Link from "next/link";
import { decouperClip } from "@/app/actions/clips";
import { demanderModification, modifierPlan } from "@/app/actions/episodes";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { lienEpisode } from "@/lib/episodes";
import type { DonneesEpisode } from "./chargement";
import styles from "./episode.module.scss";

/** Étape Découpage d'un clip. */
export function EtapeDecoupage({ d }: { d: DonneesEpisode }) {
  const { episode, plans, personnages, durees } = d;
  const n = plans.length;
  const ecriture = d.taches.find((t) => t.type === "scenario");
  const echec = !ecriture ? d.recentes.find((t) => t.type === "scenario" && t.statut === "echec") : undefined;
  const champ = <input type="hidden" name="episode_id" value={episode.id} />;
  const types = LISTE_TYPES_PLAN.filter((t) => t !== "dialogue");
  const total = plans.reduce((a, p) => a + (durees.get(p.id) ?? 0), 0);

  return (
    <div className="pile">
      <section className="carte ligne ligne--entre">
        <div className="pile pile--serree">
          <p className="gras">{n ? `${n} plans calés sur la chanson · ${formaterTemps(total)}` : "Pas encore découpé"}</p>
          <p className="tres-petit doux">
            Un plan par phrase chantée (coupé sur le temps si le tempo est connu). Scènes écrites par {NOMS_FOURNISSEURS_TEXTE[episode.fournisseur_texte]}. La durée de chaque plan suit la chanson.
          </p>
        </div>
        <div className="ligne">
          <Link href={lienEpisode(episode, "son")} className="btn btn--discret">
            Réglages
          </Link>
          <form action={decouperClip}>
            {champ}
            <BoutonEnvoi variante={n ? "discret" : "principal"} desactive={!!ecriture || episode.paroles_alignees === null}>
              {ecriture ? "Découpage en cours…" : n ? "Redécouper" : "Découper"}
            </BoutonEnvoi>
          </form>
        </div>
      </section>
      {echec ? (
        <p className="bandeau bandeau--erreur" role="alert">
          Le découpage a échoué : {echec.erreur ?? "erreur inconnue"}.
        </p>
      ) : null}

      {n ? (
        <section aria-label="Ligne de temps" className="carte pile pile--serree">
          <div className={styles.frise}>
            {plans.map((p, i) => {
              const s = durees.get(p.id) ?? 0;
              return (
                <div key={p.id} className={`${styles.segment} ${styles[`type-${p.type}`]}`} style={{ flex: `${s} 1 0` }} title={`Plan ${i + 1} · ${formaterTemps(p.debut ?? 0)} · ${s.toFixed(1)} s`}>
                  {i + 1}
                </div>
              );
            })}
          </div>
          <p className="tres-petit doux">Couleurs : accroche, action, décor (instrumental), climax (refrain), final.</p>
        </section>
      ) : null}

      <section aria-labelledby="modif-clip-h" className="carte">
        <form action={demanderModification} className="pile pile--serree">
          <h2 id="modif-clip-h" className="h3">
            Changer ce qu’on voit
          </h2>
          {champ}
          <div className="ligne ligne--bas">
            <div className="champ champ--large">
              <label className="etiquette" htmlFor="dc-demande">
                Pour tout le clip
              </label>
              <input id="dc-demande" name="demande" type="text" minLength={3} maxLength={1000} required placeholder="Ex. : plus de plans de foule sur les refrains, ambiance aube à la fin" />
            </div>
            <BoutonEnvoi variante="principal" desactive={!n || !!ecriture}>
              Appliquer
            </BoutonEnvoi>
          </div>
          <p className="tres-petit doux">Les paroles et le découpage restent : seules les scènes touchées repassent en génération.</p>
        </form>
      </section>

      <section aria-labelledby="plans-clip-h" className="pile">
        <h2 id="plans-clip-h" className="h2">
          Plans
        </h2>
        {n === 0 ? <p className="carte petit doux vide">Synchronise les paroles dans « Son et paroles », puis « Découper ».</p> : null}
        {plans.map((p, i) => {
          const chante = parolesEntre(episode.paroles_alignees, p.debut ?? 0, p.fin ?? 0);
          const duree = durees.get(p.id) ?? 0;
          return (
            <article key={p.id} id={`plan-${p.id}`} className={`${styles.plan} ${p.modifie ? styles.planModifie : ""}`}>
              <form action={modifierPlan} className={`${styles.formPlan} ligne ligne--haut`} style={{ flex: "1 1 100%", gap: 14 }}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="replique" value="" />
                <input type="hidden" name="duree" value="auto" />
                <div className={styles.planCote}>
                  <span className="ligne ligne--serree">
                    <span className="mono" style={{ fontSize: 18 }}>
                      P{i + 1}
                    </span>
                    <span className="tres-petit mono doux">{duree.toFixed(1)} s</span>
                  </span>
                  <span className="tres-petit mono doux">
                    {formaterTemps(p.debut ?? 0)} → {formaterTemps(p.fin ?? 0)}
                  </span>
                  {p.modifie ? <span className="tres-petit texte-attention gras">Modifié · à regénérer</span> : null}
                  <label className="etiquette" htmlFor={`t-${p.id}`}>
                    Type
                  </label>
                  <select id={`t-${p.id}`} name="type" defaultValue={p.type}>
                    {types.map((t) => (
                      <option key={t} value={t}>
                        {TYPES_PLAN[t].libelle}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.planCorps}>
                  <p className="petit">
                    <span className="etiquette">Chanté : </span>
                    {chante ? <em>« {chante} »</em> : <span className="doux">instrumental</span>}
                  </p>
                  <label className="etiquette" htmlFor={`x-${p.id}`}>
                    Ce qu’on voit
                  </label>
                  <textarea id={`x-${p.id}`} name="texte" rows={2} defaultValue={p.texte} required maxLength={3000} />
                  {personnages.length ? (
                    <div className="champ">
                      <label className="etiquette" htmlFor={`q-${p.id}`}>
                        Personnage à l’image
                      </label>
                      <select id={`q-${p.id}`} name="personnage_id" defaultValue={p.personnage_id ?? ""}>
                        <option value="">Aucun</option>
                        {personnages.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nom}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <input type="hidden" name="personnage_id" value="" />
                  )}
                  <div>
                    <BoutonEnvoi>Enregistrer le plan</BoutonEnvoi>
                  </div>
                </div>
              </form>
              <form action={demanderModification} className="ligne ligne--bas" style={{ flex: "999 1 320px" }}>
                {champ}
                <input type="hidden" name="plan_ids" value={p.id} />
                <div className="champ champ--large">
                  <label className="etiquette" htmlFor={`m-${p.id}`}>
                    Modifier ce plan avec l’IA
                  </label>
                  <input id={`m-${p.id}`} name="demande" type="text" minLength={3} maxLength={1000} required placeholder="Ex. : plan plus serré, lumière rouge" />
                </div>
                <BoutonEnvoi desactive={!!ecriture}>Réécrire</BoutonEnvoi>
              </form>
            </article>
          );
        })}
      </section>
    </div>
  );
}
