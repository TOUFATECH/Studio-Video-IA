// Étape 5 : publication. Version, comptes, livrable, date (maintenant, prochain créneau, date précise),
// légende par réseau avec hashtags modifiables, et suivi des publications de l'épisode.
import { MAX_HASHTAGS, MAX_LEGENDE, NOMS_LANGUES, NOMS_RESEAUX, RESEAUX, legende, libelleLivrable, livrablePour, prochainCreneau, schemaLangue, verifierDureePublication } from "@studio-video-ia/core";
import Link from "next/link";
import { annulerPublication, enregistrerHashtagsEpisode, publier, reessayerPublication } from "@/app/actions/episodes";
import { ecrireSuite } from "@/app/actions/series";
import { Copier } from "@/components/ui/Copier";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { BadgeReseau, Jauge, Puce } from "@/components/ui/elements";
import { saisieDepuisInstant } from "@/lib/dates";
import { lienEpisode } from "@/lib/episodes";
import { compact, jourHeure } from "@/lib/format";
import { statutCompte, statutPublication } from "@/lib/libelles";
import type { DonneesEpisode } from "./chargement";
import styles from "./episode.module.scss";

/** Notes affichées à côté des comptes, selon le réseau. */
const NOTES = {
  tiktok: "Sans audit TikTok validé, la vidéo reste privée.",
  instagram: "Compte professionnel requis · 100 publications par 24 h.",
  youtube: "Programmation native par YouTube · quota d’envoi journalier.",
} as const;

