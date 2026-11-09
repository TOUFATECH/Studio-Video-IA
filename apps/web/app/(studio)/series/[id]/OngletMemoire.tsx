// Onglet « Mémoire » : faits retenus par épisode, mystères ouverts ou résolus, ajout et suppression.
import { ajouterFait, basculerMystere, supprimerFait } from "@/app/actions/series";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Puce } from "@/components/ui/elements";
import { codeEpisode, ordreLecture } from "@/lib/episodes";
import type { DonneesSerie } from "./chargement";

/** Libellé et ton de chaque genre de fait. */
const GENRES = {
  fait: { libelle: "Fait", ton: "neutre" },
  personnage: { libelle: "Personnage", ton: "secondaire" },
  lieu: { libelle: "Lieu", ton: "info" },
  objet: { libelle: "Objet", ton: "succes" },
  mystere: { libelle: "Mystère", ton: "attention" },
} as const;

/** Mémoire de la série. */
export function OngletMemoire({ d }: { d: DonneesSerie }) {
  const episodes = new Map(d.episodes.map((e) => [e.id, e]));
  const saisons = new Map(d.saisons.map((s) => [s.id, s]));
  const ouverts = d.memoire.filter((m) => m.genre === "mystere" && m.ouvert);
  const fil = ordreLecture(d.episodes, d.saisons);
  return (
    <div className="colonnes">
      <section aria-labelledby="mem-h" className="carte principale">
        <h2 id="mem-h" className="h2">
          Mémoire de la série
        </h2>
        <p className="tres-petit doux">Mise à jour après chaque rendu si l’option est active dans Réglages. Tout ce qui est ici est donné à l’IA avant d’écrire un épisode.</p>
        {d.memoire.length === 0 ? <p className="petit doux marge-haut">Rien encore : la mémoire se remplit au premier épisode rendu.</p> : null}
        <ul className="liste-nue">
          {d.memoire.map((m) => {
            const ep = m.episode_id ? episodes.get(m.episode_id) : undefined;
            const g = GENRES[m.genre];
            return (
              <li key={m.id} className="liste-ligne">
                <span className="mono tres-petit doux">{ep ? codeEpisode(ep, saisons.get(ep.saison_id)) : "—"}</span>
                <Puce ton={m.genre === "mystere" && !m.ouvert ? "succes" : g.ton}>{m.genre === "mystere" ? (m.ouvert ? "Mystère ouvert" : "Mystère résolu") : g.libelle}</Puce>
                <span className="petit extensible">{m.texte}</span>
                {m.genre === "mystere" ? (
                  <form action={basculerMystere}>
                    <input type="hidden" name="id" value={m.id} />
                    <BoutonEnvoi variante="discret">{m.ouvert ? "Marquer résolu" : "Rouvrir"}</BoutonEnvoi>
                  </form>
                ) : null}
                <form action={supprimerFait}>
                  <input type="hidden" name="id" value={m.id} />
                  <BoutonEnvoi variante="discret" libelleAria={`Retirer : ${m.texte}`}>
                    Retirer
                  </BoutonEnvoi>
                </form>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="ajout-h" className="carte">
        <form action={ajouterFait} className="pile">
          <h2 id="ajout-h" className="h2">
            Ajouter un fait
          </h2>
          <input type="hidden" name="serie_id" value={d.serie.id} />
          <div className="champ">
            <label className="etiquette" htmlFor="m-genre">
              Type
            </label>
            <select id="m-genre" name="genre" defaultValue="fait">
              <option value="fait">Fait</option>
              <option value="personnage">Personnage</option>
              <option value="lieu">Lieu</option>
              <option value="objet">Objet</option>
              <option value="mystere">Mystère à résoudre</option>
            </select>
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor="m-ep">
              Épisode concerné
            </label>
            <select id="m-ep" name="episode_id" defaultValue={fil.at(-1)?.id ?? ""}>
              <option value="">Aucun en particulier</option>
              {fil.map((e) => (
                <option key={e.id} value={e.id}>
                  {codeEpisode(e, saisons.get(e.saison_id))} · {e.titre}
                </option>
              ))}
            </select>
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor="m-texte">
              Ce qu’il faut retenir
            </label>
            <textarea id="m-texte" name="texte" rows={3} required minLength={3} maxLength={1000} placeholder="Ex. : Kaï a perdu son foulard bleu." />
          </div>
          <BoutonEnvoi variante="principal">Ajouter à la mémoire</BoutonEnvoi>
          <div className="pile pile--serree" style={{ borderTop: "1px solid var(--couleur-bordure)", paddingTop: 12 }}>
            <p className="etiquette">Mystères ouverts</p>
            <p className="petit">{ouverts.length ? ouverts.map((m) => m.texte).join(" · ") : "Aucun."}</p>
          </div>
        </form>
      </section>
    </div>
  );
}
