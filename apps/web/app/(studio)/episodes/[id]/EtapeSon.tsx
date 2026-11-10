// Étape 1 d'un clip : son et paroles. Paroles (saisies ou écrites par l'IA), chanson importée ou générée,
// synchronisation des paroles dans la chanson, réglages du clip (format, extrait, tempo, sous-titres) et découpage.
import { DUREE_MAX_CLIP, LANGUES, NOMS_FORMATS_CLIP, NOMS_FOURNISSEURS_TEXTE, NOMS_LANGUES, extraitClip, formaterDuree, formaterTemps, type FormatEpisode } from "@studio-video-ia/core";
import Link from "next/link";
import { decouperClip, ecrireParoles, enregistrerReglagesClip, enregistrerSonParoles, genererMusique, synchroniserParoles } from "@/app/actions/clips";
import { ImportChanson } from "@/components/ImportChanson";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Jauge } from "@/components/ui/elements";
import { euros } from "@/lib/format";
import { OPTIONS_LANGUES } from "@/lib/libelles";
import { utilisateur } from "@/lib/session";
import type { DonneesEpisode } from "./chargement";
import styles from "./episode.module.scss";

/** Exemple affiché dans la zone des paroles. */
const EXEMPLE_PAROLES = "[Couplet 1]\nJe marche seul dans la nuit\nLes néons dansent sous la pluie\n\n[Refrain]\nOn s’envole ce soir…";