/** Étape Publication. `version` : langue choisie dans l'URL pour l'aperçu des légendes. */
export function EtapePublication({ d, version }: { d: DonneesEpisode; version: string | undefined }) {
  const { episode, serie, espace, etat, index, comptes } = d;
  const choixVersion = schemaLangue.safeParse(version);
  const langue = choixVersion.success && episode.langues.includes(choixVersion.data) ? choixVersion.data : episode.langue;
  const rendu = index.get(`rendu:${langue}`)?.statut === "pret";
  const maintenant = new Date();
  const futures = d.publications.filter((p) => (p.statut === "programmee" || p.statut === "attend_rendu") && Date.parse(p.programmee_le) > maintenant.getTime()).map((p) => Date.parse(p.programmee_le));
  // Approximation affichée : le serveur recalcule le créneau sur toute la série au moment de publier.
  const creneau = prochainCreneau(serie.rythme, futures.length ? new Date(Math.max(...futures)) : null, maintenant, espace.fuseau);
  const comptesParId = new Map(comptes.map((c) => [c.id, c]));
  const reseauxPresents = RESEAUX.filter((r) => comptes.some((c) => c.reseau === r));
  const reseauxLegende = reseauxPresents.length ? reseauxPresents : RESEAUX;

  return (
    <div className="pile">
      {etat.publiees > 0 && episode.genre === "episode" ? (
        <section className="carte carte--succes ligne">
          <div className="extensible" style={{ flex: "999 1 300px" }}>
            <p className="gras">Épisode publié.</p>
            <p className="tres-petit doux">La suite reprend la fin de cet épisode et les mystères encore ouverts.</p>
          </div>
          <form action={ecrireSuite}>
            <input type="hidden" name="serie_id" value={serie.id} />
            <BoutonEnvoi variante="principal">Écrire la suite</BoutonEnvoi>
          </form>
        </section>
      ) : null}
      {!rendu ? <p className="bandeau bandeau--info">Tu peux déjà programmer : la publication partira dès que le rendu de la version choisie sera prêt.</p> : null}

      <div className="colonnes">
        <section aria-labelledby="pub-h" className="carte principale">
          <form action={publier} className={`pile ${styles.formPublier}`}>
            <h2 id="pub-h" className="h2">
              Publier
            </h2>
            <input type="hidden" name="episode_id" value={episode.id} />
            <fieldset className="segments">
              <legend className="etiquette">Version</legend>
              {episode.langues.map((l) => (
                <label key={l} className="segment">
                  <input type="radio" name="langue" value={l} defaultChecked={l === langue} />
                  {NOMS_LANGUES[l]}
                </label>
              ))}
            </fieldset>
            <fieldset className="segments" style={{ flexDirection: "column", gap: 0 }}>
              <legend className="etiquette">Comptes de {espace.nom}</legend>
              {comptes.length === 0 ? (
                <p className="petit doux">
                  Aucun réseau connecté. <Link href={`/reglages?onglet=comptes&espace=${espace.id}`}>Connecter TikTok, Instagram ou YouTube</Link>
                </p>
              ) : null}
              {comptes.map((c) => {
                const st = statutCompte(c);
                const livrable = livrablePour(episode, c.reseau);
                // Durée réelle du rendu si elle existe, sinon la durée calculée de l'épisode.
                const fichierLivrable = index.get(livrable === "bande_annonce" ? "bande_annonce" : `rendu:${langue}`);
                const duree = fichierLivrable?.statut === "pret" && fichierLivrable.duree_s !== null ? Number(fichierLivrable.duree_s) : livrable === "bande_annonce" ? 60 : d.dureeTotale;
                const tropLong = verifierDureePublication({ reseau: c.reseau, livrable, format: episode.format, duree, genre: episode.genre });
                const ok = c.statut === "connecte" && !tropLong;
                return (
                  <label key={c.id} className="liste-ligne case">
                    <input type="checkbox" name="comptes" value={c.id} disabled={!ok} defaultChecked={ok && serie.rythme.reseaux.includes(c.id)} />
                    <BadgeReseau reseau={c.reseau} />
                    <span className="petit extensible">
                      {c.nom_compte}
                      <br />
                      <span className="tres-petit doux">
                        {libelleLivrable(livrable, c.reseau, episode.format, episode.genre)} · {NOTES[c.reseau]}
                      </span>
                      {tropLong ? (
                        <>
                          <br />
                          <span className="tres-petit texte-attention">{tropLong}</span>
                        </>
                      ) : null}
                    </span>
                    <span className="tres-petit mono doux">{c.langue.toUpperCase()}</span>
                    <Puce ton={st.ton}>{st.texte}</Puce>
                  </label>
                );
              })}
            </fieldset>
            <fieldset className="segments">
              <legend className="etiquette">Quand</legend>
              <label className="segment">
                <input type="radio" name="quand" value="maintenant" defaultChecked />
                Maintenant
              </label>
              <label className="segment">
                <input type="radio" name="quand" value="creneau" />
                Prochain créneau · {jourHeure(creneau, espace.fuseau)}
              </label>
              <label className="segment">
                <input type="radio" name="quand" value="date" />
                Date précise
              </label>
            </fieldset>
            <div className={`champ ${styles.choixDate}`} style={{ maxWidth: 280 }}>
              <label className="etiquette" htmlFor="p-date">
                Date et heure ({espace.fuseau})
              </label>
              <input id="p-date" name="date" type="datetime-local" defaultValue={saisieDepuisInstant(creneau, espace.fuseau)} />
            </div>
            <p className="tres-petit doux">YouTube : envoi en privé tout de suite, mise en ligne à l’heure par YouTube. TikTok et Instagram n’ont pas de programmation dans leur API : le worker publie à l’heure exacte, il doit être allumé.</p>
            <div>
              <BoutonEnvoi variante="principal" desactive={!comptes.some((c) => c.statut === "connecte")} enCours="Création…">
                Publier
              </BoutonEnvoi>
            </div>
          </form>
        </section>

        <section aria-labelledby="leg-h" className="carte pile">
          <div>
            <h2 id="leg-h" className="h2">
              Texte de la publication
            </h2>
            <p className="tres-petit doux">Titre choisi dans Montage. Hashtags de la série, sauf si tu les remplaces ici pour cet épisode.</p>
          </div>
          <nav className="ligne ligne--serree" aria-label="Version de l’aperçu">
            {episode.langues.map((l) => (
              <Link key={l} href={lienEpisode(episode, `publication&version=${l}`)} className="segment" aria-current={l === langue ? "true" : undefined}>
                {l.toUpperCase()}
              </Link>
            ))}
          </nav>
          {reseauxLegende.map((r) => {
            const lg = legende(episode, serie, langue, r);
            const trop = lg.description.length > MAX_LEGENDE[r];
            return (
              <div key={r} className="pile pile--serree">
                <p className="ligne ligne--serree">
                  <BadgeReseau reseau={r} />
                  <span className="gras petit">{NOMS_RESEAUX[r]}</span>
                  <span className={`tres-petit mono ${trop ? "texte-erreur" : "doux"}`}>
                    {lg.description.length} / {MAX_LEGENDE[r]}
                  </span>
                </p>
                <div className={`petit ${styles.legendeReseau}`}>{lg.description}</div>
                {trop ? (
                  <p className="tres-petit texte-erreur" role="alert">
                    Légende trop longue pour {NOMS_RESEAUX[r]} : retire des hashtags ou raccourcis le titre.
                  </p>
                ) : null}
                <Copier texte={lg.description} libelle={`Copier pour ${NOMS_RESEAUX[r]}`} />
                <form action={enregistrerHashtagsEpisode} className="ligne ligne--bas">
                  <input type="hidden" name="episode_id" value={episode.id} />
                  <input type="hidden" name="reseau" value={r} />
                  <div className="champ champ--large">
                    <label className="etiquette" htmlFor={`h-${r}`}>
                      Hashtags de cet épisode sur {NOMS_RESEAUX[r]} (max {MAX_HASHTAGS[r]}, vide = ceux de la série)
                    </label>
                    <input id={`h-${r}`} name="hashtags" type="text" defaultValue={episode.hashtags[r] ?? ""} placeholder={lg.tags} />
                  </div>
                  <BoutonEnvoi>Enregistrer</BoutonEnvoi>
                </form>
              </div>
            );
          })}
        </section>
      </div>

      <section aria-labelledby="liste-h" className="carte">
        <h2 id="liste-h" className="h2">
          Publications de cet épisode
        </h2>
        {d.publications.length === 0 ? <p className="petit doux marge-haut">Aucune pour l’instant.</p> : null}
        <ul className="liste-nue">
          {d.publications.map((p) => {
            const c = comptesParId.get(p.reseau_connecte_id);
            const st = statutPublication(p);
            return (
              <li key={p.id} className="liste-ligne">
                {c ? <BadgeReseau reseau={c.reseau} /> : null}
                <span className="petit extensible">
                  {c?.nom_compte ?? "Compte retiré"}
                  <br />
                  <span className="tres-petit doux">
                    {p.langue.toUpperCase()} · {c ? libelleLivrable(p.livrable, c.reseau, episode.format, episode.genre) : p.livrable}
                  </span>
                </span>
                <span className="mono tres-petit doux">{jourHeure(p.publiee_le ?? p.programmee_le, espace.fuseau)}</span>
                <Puce ton={st.ton}>{st.texte}</Puce>
                {p.statut === "envoi" ? (
                  <span style={{ flex: "0 0 100px" }}>
                    <Jauge pourcentage={p.progression} ton="info" libelle="Envoi" />
                  </span>
                ) : null}
                {p.stats.vues !== undefined ? (
                  <span className="mono tres-petit">
                    {compact(p.stats.vues)} vues · {compact(p.stats.jaime ?? 0)} j’aime
                  </span>
                ) : null}
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="btn btn--discret">
                    Voir
                  </a>
                ) : null}
                {["attend_rendu", "programmee", "echec"].includes(p.statut) ? (
                  <form action={annulerPublication}>
                    <input type="hidden" name="publication_id" value={p.id} />
                    <BoutonEnvoi variante="discret">Annuler</BoutonEnvoi>
                  </form>
                ) : null}
                {p.statut === "echec" ? (
                  <form action={reessayerPublication}>
                    <input type="hidden" name="publication_id" value={p.id} />
                    <BoutonEnvoi>Réessayer</BoutonEnvoi>
                  </form>
                ) : null}
                {p.erreur && p.statut === "echec" ? (
                  <span className="tres-petit texte-erreur" style={{ flexBasis: "100%" }}>
                    {p.erreur}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
