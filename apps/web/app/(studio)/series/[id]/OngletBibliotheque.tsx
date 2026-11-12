// Onglet « Bibliothèque » : ce qui garde les mêmes visages et les mêmes décors dans tous les épisodes.
// Personnages (photos, visages proposés par l'IA), décors (photos et vidéos du vrai lieu), activités, marque, sons
// et variantes, avec l'endroit où chaque fiche apparaît. Une photo d'une vraie personne exige son accord.
import { GENRES_ELEMENT, VOIX_GROK, type Element, type Fichier, type GenreElement, type Plan } from "@studio-video-ia/core";
import Link from "next/link";
import { ajouterElement, choisirFiche, creerPersonnageDecrit, modifierElement, supprimerElement, supprimerReference } from "@/app/actions/bibliotheque";
import { genererFiche } from "@/app/actions/series";
import { ImportFichier } from "@/components/ImportFichier";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Puce } from "@/components/ui/elements";
import { codeEpisode } from "@/lib/episodes";
import { urlsSignees } from "@/lib/medias";
import type { DonneesSerie } from "./chargement";

/** Types acceptés à l'import d'une photo ou vidéo de référence. */
const ACCEPTE_REFERENCE = "image/png,image/jpeg,image/webp,video/mp4,video/quicktime,.mp4,.mov";
const AIDE_REFERENCE = "Photo PNG, JPG ou WebP (15 Mo) ou vidéo MP4 ou MOV (60 Mo), depuis le téléphone ou l’ordinateur. Redressée et recadrée automatiquement.";

/** Ordre et textes d'aide des sections de la bibliothèque. */
const SECTIONS: { genre: GenreElement; aide: string }[] = [
  { genre: "decor", aide: "Photos et vidéos du vrai lieu (salon, façade, rue) : données à l’IA avec chaque plan pour que le lieu soit le vrai." },
  { genre: "variante", aide: "« Avant la coupe », « tenue de soirée », « capuche cachant tous les cheveux » : une référence à part, choisie par plan." },
  { genre: "activite", aide: "Ce que fait le personnage (couper, jouer à la PS5, danser) : un modèle de consigne de mouvement réutilisable." },
  { genre: "marque", aide: "Logo (PNG transparent), couleurs, police : logo posé sur chaque vidéo et carte de fin." },
  { genre: "son", aide: "Musique, ambiance, bruitages à réutiliser (notes pour l’IA ; la musique d’épisode s’importe dans Réglages)." },
];

/** Où apparaît une fiche : codes d'épisode et numéros de plans. */
function apparitions(d: DonneesSerie, test: (p: Plan) => boolean): { total: number; texte: string } {
  const saisons = new Map(d.saisons.map((s) => [s.id, s]));
  const parties: string[] = [];
  let total = 0;
  for (const e of d.episodes) {
    const plans = (d.plansPar.get(e.id) ?? []).slice().sort((a, b) => a.position - b.position);
    const nums = plans.map((p, i) => (test(p) ? i + 1 : 0)).filter(Boolean);
    if (nums.length) {
      total += nums.length;
      parties.push(`${codeEpisode(e, saisons.get(e.saison_id))} P${nums.join(", P")}`);
    }
  }
  return { total, texte: parties.slice(0, 6).join(" · ") + (parties.length > 6 ? " …" : "") };
}

/** Vignettes des photos et vidéos de référence, avec bouton pour en retirer une. */
function Galerie({ fichiers, urls, nom }: { fichiers: readonly Fichier[]; urls: Map<string, string>; nom: string }) {
  if (!fichiers.length) return <p className="tres-petit doux">Aucune photo pour l’instant.</p>;
  return (
    <div className="ligne ligne--serree" role="list" aria-label={`Photos de ${nom}`}>
      {fichiers.map((f) => {
        const url = f.chemin ? urls.get(f.chemin) : undefined;
        const video = /\.(mp4|mov)$/i.test(f.chemin ?? "");
        return (
          <form key={f.id} action={supprimerReference} role="listitem" className="pile pile--serree" style={{ width: 84 }}>
            <input type="hidden" name="fichier_id" value={f.id} />
            {url ? video ? <video src={url} muted playsInline preload="metadata" style={{ width: 84, borderRadius: 6 }} aria-label={f.nom_origine || "Vidéo"} /> : <img src={url} alt={f.nom_origine || `Photo de ${nom}`} loading="lazy" style={{ width: 84, borderRadius: 6 }} /> : null}
            {f.personne_reelle ? <span className="tres-petit texte-succes">accord ✓</span> : null}
            <BoutonEnvoi variante="discret" libelleAria={`Retirer ${f.nom_origine || "la photo"}`}>
              Retirer
            </BoutonEnvoi>
          </form>
        );
      })}
    </div>
  );
}

