// Onglet « Publication » : rythme, prochain créneau, hashtags par réseau et programmation des épisodes prêts.
import { MAX_HASHTAGS, NOMS_RESEAUX, RESEAUX, hashtagsParDefaut, prochainCreneau } from "@feuilleton/core";
import Link from "next/link";
import { enregistrerHashtagsSerie, modifierRythme, programmerEpisodesPrets } from "@/app/actions/series";
import { CompteurHashtags } from "@/components/CompteurHashtags";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { BadgeReseau, Puce } from "@/components/ui/elements";
import { codeEpisode, nomEpisode } from "@/lib/episodes";
import { jourHeure } from "@/lib/format";
import { statutCompte } from "@/lib/libelles";
import { planProgrammation } from "@/lib/programmation-serie";
import type { DonneesSerie } from "./chargement";
import styles from "./serie.module.scss";

/** Choix proposés pour « un épisode tous les N jours ». */
const FREQUENCES = [1, 2, 3, 4, 5, 7, 10, 14];

/** Réglages de publication de la série. */
export async function OngletPublication({ d }: { d: DonneesSerie }) {
  const { rythme } = d.serie;
  const maintenant = new Date();
  const futures = d.publications.filter((p) => (p.statut === "programmee" || p.statut === "attend_rendu") && Date.parse(p.programmee_le) > maintenant.getTime()).map((p) => Date.parse(p.programmee_le));
  const prochain = prochainCreneau(rythme, futures.length ? new Date(Math.max(...futures)) : null, maintenant, d.espace.fuseau);
  const plan = await planProgrammation(d.serie, maintenant);
  const saisons = new Map(d.saisons.map((s) => [s.id, s]));

  return (
    <div className="pile pile--large">
      <section aria-labelledby="rythme-h" className="carte">
        <form action={modifierRythme} className="pile">
          <input type="hidden" name="id" value={d.serie.id} />
          <div>
            <h2 id="rythme-h" className="h2">
              Rythme de publication
            </h2>
            <p className="tres-petit doux">Les épisodes prêts prennent les créneaux suivants sur les comptes cochés (heure de {d.espace.nom} : {d.espace.fuseau}).</p>
          </div>
          <div className="ligne ligne--bas">
            <div className="champ champ--etroit">
              <label className="etiquette" htmlFor="r-freq">
                Un épisode tous les
              </label>
              <select id="r-freq" name="tous_les_jours" defaultValue={String(rythme.tous_les_jours)}>
                {[...new Set([...FREQUENCES, rythme.tous_les_jours])].sort((a, b) => a - b).map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "jours" : `${n} jours`}
                  </option>
                ))}
              </select>
            </div>
            <div className="champ champ--etroit">
              <label className="etiquette" htmlFor="r-heure">
                À
              </label>
              <input id="r-heure" name="heure" type="time" defaultValue={rythme.heure} required />
            </div>
            <label className="case extensible">
              <input type="checkbox" name="auto" defaultChecked={rythme.auto} />
              <span>Programmer tout seul les épisodes prêts (fait par le worker)</span>
            </label>
          </div>
          <fieldset className="segments" style={{ flexDirection: "column", gap: 0 }}>
            <legend className="etiquette">Comptes de publication de {d.espace.nom}</legend>
            {d.comptes.length === 0 ? (
              <p className="petit doux">
                Aucun réseau connecté. <Link href={`/reglages?onglet=comptes&espace=${d.espace.id}`}>Connecter TikTok, Instagram ou YouTube</Link>
              </p>
            ) : null}
            {d.comptes.map((c) => {
              const st = statutCompte(c);
              return (
                <label key={c.id} className="liste-ligne case">
                  <input type="checkbox" name="reseaux" value={c.id} defaultChecked={rythme.reseaux.includes(c.id)} />
                  <BadgeReseau reseau={c.reseau} />
                  <span className="petit extensible">{c.nom_compte}</span>
                  <span className="tres-petit mono doux">{c.langue.toUpperCase()}</span>
                  <Puce ton={st.ton}>{st.texte}</Puce>
                </label>
              );
            })}
          </fieldset>
          <p className="petit">
            Prochain créneau : <strong className="mono">{jourHeure(prochain, d.espace.fuseau)}</strong>
          </p>
          <div>
            <BoutonEnvoi variante="principal">Enregistrer le rythme</BoutonEnvoi>
          </div>
        </form>
      </section>

      <section aria-labelledby="prog-h" className="carte pile">
        <div>
          <h2 id="prog-h" className="h2">
            Programmer les épisodes prêts
          </h2>
          <p className="tres-petit doux">Chaque épisode rendu et pas encore programmé prend le créneau suivant, dans l’ordre de la série. Vérifie les dates avant de confirmer.</p>
        </div>
        {plan.comptes.length === 0 ? <p className="bandeau bandeau--attention">Coche au moins un compte connecté dans le rythme, puis enregistre.</p> : null}
        {plan.sorties.length === 0 ? (
          <p className="petit doux">Aucun épisode rendu en attente de programmation.</p>
        ) : (
          <>
            <ul className={`liste-nue ${styles.apercuProgrammation}`}>
              {plan.sorties.map((s) => (
                <li key={s.episode.id} className="liste-ligne">
                  <span className="mono petit">{jourHeure(s.instant, plan.fuseau)}</span>
                  <span className="petit extensible">
                    <span className="mono doux">{codeEpisode(s.episode, saisons.get(s.episode.saison_id))}</span> {nomEpisode(s.episode, saisons.get(s.episode.saison_id))}
                  </span>
                  <span className="ligne ligne--serree">
                    {s.publications.map((p) => (
                      <span key={p.compte.id} className="ligne ligne--serree tres-petit">
                        <BadgeReseau reseau={p.compte.reseau} />
                        {p.compte.nom_compte} · {p.langue.toUpperCase()}
                        {p.statut === "attend_rendu" ? " (attend le rendu)" : ""}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {plan.comptes.length ? (
              <form action={programmerEpisodesPrets}>
                <input type="hidden" name="serie_id" value={d.serie.id} />
                <BoutonEnvoi variante="principal" enCours="Programmation…">
                  {`Confirmer : programmer ${plan.sorties.length} épisode${plan.sorties.length > 1 ? "s" : ""}`}
                </BoutonEnvoi>
              </form>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="tags-h" className="carte">
        <form action={enregistrerHashtagsSerie} className="pile">
          <input type="hidden" name="id" value={d.serie.id} />
          <div>
            <h2 id="tags-h" className="h2">
              Hashtags par réseau
            </h2>
            <p className="tres-petit doux">Utilisés pour chaque épisode, sauf s’il a les siens. Champ vide : « {hashtagsParDefaut(d.serie.nom, d.serie.langue)} ». Les # et les doublons sont gérés à l’enregistrement.</p>
          </div>
          <div className="ligne ligne--haut">
            {RESEAUX.map((r) => (
              <CompteurHashtags key={r} nom={r} libelle={NOMS_RESEAUX[r]} valeur={d.serie.hashtags[r] ?? ""} max={MAX_HASHTAGS[r]} />
            ))}
          </div>
          <div>
            <BoutonEnvoi variante="principal">Enregistrer les hashtags</BoutonEnvoi>
          </div>
        </form>
      </section>
    </div>
  );
}
