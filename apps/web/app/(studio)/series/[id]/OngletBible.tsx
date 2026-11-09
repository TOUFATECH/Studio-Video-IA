// Onglet « Bible » : univers, fil rouge, style, langue, fil de l'histoire et personnages (fiche de référence, voix).
import { listerVoix } from "@studio-video-ia/integrations";
import { ajouterPersonnage, genererFiche, modifierBible, modifierPersonnage, supprimerPersonnage } from "@/app/actions/series";
import { ChoixVoix, type OptionVoix } from "@/components/ChoixVoix";
import { ImportFichier } from "@/components/ImportFichier";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Puce } from "@/components/ui/elements";
import { lireCle } from "@/lib/cles";
import { codeEpisode, ordreLecture } from "@/lib/episodes";
import { OPTIONS_LANGUES } from "@/lib/libelles";
import { urlsSignees } from "@/lib/medias";
import { STYLES_VISUELS } from "@/lib/schemas";
import type { DonneesSerie } from "./chargement";
import styles from "./serie.module.scss";

/** Voix ElevenLabs du compte, ou null si la clé manque ou si la liste est indisponible. */
async function voixDisponibles(proprietaire: string): Promise<OptionVoix[] | null> {
  try {
    const cle = await lireCle(proprietaire, "elevenlabs");
    if (!cle) return null;
    return (await listerVoix(cle)).map((v) => ({ id: v.id, nom: v.nom, categorie: v.categorie }));
  } catch {
    // Clé invalide, réseau coupé ou intégration absente : on retombe sur la saisie libre de l'ID.
    return null;
  }
}