/** Carte d'un élément de la bibliothèque. */
function CarteElement({ d, el, photos, urls }: { d: DonneesSerie; el: Element; photos: readonly Fichier[]; urls: Map<string, string> }) {
  const usage = apparitions(d, (p) => p.decor_id === el.id || p.activite_id === el.id || p.variantes.includes(el.id));
  const perso = el.personnage_id ? d.personnages.find((c) => c.id === el.personnage_id) : undefined;
  return (
    <article className="carte pile pile--serree">
      <div className="ligne ligne--entre">
        <p className="gras">
          {perso ? `${perso.nom} · ` : ""}
          {el.nom}
        </p>
        {el.serie_id === null ? <Puce ton="info">Partagé</Puce> : null}
      </div>
      <Galerie fichiers={photos} urls={urls} nom={el.nom} />
      <form action={modifierElement} className="pile pile--serree">
        <input type="hidden" name="id" value={el.id} />
        <input type="hidden" name="serie_id" value={d.serie.id} />
        <div className="champ">
          <label className="etiquette" htmlFor={`el-n-${el.id}`}>
            Nom
          </label>
          <input id={`el-n-${el.id}`} name="nom" type="text" maxLength={120} required defaultValue={el.nom} />
        </div>
        <div className="champ">
          <label className="etiquette" htmlFor={`el-d-${el.id}`}>
            Description
          </label>
          <textarea id={`el-d-${el.id}`} name="description" rows={2} maxLength={4000} defaultValue={el.description} />
        </div>
        {el.genre === "decor" ? (
          <div className="champ">
            <label className="etiquette" htmlFor={`el-m-${el.id}`}>
              Moment
            </label>
            <input id={`el-m-${el.id}`} name="moment" type="text" maxLength={80} defaultValue={el.moment} placeholder="jour, nuit…" />
          </div>
        ) : (
          <input type="hidden" name="moment" value={el.moment} />
        )}
        {el.genre === "activite" ? (
          <div className="champ">
            <label className="etiquette" htmlFor={`el-c-${el.id}`}>
              Consigne de mouvement
            </label>
            <input id={`el-c-${el.id}`} name="consigne" type="text" maxLength={2000} defaultValue={el.consigne} placeholder="La tondeuse avance par petits passages, les cheveux tombent" />
          </div>
        ) : (
          <input type="hidden" name="consigne" value={el.consigne} />
        )}
        {el.genre === "marque" ? (
          <div className="ligne ligne--bas">
            <div className="champ">
              <label className="etiquette" htmlFor={`el-p-${el.id}`}>
                Couleur principale
              </label>
              <input id={`el-p-${el.id}`} name="principale" type="color" defaultValue={el.couleurs.principale ?? "#000000"} />
            </div>
            <div className="champ">
              <label className="etiquette" htmlFor={`el-s-${el.id}`}>
                Couleur secondaire
              </label>
              <input id={`el-s-${el.id}`} name="secondaire" type="color" defaultValue={el.couleurs.secondaire ?? "#ffffff"} />
            </div>
            <div className="champ">
              <label className="etiquette" htmlFor={`el-f-${el.id}`}>
                Police
              </label>
              <input id={`el-f-${el.id}`} name="police" type="text" maxLength={80} defaultValue={el.couleurs.police ?? ""} />
            </div>
          </div>
        ) : null}
        {el.genre !== "variante" ? (
          <label className="case tres-petit">
            <input type="checkbox" name="partage" defaultChecked={el.serie_id === null} />
            <span>Partager avec toutes les séries du compte</span>
          </label>
        ) : null}
        <div>
          <BoutonEnvoi>Enregistrer</BoutonEnvoi>
        </div>
      </form>
      <ImportFichier
        genre="reference"
        cible={el.id}
        cibleType="element"
        libelle={el.genre === "marque" ? "Ajouter le logo (PNG transparent)" : "Ajouter une photo ou une vidéo"}
        accepte={el.genre === "marque" ? "image/png,image/webp,image/jpeg" : ACCEPTE_REFERENCE}
        aide={el.genre === "marque" ? "PNG transparent conseillé, 15 Mo maximum." : AIDE_REFERENCE}
        droitImage={el.genre === "variante" || el.genre === "decor"}
      />
      <p className="tres-petit doux">{usage.total ? `Utilisé dans ${usage.total} plan${usage.total > 1 ? "s" : ""} : ${usage.texte}` : "Pas encore utilisé dans un plan."}</p>
      <form action={supprimerElement}>
        <input type="hidden" name="id" value={el.id} />
        <BoutonEnvoi variante="danger" libelleAria={`Retirer ${el.nom}`}>
          Retirer
        </BoutonEnvoi>
      </form>
    </article>
  );
}

