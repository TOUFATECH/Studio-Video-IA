// Étape 4 : montage. Langues, sous-titres par version, musique, bruitages, accroche, miniatures, titres, rendu.
import { LANGUES, NOMS_LANGUES, formaterDuree, propositionsTitres } from "@studio-video-ia/core";
import Link from "next/link";
import { lienEpisode } from "@/lib/episodes";
import { choisirMiniature, choisirTitre, lancerRendu, modifierLangues, modifierMontage, modifierSousTitres } from "@/app/actions/episodes";
import { ImportFichier } from "@/components/ImportFichier";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Pastille, Puce } from "@/components/ui/elements";
import type { DonneesEpisode } from "./chargement";
import styles from "./episode.module.scss";

/** Étape Montage. */
export function EtapeMontage({ d }: { d: DonneesEpisode }) {
  const { episode, plans, personnages, index, urls, durees, serie } = d;
  const champ = <input type="hidden" name="episode_id" value={episode.id} />;
  const tache = d.taches.find((t) => t.type === "rendu");
  const clipsOk = plans.length > 0 && plans.every((p) => index.get(`${p.id}:clip:${p.prise_choisie}`)?.statut === "pret");
  // Épisode YouTube et film : tournés en 16:9, avec une bande annonce verticale.
  const long = episode.format !== "court" && episode.genre === "episode";
  // Voix Grok : le clip parle dans la langue d'origine, les autres versions n'auront pas cette réplique doublée.
  const grokParle = plans.some((p) => p.type === "dialogue" && personnages.find((c) => c.id === p.personnage_id)?.source_voix === "grok");
  const premier = plans[0];
  const accrocheOk = !!premier && premier.type === "accroche" && (durees.get(premier.id) ?? 99) <= 3;
  const miniatures = episode.miniature?.chemins ?? [];
  const bandeAnnonce = index.get("bande_annonce");
  // Clip musical : une seule version (la langue de la chanson), le son est la chanson elle-même.
  const clip = episode.genre === "clip";
  const horizontal = episode.format !== "court";
  const choixClip = episode.sous_titres[episode.langue] ?? "aucun";

  return (
    <div className="pile">
      <div className="colonnes">
        {clip ? (
          <section aria-labelledby="son-clip-h" className="carte pile pile--serree">
            <h2 id="son-clip-h" className="h2">
              Son et sous-titres
            </h2>
            <p className="petit">
              La chanson remplace le son des vidéos Grok
              {episode.extrait_fin !== null ? ` · extrait ${formaterDuree(episode.extrait_debut)} → ${formaterDuree(episode.extrait_fin)}` : ""}, avec un fondu à la fin.
            </p>
            <p className="petit">
              Sous-titres : {choixClip === "aucun" ? "aucun" : choixClip === episode.langue ? `les paroles (${NOMS_LANGUES[choixClip].toLowerCase()})` : `traduction en ${NOMS_LANGUES[choixClip].toLowerCase()}`}
            </p>
            <div>
              <Link href={lienEpisode(episode, "son")} className="btn btn--discret">
                Changer dans « Son et paroles »
              </Link>
            </div>
          </section>
        ) : (
        <section aria-labelledby="langues-h" className="carte pile">
          <div>
            <h2 id="langues-h" className="h2">
              Langues
            </h2>
            <p className="tres-petit doux">Les clips sont réutilisés : une langue de plus ne coûte que ses voix et ses sous-titres.</p>
          </div>
          <form action={modifierLangues} className="pile pile--serree">
            {champ}
            <fieldset className="segments">
              <legend className="invisible">Versions de l’épisode</legend>
              {LANGUES.map((l) => (
                <label key={l} className="segment" title={l === episode.langue ? "Langue d’origine : toujours incluse" : undefined}>
                  <input type="checkbox" name="langues" value={l} defaultChecked={episode.langues.includes(l)} disabled={l === episode.langue} />
                  {NOMS_LANGUES[l]}
                  {l === episode.langue ? " (origine)" : ""}
                </label>
              ))}
            </fieldset>
            <input type="hidden" name="langues" value={episode.langue} />
            <div>
              <BoutonEnvoi>Enregistrer les langues</BoutonEnvoi>
            </div>
          </form>
          {grokParle && episode.langues.length > 1 ? <p className="tres-petit texte-attention">Un personnage parle avec la voix Grok : sa réplique reste en {NOMS_LANGUES[episode.langue].toLowerCase()} dans toutes les versions (avec sous-titres si tu les choisis).</p> : null}
          <form action={modifierSousTitres} className="pile pile--serree">
            {champ}
            <p className="etiquette">Sous-titres incrustés : tu choisis la langue pour chaque version</p>
            {episode.langues.map((l) => (
              <div key={l} className="ligne ligne--sans-retour">
                <label className="petit mono" htmlFor={`st-${l}`} style={{ flex: "0 0 120px" }}>
                  Version {l.toUpperCase()}
                </label>
                <select id={`st-${l}`} name={`sous_titres_${l}`} defaultValue={episode.sous_titres[l] ?? "aucun"}>
                  <option value="aucun">Pas de sous-titres</option>
                  {LANGUES.map((x) => (
                    <option key={x} value={x}>
                      {NOMS_LANGUES[x]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div>
              <BoutonEnvoi>Enregistrer les sous-titres</BoutonEnvoi>
            </div>
          </form>
          <form action={modifierMontage} className="pile pile--serree">
            {champ}
            <label className="case">
              <input type="checkbox" name="musique" defaultChecked={episode.musique} />
              <span>Musique de fond</span>
            </label>
            <label className="case">
              <input type="checkbox" name="bruitages" defaultChecked={episode.bruitages} />
              <span>Bruitages ElevenLabs (pluie, pas, ville…)</span>
            </label>
            <div>
              <BoutonEnvoi>Enregistrer</BoutonEnvoi>
            </div>
          </form>
          <ImportFichier
            genre="musique"
            cible={serie.espace_id}
            libelle={`Musique du compte ${d.espace.nom} (${d.musiques.length} fichier${d.musiques.length > 1 ? "s" : ""})`}
            accepte="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a"
            aide="MP3, WAV ou M4A, 20 Mo maximum. Utilisée en fond pour tous les épisodes du compte. Vérifie que tu as les droits."
          />
        </section>
        )}

        <section aria-labelledby="accroche-h" className="carte pile">
          <h2 id="accroche-h" className="h2">
            Accroche et miniature
          </h2>
          <p className="ligne ligne--sans-retour ligne--haut petit">
            <Pastille ton={clip || accrocheOk ? "succes" : "attention"} />
            <span>{clip ? "Le premier plan démarre avec l’extrait : choisis un début d’extrait fort (refrain, montée) pour retenir dès la première seconde." : accrocheOk ? "Le premier plan est une accroche de 3 s : bien pour retenir dès la première seconde." : "Le premier plan devrait être une accroche de 3 s maximum : c’est ce qui retient sur TikTok et les Shorts."}</span>
          </p>
          <p className="etiquette">Miniature YouTube</p>
          {miniatures.length ? (
            <form action={choisirMiniature} className={styles.miniatures}>
              {champ}
              {miniatures.map((c, i) => {
                const url = urls.get(c);
                return (
                  <button key={c} type="submit" name="choix" value={i} className={styles.miniature} aria-pressed={episode.miniature?.choix === i} aria-label={`Miniature ${i + 1}`}>
                    {url ? <img src={url} alt="" /> : null}
                  </button>
                );
              })}
            </form>
          ) : (
            <p className="petit doux">Trois miniatures sont proposées avec le rendu.</p>
          )}
        </section>
      </div>

      <section aria-labelledby="titres-h" className="carte">
        <h2 id="titres-h" className="h2">
          Titres par langue
        </h2>
        <ul className="liste-nue">
          {episode.langues.map((l) => {
            const options = propositionsTitres(episode, serie, l);
            const choisi = episode.choix_titres[l] ?? 0;
            return (
              <li key={l} className="liste-ligne liste-ligne--haut">
                <span className="mono petit" style={{ flex: "0 0 36px", paddingTop: 12 }}>
                  {l.toUpperCase()}
                </span>
                <form action={choisirTitre} className="ligne ligne--serree extensible" aria-label={`Titre en ${NOMS_LANGUES[l].toLowerCase()}`}>
                  {champ}
                  <input type="hidden" name="langue" value={l} />
                  {options.map((t, i) => (
                    <button key={t} type="submit" name="choix" value={i} className="segment" aria-pressed={choisi === i} style={{ whiteSpace: "normal", textAlign: "left" }}>
                      {t}
                    </button>
                  ))}
                </form>
              </li>
            );
          })}
        </ul>
      </section>

      {long ? (
        <section className="carte pile pile--serree">
          <h2 className="h3">Bande annonce · 9:16</h2>
          {bandeAnnonce?.statut === "pret" && bandeAnnonce.chemin && urls.get(bandeAnnonce.chemin) ? (
            <video className={styles.lecteurRendu} src={urls.get(bandeAnnonce.chemin)} controls preload="none" playsInline aria-label="Bande annonce" />
          ) : (
            <p className="petit doux">Montée avec le rendu à partir des plans forts (1:00 maximum). Publiée sur TikTok et Instagram ; la version 16:9 entière part sur YouTube.</p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="rendu-h" className="carte pile pile--serree">
        <div className="ligne ligne--entre">
          <h2 id="rendu-h" className="h2">
            Rendu
          </h2>
          <form action={lancerRendu}>
            {champ}
            <BoutonEnvoi variante="principal" desactive={!clipsOk || !!tache}>
              {tache ? "Rendu en cours…" : "Lancer le rendu"}
            </BoutonEnvoi>
          </form>
        </div>
        {!clipsOk ? <p className="tres-petit texte-attention">{clip ? "Il manque des vidéos : termine l’étape Vidéos." : "Il manque des clips : termine l’étape Clips et voix."}</p> : null}
        <ul className="liste-nue">
          {episode.langues.map((l) => {
            const f = index.get(`rendu:${l}`);
            const url = f?.statut === "pret" && f.chemin ? urls.get(f.chemin) : undefined;
            const st = episode.sous_titres[l] ?? "aucun";
            return (
              <li key={l} className="liste-ligne liste-ligne--haut">
                <span className="mono petit" style={{ flex: "0 0 90px" }}>
                  Version {l.toUpperCase()}
                </span>
                <div className="extensible pile pile--serree">
                  <span className="petit">
                    Sous-titres : {st === "aucun" ? "aucun" : NOMS_LANGUES[st].toLowerCase()}
                    {f?.duree_s ? ` · ${formaterDuree(f.duree_s)}` : ""}
                  </span>
                  {f?.statut === "echec" ? <span className="tres-petit texte-erreur">{f.erreur ?? "Erreur inconnue"}</span> : null}
                  {url ? <video className={long || (clip && horizontal) ? styles.lecteurFilm : styles.lecteurRendu} src={url} controls preload="metadata" playsInline aria-label={`Rendu version ${NOMS_LANGUES[l]}`} /> : null}
                </div>
                <Puce ton={f?.statut === "pret" ? "succes" : f?.statut === "echec" ? "erreur" : tache ? "info" : "neutre"}>{f?.statut === "pret" ? "Prêt" : f?.statut === "echec" ? "Échec" : tache ? "En cours" : "À faire"}</Puce>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