/** Bible de la série. */
export async function OngletBible({ d }: { d: DonneesSerie }) {
  const [voix, urls] = await Promise.all([voixDisponibles(d.user.id), urlsSignees(d.personnages.map((p) => p.fiche_chemin))]);
  // Deux personnages avec la même voix ElevenLabs : on prévient (la voix Grok dépend du clip, elle n'est pas comparée).
  const parVoix = new Map<string, string[]>();
  for (const p of d.personnages) {
    if (p.source_voix === "grok" || !p.voix_id.trim()) continue;
    parVoix.set(p.voix_id, [...(parVoix.get(p.voix_id) ?? []), p.nom]);
  }
  const doublons = [...parVoix.values()].filter((noms) => noms.length > 1);
  const enDouble = new Set(doublons.flat());
  const saisons = new Map(d.saisons.map((s) => [s.id, s]));
  const fil = ordreLecture(d.episodes, d.saisons);
  const fichesEnFile = new Set(d.fiches.filter((t) => t.type === "fiche_personnage").map((t) => String(t.donnees.personnage_id ?? "")));
  const clonesEnFile = new Set(d.fiches.filter((t) => t.type === "clone_voix").map((t) => String(t.donnees.personnage_id ?? "")));

  return (
    <div className="pile pile--large">
      <div className="colonnes">
        <section aria-label="Univers" className="carte">
          <form action={modifierBible} className="pile">
            <input type="hidden" name="id" value={d.serie.id} />
            <div className="champ">
              <label className="etiquette" htmlFor="b-nom">
                Nom de la série
              </label>
              <input id="b-nom" name="nom" type="text" defaultValue={d.serie.nom} required maxLength={120} />
            </div>
            <div className="champ">
              <label className="etiquette" htmlFor="b-univers">
                Univers et règles qui ne changent jamais
              </label>
              <textarea id="b-univers" name="univers" rows={4} defaultValue={d.serie.univers} placeholder="Ex. : les animaux parlent entre eux, jamais aux humains." />
            </div>
            <div className="champ">
              <label className="etiquette" htmlFor="b-fil">
                Fil rouge des saisons
              </label>
              <textarea id="b-fil" name="fil_rouge" rows={3} defaultValue={d.serie.fil_rouge} />
            </div>
            <div className="ligne ligne--bas">
              <div className="champ">
                <label className="etiquette" htmlFor="b-style">
                  Style visuel
                </label>
                <select id="b-style" name="style_visuel" defaultValue={d.serie.style_visuel}>
                  {STYLES_VISUELS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="champ">
                <label className="etiquette" htmlFor="b-langue">
                  Langue d’origine
                </label>
                <select id="b-langue" name="langue" defaultValue={d.serie.langue}>
                  {OPTIONS_LANGUES.map((l) => (
                    <option key={l.valeur} value={l.valeur}>
                      {l.libelle}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <BoutonEnvoi variante="principal">Enregistrer la bible</BoutonEnvoi>
            </div>
          </form>
        </section>
        <section aria-labelledby="fil-h" className="carte">
          <h2 id="fil-h" className="h2">
            Le fil de l’histoire
          </h2>
          {fil.length === 0 ? <p className="petit doux marge-haut">Aucun épisode écrit.</p> : null}
          <ul className="liste-nue">
            {fil.map((e) => {
              const plans = d.plansPar.get(e.id) ?? [];
              const fin = [...plans].sort((a, b) => a.position - b.position).at(-1);
              return (
                <li key={e.id} className="liste-ligne liste-ligne--haut">
                  <span className="mono tres-petit doux">{codeEpisode(e, saisons.get(e.saison_id))}</span>
                  <div className="extensible">
                    <p className="petit gras">{e.titre || `Épisode ${e.numero}`}</p>
                    <p className="tres-petit doux">Finit sur : {fin?.texte ?? "pas encore écrit"}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section aria-labelledby="perso-h" className="pile">
        <div className="ligne ligne--entre">
          <div>
            <h2 id="perso-h" className="h2">
              Personnages, fiches de référence et voix
            </h2>
            <p className="tres-petit doux">La fiche de référence est envoyée avec chaque image : le personnage garde le même visage d’un épisode à l’autre.</p>
          </div>
          <form action={ajouterPersonnage}>
            <input type="hidden" name="serie_id" value={d.serie.id} />
            <BoutonEnvoi>+ Personnage</BoutonEnvoi>
          </form>
        </div>
        {doublons.length ? (
          <p className="bandeau bandeau--attention" role="alert">
            Même voix pour {doublons.map((n) => n.join(" et ")).join(" ; ")}. Donne une voix différente à chacun, sinon on ne sait plus qui parle.
          </p>
        ) : null}
        {voix === null ? <p className="tres-petit doux">Ajoute la clé ElevenLabs dans Réglages pour choisir les voix dans une liste.</p> : null}
        <div className="grille-cartes">
          {d.personnages.map((p) => {
            const url = p.fiche_chemin ? urls.get(p.fiche_chemin) : undefined;
            const enCours = p.fiche_statut === "en_cours" || fichesEnFile.has(p.id);
            return (
              <article key={p.id} className="carte pile">
                <div className="ligne ligne--haut ligne--sans-retour">
                  <div className={`apercu-media apercu-media--vertical ${styles.fiche}`}>
                    {url ? <img src={url} alt={`Fiche de référence de ${p.nom}`} /> : <span className="tres-petit doux">Pas de fiche</span>}
                  </div>
                  <div className="pile pile--serree extensible">
                    <p className="gras">{p.nom}</p>
                    <p className="tres-petit doux">
                      {enCours ? "Fiche en cours de génération…" : p.fiche_statut === "prete" ? "Fiche prête : face, profil, dos" : p.fiche_statut === "echec" ? "La fiche a échoué : relance-la." : "Pas encore de fiche de référence"}
                    </p>
                    <form action={genererFiche}>
                      <input type="hidden" name="id" value={p.id} />
                      <BoutonEnvoi desactive={enCours}>{p.fiche_statut === "prete" ? "Refaire la fiche" : "Générer la fiche"}</BoutonEnvoi>
                    </form>
                    {enDouble.has(p.nom) ? <Puce ton="attention">Voix en double</Puce> : null}
                  </div>
                </div>
                <form action={modifierPersonnage} className="pile pile--serree">
                  <input type="hidden" name="id" value={p.id} />
                  <div className="champ">
                    <label className="etiquette" htmlFor={`pn-${p.id}`}>
                      Nom
                    </label>
                    <input id={`pn-${p.id}`} name="nom" type="text" defaultValue={p.nom} required maxLength={80} />
                  </div>
                  <div className="champ">
                    <label className="etiquette" htmlFor={`pd-${p.id}`}>
                      Apparence et caractère
                    </label>
                    <textarea id={`pd-${p.id}`} name="description" rows={2} defaultValue={p.description} />
                  </div>
                  <ChoixVoix prefixe={`pv-${p.id}`} source={p.source_voix} voixId={p.voix_id} accord={p.accord_clone} voix={voix} />
                  <div className="ligne">
                    <BoutonEnvoi variante="principal">Enregistrer</BoutonEnvoi>
                  </div>
                </form>
                {p.source_voix === "elevenlabs_clone" && p.accord_clone ? (
                  <ImportFichier
                    genre="echantillon_voix"
                    cible={p.id}
                    libelle={clonesEnFile.has(p.id) ? "Clonage en cours… Ajouter un autre échantillon" : "Échantillon de voix à cloner"}
                    accepte="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a"
                    aide="MP3, WAV ou M4A, 20 Mo maximum. Une à deux minutes de parole claire, sans musique."
                  />
                ) : null}
                <ImportFichier genre="fiche" cible={p.id} libelle="Ou importer ta propre image de référence" accepte="image/png,image/jpeg,image/webp" aide="PNG, JPG ou WebP, 10 Mo maximum. Remplace la fiche actuelle." />
                <form action={supprimerPersonnage}>
                  <input type="hidden" name="id" value={p.id} />
                  <BoutonEnvoi variante="danger" libelleAria={`Retirer ${p.nom}`}>
                    Retirer
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