/** Étape Son et paroles d'un clip. */
export async function EtapeSon({ d }: { d: DonneesEpisode }) {
  const { episode, serie, fichiers, urls } = d;
  const champ = <input type="hidden" name="episode_id" value={episode.id} />;
  const chanson = [...fichiers].filter((f) => f.genre === "chanson" && f.statut === "pret" && f.chemin).sort((a, b) => b.cree_le.localeCompare(a.cree_le))[0];
  const urlChanson = chanson?.chemin ? urls.get(chanson.chemin) : undefined;
  const dureeChanson = chanson?.duree_s ?? null;
  const tacheSon = d.taches.find((t) => t.type === "paroles" || t.type === "musique" || t.type === "synchro");
  const decoupage = d.taches.find((t) => t.type === "scenario");
  const echec = !tacheSon ? d.recentes.find((t) => (t.type === "paroles" || t.type === "musique" || t.type === "synchro") && t.statut === "echec") : undefined;
  const lignes = episode.paroles_alignees;
  const extrait = dureeChanson ? extraitClip(episode, dureeChanson) : null;
  const max = DUREE_MAX_CLIP[episode.format];
  const dureeMusique = episode.format === "court" ? 90 : Math.min(max, 180);
  const coutMusique = (dureeMusique / 60) * d.reglages.tarifs.musique_minute;
  const choixSousTitres = episode.sous_titres[episode.langue] ?? "aucun";
  // Clés présentes (seulement le nom du fournisseur : les valeurs ne sont jamais lisibles ici).
  const { db } = await utilisateur();
  const { data: cles } = await db.from("cles_api").select("fournisseur");
  const fournisseurs = new Set((cles ?? []).map((c) => String(c.fournisseur)));
  const progression = tacheSon?.progression;

  return (
    <div className="pile">
      {tacheSon ? (
        <section className="carte pile pile--serree" aria-live="polite">
          <p className="gras">{tacheSon.type === "musique" ? "Composition de la musique" : tacheSon.type === "paroles" ? "Écriture des paroles" : "Synchronisation des paroles"}{tacheSon.statut === "en_file" ? " · en file" : tacheSon.statut === "en_pause" ? " · en pause (budget)" : "…"}</p>
          <Jauge pourcentage={progression?.total ? (100 * (progression.fait ?? 0)) / progression.total : 5} ton="info" libelle="Avancement" />
          {progression?.etape ? <p className="tres-petit doux">{progression.etape}</p> : null}
        </section>
      ) : null}
      {echec ? (
        <p className="bandeau bandeau--erreur" role="alert">
          {echec.type === "musique" ? "La musique" : echec.type === "paroles" ? "L’écriture des paroles" : "La synchronisation"} a échoué : {echec.erreur ?? "erreur inconnue"}.
        </p>
      ) : null}

      <div className="colonnes">
        <section aria-labelledby="paroles-h" className="carte">
          <form action={enregistrerSonParoles} className="pile">
            <input type="hidden" name="id" value={episode.id} />
            <h2 id="paroles-h" className="h2">
              Paroles
            </h2>
            <div className="ligne ligne--bas">
              <div className="champ">
                <label className="etiquette" htmlFor="s-langue">
                  Langue de la chanson
                </label>
                <select id="s-langue" name="langue" defaultValue={episode.langue}>
                  {OPTIONS_LANGUES.map((l) => (
                    <option key={l.valeur} value={l.valeur}>
                      {l.libelle}
                    </option>
                  ))}
                </select>
              </div>
              <label className="case extensible">
                <input type="checkbox" name="instrumental" defaultChecked={episode.instrumental} />
                <span>Instrumental (pas de chant)</span>
              </label>
            </div>
            <div className="champ">
              <label className="etiquette" htmlFor="s-paroles">
                Paroles · une ligne par phrase chantée, [Refrain] pour marquer une section
              </label>
              <textarea id="s-paroles" name="paroles" rows={14} defaultValue={episode.paroles} maxLength={20000} placeholder={EXEMPLE_PAROLES} className="mono" />
              <span className="tres-petit doux">Sans paroles, elles seront reconnues dans ta chanson à la synchronisation.</span>
            </div>
            <div className="champ">
              <label className="etiquette" htmlFor="s-style">
                Style musical (pour générer la musique)
              </label>
              <input id="s-style" name="musique_style" type="text" maxLength={500} defaultValue={episode.musique_style} placeholder="Ex. : synthpop, voix féminine, 110 BPM, mélancolique" />
              <span className="tres-petit doux">Pas de nom d’artiste ni de chanson existante : ElevenLabs les refuse.</span>
            </div>
            <fieldset className="segments">
              <legend className="etiquette">IA pour les paroles et les scènes</legend>
              {(["openai", "anthropic"] as const).map((f) => (
                <label key={f} className="segment">
                  <input type="radio" name="fournisseur_texte" value={f} defaultChecked={episode.fournisseur_texte === f} />
                  {NOMS_FOURNISSEURS_TEXTE[f]}
                  {!fournisseurs.has(f) ? " (clé à ajouter)" : ""}
                </label>
              ))}
            </fieldset>
            {episode.fournisseur_texte === "anthropic" && !fournisseurs.has("anthropic") ? (
              <p className="tres-petit texte-attention">
                Ajoute ta clé Claude dans <Link href="/reglages?onglet=cles">Réglages → Clés API</Link>.
              </p>
            ) : null}
            <div className="ligne">
              <BoutonEnvoi>Enregistrer</BoutonEnvoi>
            </div>
          </form>
          <form action={ecrireParoles} className="ligne marge-haut">
            {champ}
            <BoutonEnvoi variante="discret" desactive={!!tacheSon}>
              Écrire les paroles avec {NOMS_FOURNISSEURS_TEXTE[episode.fournisseur_texte]}
            </BoutonEnvoi>
            <span className="tres-petit doux">À partir du titre, de l’idée et du style. Remplace le texte actuel.</span>
          </form>
        </section>

        <section aria-labelledby="chanson-h" className="carte pile">
          <h2 id="chanson-h" className="h2">
            La chanson
          </h2>
          {urlChanson ? (
            <div className="pile pile--serree">
              <audio src={urlChanson} controls preload="metadata" className={styles.lecteurAudio} aria-label="Écouter la chanson" />
              <p className="tres-petit doux">
                {dureeChanson ? `Durée ${formaterDuree(dureeChanson)}` : "Durée connue après la synchronisation"}
                {chanson && chanson.cout > 0 ? ` · générée (${euros(chanson.cout)})` : " · importée"}
              </p>
            </div>
          ) : (
            <p className="petit doux">Pas encore de chanson : importe la tienne, ou génère-la à partir des paroles.</p>
          )}
          <ImportChanson clip={episode.id} dejaUne={!!chanson} />
          <form action={genererMusique} className="pile pile--serree" style={{ borderTop: "1px solid var(--couleur-bordure)", paddingTop: 14 }}>
            {champ}
            <p className="etiquette">Ou la générer avec ElevenLabs Music</p>
            <div className="ligne ligne--bas">
              <div className="champ">
                <label className="etiquette" htmlFor="s-duree">
                  Durée (secondes)
                </label>
                <input id="s-duree" name="duree" type="number" min={10} max={600} step={5} defaultValue={dureeMusique} required />
              </div>
              <BoutonEnvoi variante={chanson ? "discret" : "principal"} desactive={!!tacheSon}>
                {chanson ? "Regénérer la musique" : "Générer la musique"}
              </BoutonEnvoi>
            </div>
            <p className="tres-petit doux">
              Chante tes paroles dans le style choisi (ou instrumental). Environ {euros(coutMusique)} pour {formaterDuree(dureeMusique)} au tarif saisi. Les paroles sont ensuite placées automatiquement.
            </p>
          </form>
        </section>
      </div>

      <section aria-labelledby="synchro-h" className="carte pile pile--serree">
        <div className="ligne ligne--entre">
          <h2 id="synchro-h" className="h2">
            Paroles dans la chanson
          </h2>
          <form action={synchroniserParoles}>
            {champ}
            <BoutonEnvoi variante={lignes === null && chanson ? "principal" : "discret"} desactive={!chanson || !!tacheSon}>
              {lignes === null ? "Synchroniser" : "Resynchroniser"}
            </BoutonEnvoi>
          </form>
        </div>
        {lignes === null ? (
          <p className="petit doux">{chanson ? "Pas encore synchronisées : chaque ligne sera placée à son moment dans la chanson." : "Ajoute la chanson pour placer les paroles."}</p>
        ) : lignes.length === 0 ? (
          <p className="petit doux">Musique instrumentale : le clip sera découpé sur le tempo.</p>
        ) : (
          <ol className={`liste-nue ${styles.paroles}`}>
            {lignes.map((l, i) => {
              const dedans = !extrait || (l.fin > extrait.debut && l.debut < extrait.fin);
              return (
                <li key={`${i}-${l.debut}`} className={`ligne ligne--sans-retour petit ${dedans ? "" : "doux"}`}>
                  <span className="mono tres-petit" style={{ flex: "0 0 112px" }}>
                    {formaterTemps(l.debut)} → {formaterTemps(l.fin)}
                  </span>
                  <span>{l.texte}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby="reglages-clip-h" className="carte">
        <form action={enregistrerReglagesClip} className="pile">
          <input type="hidden" name="id" value={episode.id} />
          <h2 id="reglages-clip-h" className="h2">
            Le clip
          </h2>
          <div className="ligne ligne--bas">
            <div className="champ champ--large">
              <label className="etiquette" htmlFor="c-titre">
                Titre
              </label>
              <input id="c-titre" name="titre" type="text" maxLength={200} defaultValue={episode.titre} />
            </div>
            <div className="champ champ--large">
              <label className="etiquette" htmlFor="c-style">
                Style visuel
              </label>
              <input id="c-style" name="style_visuel" type="text" maxLength={500} defaultValue={episode.style_visuel} placeholder={serie.style_visuel || "Ex. : néons, pluie, film 35 mm"} />
            </div>
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor="c-idee">
              Idée du clip (ce qu’on raconte en images)
            </label>
            <textarea id="c-idee" name="idee" rows={3} defaultValue={episode.idee} maxLength={6000} placeholder="Ex. : une danseuse traverse la ville la nuit, de plus en plus libre à chaque refrain" />
          </div>
          <fieldset className="segments">
            <legend className="etiquette">Format</legend>
            {(Object.keys(NOMS_FORMATS_CLIP) as FormatEpisode[]).map((f) => (
              <label key={f} className="segment">
                <input type="radio" name="format" value={f} defaultChecked={episode.format === f} />
                {NOMS_FORMATS_CLIP[f]}
              </label>
            ))}
          </fieldset>
          <div className="ligne ligne--bas">
            <div className="champ">
              <label className="etiquette" htmlFor="c-debut">
                Début de l’extrait (s)
              </label>
              <input id="c-debut" name="extrait_debut" type="number" min={0} step={0.1} defaultValue={episode.extrait_debut} required />
            </div>
            <div className="champ">
              <label className="etiquette" htmlFor="c-fin">
                Fin (s, vide = au plus long)
              </label>
              <input id="c-fin" name="extrait_fin" type="number" min={0} step={0.1} defaultValue={episode.extrait_fin ?? ""} />
            </div>
            <div className="champ">
              <label className="etiquette" htmlFor="c-bpm">
                Tempo (BPM, facultatif)
              </label>
              <input id="c-bpm" name="bpm" type="number" min={40} max={240} step={0.1} defaultValue={episode.bpm ?? ""} placeholder="ex. 110" />
            </div>
            <div className="champ">
              <label className="etiquette" htmlFor="c-st">
                Sous-titres
              </label>
              <select id="c-st" name="sous_titres" defaultValue={choixSousTitres}>
                <option value="aucun">Pas de sous-titres</option>
                <option value={episode.langue}>Les paroles ({NOMS_LANGUES[episode.langue].toLowerCase()})</option>
                {LANGUES.filter((l) => l !== episode.langue).map((l) => (
                  <option key={l} value={l}>
                    Traduction en {NOMS_LANGUES[l].toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="tres-petit doux">
            {extrait ? `Extrait utilisé : ${formaterTemps(extrait.debut)} → ${formaterTemps(extrait.fin)} (${formaterDuree(extrait.fin - extrait.debut)}). ` : ""}
            {formaterDuree(max)} maximum pour ce format. Avec le tempo, les coupes tombent sur le temps.
          </p>
          <div>
            <BoutonEnvoi>Enregistrer</BoutonEnvoi>
          </div>
        </form>
        <form action={decouperClip} className="ligne marge-haut">
          {champ}
          <BoutonEnvoi variante="principal" desactive={lignes === null || !!decoupage || !!tacheSon}>
            {decoupage ? "Découpage en cours…" : d.plans.length ? "Redécouper" : "Découper et écrire les scènes"}
          </BoutonEnvoi>
          <span className="tres-petit doux">
            {lignes === null
              ? "Synchronise d’abord les paroles."
              : d.plans.length
                ? "Remplace les plans et efface leurs images et vidéos."
                : `Un plan par phrase chantée ; ${NOMS_FOURNISSEURS_TEXTE[episode.fournisseur_texte]} écrit ce qu’on voit.`}
          </span>
        </form>
      </section>
    </div>
  );
}