/** Bibliothèque de la série. */
export async function OngletBibliotheque({ d }: { d: DonneesSerie }) {
  const urls = await urlsSignees([...d.references.map((f) => f.chemin), ...d.fichesProposees.map((f) => f.chemin), ...d.personnages.map((p) => p.fiche_chemin)]);
  const photosDe = (cible: { personnage_id?: string; element_id?: string }) =>
    d.references.filter((f) => f.statut === "pret" && (cible.personnage_id ? f.personnage_id === cible.personnage_id : f.element_id === cible.element_id));
  const fichesEnFile = new Set(d.fiches.filter((t) => t.type === "fiche_personnage").map((t) => String(t.donnees.personnage_id ?? "")));
  return (
    <div className="pile pile--large">
      <section aria-labelledby="bib-perso-h" className="pile">
        <div>
          <h2 id="bib-perso-h" className="h2">
            Personnages
          </h2>
          <p className="tres-petit doux">
            1 à 10 photos ou dessins par personnage. L’IA en tire une image de référence (face, profil, plein pied) réutilisée dans chaque plan. Nom, caractère et voix se règlent dans{" "}
            <Link href={`/series/${d.serie.id}?onglet=bible`}>Bible et personnages</Link>.
          </p>
        </div>
        <form action={creerPersonnageDecrit} className="carte ligne ligne--bas">
          <input type="hidden" name="serie_id" value={d.serie.id} />
          <div className="champ">
            <label className="etiquette" htmlFor="np-nom">
              Nouveau personnage
            </label>
            <input id="np-nom" name="nom" type="text" maxLength={80} required placeholder="Zaydo" />
          </div>
          <div className="champ champ--large">
            <label className="etiquette" htmlFor="np-desc">
              Description (âge, rôle, caractère, tenue)
            </label>
            <input id="np-desc" name="description" type="text" minLength={5} maxLength={3000} required placeholder="Barbier de 30 ans, barbe taillée, t-shirt noir du QG, rieur" />
          </div>
          <BoutonEnvoi variante="principal">Proposer 4 visages</BoutonEnvoi>
        </form>
        <div className="grille-cartes">
          {d.personnages.map((p) => {
            const photos = photosDe({ personnage_id: p.id });
            const visages = d.fichesProposees.filter((f) => f.personnage_id === p.id && f.statut === "pret" && f.chemin);
            const usage = apparitions(d, (x) => x.personnage_id === p.id || x.personnages.includes(p.id));
            const enCours = p.fiche_statut === "en_cours" || fichesEnFile.has(p.id);
            return (
              <article key={p.id} className="carte pile pile--serree">
                <div className="ligne ligne--entre">
                  <p className="gras">{p.nom}</p>
                  <span className="tres-petit doux">{p.source_voix === "grok" ? `Voix Grok · ${VOIX_GROK[p.voix_id as keyof typeof VOIX_GROK]?.split(" · ")[0] ?? p.voix_id}` : "Voix ElevenLabs"}</span>
                </div>
                <p className="tres-petit doux">{p.description || "Pas encore de description."}</p>
                <span className="etiquette">Visages proposés {enCours ? "· génération en cours…" : ""}</span>
                {visages.length ? (
                  <div className="ligne ligne--serree">
                    {visages.slice(0, 8).map((v) => {
                      const url = v.chemin ? urls.get(v.chemin) : undefined;
                      const retenu = v.chemin === p.fiche_chemin;
                      return (
                        <form key={v.id} action={choisirFiche} className="pile pile--serree" style={{ width: 120 }}>
                          <input type="hidden" name="fichier_id" value={v.id} />
                          {url ? <img src={url} alt={`Visage proposé pour ${p.nom}`} loading="lazy" style={{ width: 120, borderRadius: 6, outline: retenu ? "2px solid var(--couleur-accent, #FF6A3D)" : undefined }} /> : null}
                          <BoutonEnvoi variante="discret" desactive={retenu}>
                            {retenu ? "Retenu" : "Choisir"}
                          </BoutonEnvoi>
                        </form>
                      );
                    })}
                  </div>
                ) : (
                  <p className="tres-petit doux">Aucun visage : ajoute des photos puis génère la fiche.</p>
                )}
                <form action={genererFiche} className="ligne ligne--serree">
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="propositions" value="4" />
                  <BoutonEnvoi desactive={enCours}>{visages.length ? "Proposer 4 autres visages" : "Proposer 4 visages"}</BoutonEnvoi>
                </form>
                <span className="etiquette">Photos et dessins ({photos.length}/10)</span>
                <Galerie fichiers={photos} urls={urls} nom={p.nom} />
                {photos.length < 10 ? <ImportFichier genre="reference" cible={p.id} cibleType="personnage" libelle="Ajouter une photo ou un dessin" accepte={ACCEPTE_REFERENCE} aide={AIDE_REFERENCE} droitImage /> : null}
                <p className="tres-petit doux">{usage.total ? `Apparaît dans ${usage.total} plan${usage.total > 1 ? "s" : ""} : ${usage.texte}` : "N’apparaît encore dans aucun plan."}</p>
                <p className="tres-petit doux">Une fiche modifiée sert aux plans futurs ; refais les plans déjà faits (Storyboard → Refaire) si tu veux les mettre à jour.</p>
              </article>
            );
          })}
        </div>
      </section>

      {SECTIONS.map(({ genre, aide }) => {
        const liste = d.elements.filter((e) => e.genre === genre);
        return (
          <section key={genre} aria-labelledby={`bib-${genre}-h`} className="pile">
            <div className="ligne ligne--entre ligne--bas">
              <div>
                <h2 id={`bib-${genre}-h`} className="h2">
                  {GENRES_ELEMENT[genre]}s
                </h2>
                <p className="tres-petit doux">{aide}</p>
              </div>
              <form action={ajouterElement} className="ligne ligne--serree ligne--bas">
                <input type="hidden" name="serie_id" value={d.serie.id} />
                <input type="hidden" name="genre" value={genre} />
                {genre === "variante" ? (
                  <select name="personnage_id" required aria-label="Personnage de la variante" defaultValue="">
                    <option value="" disabled>
                      Personnage…
                    </option>
                    {d.personnages.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nom}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="hidden" name="personnage_id" value="" />
                )}
                <input name="nom" type="text" maxLength={120} required placeholder={genre === "decor" ? "Salon O’QG" : genre === "variante" ? "Capuche cachant les cheveux" : "Nom"} aria-label={`Nom du nouvel élément (${GENRES_ELEMENT[genre].toLowerCase()})`} />
                <BoutonEnvoi desactive={genre === "variante" && !d.personnages.length}>Ajouter</BoutonEnvoi>
              </form>
            </div>
            {liste.length === 0 ? <p className="carte petit doux vide">Rien pour l’instant.</p> : null}
            <div className="grille-cartes">
              {liste.map((el) => (
                <CarteElement key={el.id} d={d} el={el} photos={photosDe({ element_id: el.id })} urls={urls} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
