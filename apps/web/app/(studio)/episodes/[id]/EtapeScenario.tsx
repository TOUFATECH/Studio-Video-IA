// Étape 1 : scénario. Réglages de l'épisode, écriture par l'IA, continuité, vérifications, ligne de temps et plans éditables.
import { BORNES_DUREE, DUREES_AUTORISEES, LISTE_TYPES_PLAN, NOMS_LANGUES, TYPES_PLAN, formaterDuree, sectionsDe } from "@studio-video-ia/core";
import Link from "next/link";
import { ajouterPlan, demanderModification, ecrireScenario, modifierEpisode, modifierPlan, supprimerPlan } from "@/app/actions/episodes";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Pastille } from "@/components/ui/elements";
import { codeEpisode } from "@/lib/episodes";
import { OPTIONS_LANGUES } from "@/lib/libelles";
import type { DonneesEpisode } from "./chargement";
import styles from "./episode.module.scss";

/** Une vérification de la continuité. */
type Verif = { ok: boolean; avertissement?: boolean; texte: string };

/** Étape Scénario. */
export function EtapeScenario({ d, total }: { d: DonneesEpisode; total: number }) {
  const { episode, plans, personnages, durees } = d;
  const n = plans.length;
  const long = episode.genre === "episode" && episode.format === "long";
  const b = episode.genre !== "episode" ? BORNES_DUREE.generique : BORNES_DUREE[episode.format];
  const ecart = Math.round(total - episode.duree_cible);
  const tolerance = long ? Math.round(episode.duree_cible * 0.03) : 2;
  const saisons = new Map(d.saisons.map((s) => [s.id, s]));
  const ecriture = d.taches.find((t) => t.type === "scenario");
  const echecEcriture = !ecriture ? d.recentes.find((t) => t.type === "scenario") : undefined;

  // Vérifications de continuité.
  const texteEp = plans.map((p) => `${p.texte} ${p.replique}`).join(" ").toLowerCase();
  const presents = personnages.filter((c) => texteEp.includes(c.nom.toLowerCase()) || plans.some((p) => p.personnage_id === c.id));
  const sansPerso = plans.filter((p) => p.type === "dialogue" && !p.personnage_id).length;
  const sansReplique = plans.filter((p) => p.type === "dialogue" && p.personnage_id && !p.replique.trim()).length;
  const voix = new Map<string, string[]>();
  for (const c of personnages) if (c.source_voix !== "grok" && c.voix_id) voix.set(c.voix_id, [...(voix.get(c.voix_id) ?? []), c.nom]);
  const doublons = [...voix.values()].filter((x) => x.length > 1).map((x) => x.join(" et "));
  const sansAccord = personnages.filter((c) => c.source_voix === "elevenlabs_clone" && !c.accord_clone);
  const sansFiche = presents.filter((c) => c.fiche_statut !== "prete");
  const verifs: Verif[] = n
    ? [
        { ok: Math.abs(ecart) <= tolerance, texte: `Durée ${formaterDuree(total)} pour une cible de ${formaterDuree(episode.duree_cible)}.` },
        { ok: presents.length > 0, avertissement: true, texte: presents.length ? `Personnages présents : ${presents.map((c) => c.nom).join(", ")}.` : "Aucun personnage de la bible n’apparaît." },
        { ok: sansFiche.length === 0, avertissement: true, texte: sansFiche.length ? `Sans fiche de référence : ${sansFiche.map((c) => c.nom).join(", ")}.` : "Chaque personnage présent a sa fiche de référence." },
        { ok: sansPerso === 0 && sansReplique === 0, avertissement: true, texte: sansPerso ? `${sansPerso} dialogue(s) sans personnage.` : sansReplique ? `${sansReplique} réplique(s) à écrire.` : "Dialogues complets." },
        { ok: doublons.length === 0, texte: doublons.length ? `Même voix pour ${doublons.join(" ; ")}.` : "Une voix par personnage." },
        { ok: sansAccord.length === 0, texte: sansAccord.length ? `Voix clonée sans accord : ${sansAccord.map((c) => c.nom).join(", ")}.` : "Voix clonées : accord coché." },
      ]
    : [{ ok: false, avertissement: true, texte: "Pas encore de scénario." }];
  const avant = d.ordre.slice(Math.max(0, d.position - 3), Math.max(0, d.position));
  const sections = sectionsDe(plans);
  const chapitre = (s: string) => episode.chapitres.find((c) => c.section === s)?.titre ?? (s === "principal" ? "Plans" : s);
  const dureeSection = (s: string) => plans.filter((p) => p.section === s).reduce((a, p) => a + (durees.get(p.id) ?? 0), 0);

  return (
    <div className="pile">
      <div className="colonnes">
        <section aria-label="L’épisode" className="carte">
          <form action={modifierEpisode} className="pile">
            <input type="hidden" name="id" value={episode.id} />
            <div className="champ">
              <label className="etiquette" htmlFor="e-titre">
                Titre
              </label>
              <input id="e-titre" name="titre" type="text" defaultValue={episode.titre} maxLength={200} />
            </div>
            <div className="champ">
              <label className="etiquette" htmlFor="e-idee">
                Idée
              </label>
              <textarea id="e-idee" name="idee" rows={3} defaultValue={episode.idee} />
            </div>
            {episode.genre === "episode" ? (
              <fieldset className="segments">
                <legend className="etiquette">Format</legend>
                <label className="segment">
                  <input type="radio" name="format" value="court" defaultChecked={episode.format === "court"} />
                  Court · 1:00 à 2:00 · vertical
                </label>
                <label className="segment">
                  <input type="radio" name="format" value="moyen" defaultChecked={episode.format === "moyen"} />
                  YouTube · 2:00 à 4:00 · 16:9
                </label>
                <label className="segment">
                  <input type="radio" name="format" value="long" defaultChecked={episode.format === "long"} />
                  Film · 5 à 20 min · 16:9
                </label>
              </fieldset>
            ) : (
              <input type="hidden" name="format" value="court" />
            )}
            <div className="champ">
              <label className="etiquette" htmlFor="e-duree">
                Durée cible en secondes ({b.min} à {b.max}) · calculée : <span className="mono">{formaterDuree(total)}</span> ·{" "}
                <span className={n && Math.abs(ecart) <= tolerance ? "texte-succes" : "texte-attention"}>{n ? (ecart === 0 ? "pile" : `${ecart > 0 ? "+" : "−"}${Math.abs(ecart)} s`) : "—"}</span>
              </label>
              <input id="e-duree" name="duree_cible" type="number" min={b.min} max={b.max} step={b.pas} defaultValue={episode.duree_cible} required />
              <span className="tres-petit doux">Changer de format remet la durée par défaut du format.</span>
            </div>
            <div className="ligne ligne--bas">
              <div className="champ">
                <label className="etiquette" htmlFor="e-langue">
                  Langue d’origine
                </label>
                <select id="e-langue" name="langue" defaultValue={episode.langue}>
                  {OPTIONS_LANGUES.map((l) => (
                    <option key={l.valeur} value={l.valeur}>
                      {l.libelle}
                    </option>
                  ))}
                </select>
              </div>
              <label className="case extensible">
                <input type="checkbox" name="enchainer" defaultChecked={episode.enchainer} />
                <span>Enchaîner les plans (la dernière image d’un clip ouvre le suivant)</span>
              </label>
            </div>
            <div>
              <BoutonEnvoi>Enregistrer</BoutonEnvoi>
            </div>
          </form>
          <form action={ecrireScenario} className="ligne marge-haut">
            <input type="hidden" name="episode_id" value={episode.id} />
            <BoutonEnvoi variante="principal" desactive={!!ecriture}>
              {ecriture ? "Écriture en cours…" : n ? "Réécrire avec l’IA" : "Écrire avec l’IA"}
            </BoutonEnvoi>
            <span className="tres-petit doux">{n ? "Remplace les plans et efface leurs générations." : "Bible, mémoire et fin de l’épisode précédent sont pris en compte."}</span>
          </form>
          {echecEcriture?.statut === "echec" ? (
            <p className="bandeau bandeau--erreur marge-haut" role="alert">
              L’écriture a échoué : {echecEcriture.erreur ?? "erreur inconnue"}.
            </p>
          ) : null}
        </section>

        <section aria-labelledby="cont-h" className="carte pile pile--serree">
          <div className="ligne ligne--entre">
            <h2 id="cont-h" className="h2">
              Continuité
            </h2>
            <Link href={`/series/${d.serie.id}?onglet=memoire`} className="btn btn--discret">
              Mémoire
            </Link>
          </div>
          <p className="petit">
            <span className="etiquette">Avant : </span>
            {avant.length ? avant.map((e) => `${codeEpisode(e, saisons.get(e.saison_id))} ${e.titre}`).join(" → ") : "Premier épisode de la série."}
          </p>
          <p className="petit">
            <span className="etiquette">Fin de l’épisode précédent : </span>
            {d.finPrecedent?.texte ?? "—"}
          </p>
          <p className="petit">
            <span className="etiquette">Mystères ouverts : </span>
            {d.mysteres.length ? d.mysteres.map((m) => m.texte).join(" · ") : "aucun"}
          </p>
          <p className="petit">
            <span className="etiquette">Personnages : </span>
            {personnages.map((c) => `${c.nom}${c.fiche_statut === "prete" ? "" : " (sans fiche)"}`).join(", ") || "aucun"}
          </p>
          <ul className="liste-nue pile pile--serree" style={{ borderTop: "1px solid var(--couleur-bordure)", paddingTop: 10 }}>
            {verifs.map((v) => (
              <li key={v.texte} className="ligne ligne--sans-retour ligne--haut petit">
                <Pastille ton={v.ok ? "succes" : v.avertissement ? "attention" : "erreur"} />
                <span>
                  <strong>{v.ok ? "OK" : v.avertissement ? "À voir" : "Manque"}</strong> {v.texte}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="modif-h" className="carte">
        <form action={demanderModification} className="pile pile--serree">
          <h2 id="modif-h" className="h3">
            Demander une modification
          </h2>
          <input type="hidden" name="episode_id" value={episode.id} />
          <div className="ligne ligne--bas">
            <div className="champ champ--large">
              <label className="etiquette" htmlFor="e-demande">
                Pour tout l’épisode
              </label>
              <input id="e-demande" name="demande" type="text" minLength={3} maxLength={1000} required placeholder="Ex. : fin plus triste, ajoute le narrateur au plan 6" />
            </div>
            <BoutonEnvoi variante="principal" desactive={!n || !!ecriture}>
              Appliquer
            </BoutonEnvoi>
          </div>
          <p className="tres-petit doux">Seuls les plans touchés repassent en génération. Le reste est conservé.</p>
        </form>
      </section>

      {n ? (
        <section aria-label="Ligne de temps" className="carte pile pile--serree">
          {long ? (
            <div className={styles.frise}>
              <div className={`${styles.segment} ${styles.generique}`} style={{ flex: "30 1 0" }} title="Opening de la saison · 30 s">
                OP
              </div>
              {sections.map((s, i) => (
                <div key={s} className={`${styles.segment} ${styles["type-action"]}`} style={{ flex: `${dureeSection(s)} 1 0` }} title={`${chapitre(s)} · ${formaterDuree(dureeSection(s))}`}>
                  Ch.{i + 1}
                </div>
              ))}
              <div className={`${styles.segment} ${styles.generique}`} style={{ flex: "30 1 0" }} title="Ending de la saison · 30 s">
                ED
              </div>
            </div>
          ) : (
            <div className={styles.frise}>
              {plans.map((p, i) => {
                const s = durees.get(p.id) ?? 0;
                return (
                  <div key={p.id} className={`${styles.segment} ${styles[`type-${p.type}`]}`} style={{ flex: `${s} 1 0` }} title={`Plan ${i + 1} · ${TYPES_PLAN[p.type].libelle} · ${s} s`}>
                    {s}s
                  </div>
                );
              })}
            </div>
          )}
          <div className={`${styles.legende} tres-petit doux`}>
            {LISTE_TYPES_PLAN.map((t) => (
              <span key={t} className="ligne ligne--serree">
                <span className={`${styles.carre} ${styles[`type-${t}`]}`} aria-hidden="true" />
                {TYPES_PLAN[t].libelle} · {TYPES_PLAN[t].base} s
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="plans-h" className="pile">
        <div className="ligne ligne--entre">
          <h2 id="plans-h" className="h2">
            Plans
          </h2>
          <form action={ajouterPlan}>
            <input type="hidden" name="episode_id" value={episode.id} />
            <input type="hidden" name="section" value={sections.at(-1) ?? "principal"} />
            <BoutonEnvoi>+ Plan</BoutonEnvoi>
          </form>
        </div>
        {n === 0 ? <p className="carte petit doux vide">Écris l’idée, puis « Écrire avec l’IA ». L’IA suit la bible et la mémoire de la série.</p> : null}
        {sections.map((s) => (
          <div key={s} className="pile">
            {long || sections.length > 1 ? <h3 className="h3">{chapitre(s)}</h3> : null}
            {plans
              .filter((p) => p.section === s)
              .map((p) => {
                const i = plans.indexOf(p);
                const duree = durees.get(p.id) ?? 0;
                return (
                  <article key={p.id} id={`plan-${p.id}`} className={`${styles.plan} ${p.modifie ? styles.planModifie : ""}`}>
                    <form action={modifierPlan} className={`${styles.formPlan} ligne ligne--haut`} style={{ flex: "1 1 100%", gap: 14 }}>
                      <input type="hidden" name="id" value={p.id} />
                      <div className={styles.planCote}>
                        <span className="ligne ligne--serree">
                          <span className="mono" style={{ fontSize: 18 }}>
                            P{i + 1}
                          </span>
                          <span className="tres-petit mono doux">{duree} s</span>
                        </span>
                        {p.modifie ? <span className="tres-petit texte-attention gras">Modifié · à regénérer</span> : null}
                        <label className="etiquette" htmlFor={`t-${p.id}`}>
                          Type
                        </label>
                        <select id={`t-${p.id}`} name="type" defaultValue={p.type}>
                          {LISTE_TYPES_PLAN.map((t) => (
                            <option key={t} value={t}>
                              {TYPES_PLAN[t].libelle}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className={styles.planCorps}>
                        <label className="etiquette" htmlFor={`x-${p.id}`}>
                          Ce qu’on voit
                        </label>
                        <textarea id={`x-${p.id}`} name="texte" rows={2} defaultValue={p.texte} required maxLength={3000} />
                        <div className={styles.dialogue}>
                          <div className="champ">
                            <label className="etiquette" htmlFor={`q-${p.id}`}>
                              Qui parle
                            </label>
                            <select id={`q-${p.id}`} name="personnage_id" defaultValue={p.personnage_id ?? ""}>
                              <option value="">À choisir</option>
                              {personnages.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nom}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="champ">
                            <label className="etiquette" htmlFor={`r-${p.id}`}>
                              Réplique ({NOMS_LANGUES[episode.langue].toLowerCase()})
                            </label>
                            <input id={`r-${p.id}`} name="replique" type="text" defaultValue={p.replique} maxLength={1000} />
                          </div>
                        </div>
                        <fieldset className="segments">
                          <legend className="tres-petit doux">Durée · {p.duree_fixee ? "fixée" : `auto (${duree} s)`}</legend>
                          <label className="segment">
                            <input type="radio" name="duree" value="auto" defaultChecked={p.duree_fixee === null} />
                            Auto
                          </label>
                          {DUREES_AUTORISEES.map((v) => (
                            <label key={v} className="segment">
                              <input type="radio" name="duree" value={v} defaultChecked={p.duree_fixee === v} />
                              {v} s
                            </label>
                          ))}
                        </fieldset>
                        <div>
                          <BoutonEnvoi>Enregistrer le plan</BoutonEnvoi>
                        </div>
                      </div>
                    </form>
                    <form action={demanderModification} className="ligne ligne--bas" style={{ flex: "999 1 320px" }}>
                      <input type="hidden" name="episode_id" value={episode.id} />
                      <input type="hidden" name="plan_ids" value={p.id} />
                      <div className="champ champ--large">
                        <label className="etiquette" htmlFor={`m-${p.id}`}>
                          Modifier ce plan avec l’IA
                        </label>
                        <input id={`m-${p.id}`} name="demande" type="text" minLength={3} maxLength={1000} required placeholder="Ex. : qu’il pleuve, plan plus serré" />
                      </div>
                      <BoutonEnvoi desactive={!!ecriture}>Réécrire</BoutonEnvoi>
                    </form>
                    <form action={supprimerPlan} className="ligne ligne--bas">
                      <input type="hidden" name="plan_id" value={p.id} />
                      <BoutonEnvoi variante="danger" libelleAria={`Supprimer le plan ${i + 1}`}>
                        Supprimer
                      </BoutonEnvoi>
                    </form>
                  </article>
                );
              })}
          </div>
        ))}
      </section>
    </div>
  );
}
