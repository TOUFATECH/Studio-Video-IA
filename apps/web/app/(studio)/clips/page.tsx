// Espace Clips : clips musicaux du compte (chanson importée ou générée, images et vidéos calées sur les paroles).
import { formaterDuree, NOMS_FORMATS_CLIP, NOMS_LANGUES, type FormatEpisode } from "@studio-video-ia/core";
import type { Metadata } from "next";
import Link from "next/link";
import { creerClip, modifierEspaceClips } from "@/app/actions/clips";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Jauge, PastilleEspace, Puce } from "@/components/ui/elements";
import { chargerProduction } from "@/lib/donnees";
import { lienEpisode, nomEpisode } from "@/lib/episodes";
import { OPTIONS_LANGUES } from "@/lib/libelles";
import { parametre } from "@/lib/schemas";

export const metadata: Metadata = { title: "Clips" };

/** Les quatre temps d'un clip, affichés tant que l'espace est vide ou à la création. */
const ETAPES_CLIP = [
  { titre: "Son et paroles", texte: "Importe ta chanson ou génère-la avec ElevenLabs. Les paroles sont placées à la syllabe près dans la musique." },
  { titre: "Découpage", texte: "Un plan par phrase chantée, calé sur le tempo. ChatGPT ou Claude écrit ce qu’on voit à chaque moment." },
  { titre: "Images et vidéos", texte: "ChatGPT dessine chaque plan, Grok l’anime, sans son : seule ta chanson s’entend." },
  { titre: "Montage et publication", texte: "Montage sur la chanson, paroles en sous-titres si tu veux, puis TikTok, Instagram et YouTube." },
];

/** Page « Clips ». */
export default async function PageClips({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const prod = await chargerProduction();
  const { portee } = prod;
  const creation = parametre(p.nouveau) === "1";
  const espaces = new Map(portee.espaces.map((e) => [e.id, e]));
  const espacesClips = prod.series.filter((s) => s.genre === "clips");
  const idsClips = new Set(espacesClips.map((s) => s.id));
  const clips = prod.episodes.filter((e) => e.genre === "clip" && idsClips.has(e.serie_id)).sort((a, b) => b.cree_le.localeCompare(a.cree_le));
  const serieDe = new Map(espacesClips.map((s) => [s.id, s]));

  return (
    <div className="pile pile--large">
      <header className="ligne ligne--entre ligne--bas">
        <div>
          <p className="surtitre">{portee.courant?.nom ?? "Tous mes comptes"}</p>
          <h1 className="h1">Clips</h1>
        </div>
        {!creation ? (
          <Link href="/clips?nouveau=1" className="btn btn--principal">
            Nouveau clip
          </Link>
        ) : null}
      </header>

      {creation ? (
        <section aria-labelledby="nc-h" className="carte carte--accent">
          <form action={creerClip} className="pile">
            <h2 id="nc-h" className="h2">
              Nouveau clip
            </h2>
            <div className="ligne ligne--bas">
              <div className="champ champ--large">
                <label className="etiquette" htmlFor="nc-titre">
                  Titre de la chanson
                </label>
                <input id="nc-titre" name="titre" type="text" maxLength={200} placeholder="Ex. : Néons sous la pluie" />
              </div>
              <div className="champ">
                <label className="etiquette" htmlFor="nc-espace">
                  Compte
                </label>
                <select id="nc-espace" name="espace_id" defaultValue={portee.courant?.id ?? portee.espaces[0]?.id}>
                  {portee.espaces.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nom}
                    </option>
                  ))}
                </select>
              </div>
              <div className="champ">
                <label className="etiquette" htmlFor="nc-langue">
                  Langue de la chanson
                </label>
                <select id="nc-langue" name="langue" defaultValue="fr">
                  {OPTIONS_LANGUES.map((l) => (
                    <option key={l.valeur} value={l.valeur}>
                      {l.libelle}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <fieldset className="segments">
              <legend className="etiquette">Format</legend>
              {(Object.keys(NOMS_FORMATS_CLIP) as FormatEpisode[]).map((f) => (
                <label key={f} className="segment">
                  <input type="radio" name="format" value={f} defaultChecked={f === "court"} />
                  {NOMS_FORMATS_CLIP[f]}
                </label>
              ))}
            </fieldset>
            <fieldset className="segments">
              <legend className="etiquette">La musique</legend>
              <label className="segment">
                <input type="radio" name="source" value="importer" defaultChecked />
                J’ai déjà la chanson
              </label>
              <label className="segment">
                <input type="radio" name="source" value="generer" />
                La générer avec ElevenLabs
              </label>
            </fieldset>
            <div className="ligne">
              <BoutonEnvoi variante="principal" enCours="Création…">
                Créer le clip
              </BoutonEnvoi>
              <Link href="/clips" className="btn btn--discret">
                Annuler
              </Link>
            </div>
          </form>
        </section>
      ) : null}

      {clips.length === 0 || creation ? (
        <section aria-label="Comment ça marche" className="grille-cartes">
          {ETAPES_CLIP.map((e, i) => (
            <div key={e.titre} className="carte pile pile--serree">
              <p className="surtitre">Étape {i + 1}</p>
              <h2 className="h3">{e.titre}</h2>
              <p className="petit doux">{e.texte}</p>
            </div>
          ))}
        </section>
      ) : null}

      {clips.length === 0 && !creation ? (
        <div className="carte vide">
          <p className="h2">Aucun clip sur ce compte</p>
          <p className="petit doux">Un clip part d’une chanson : la tienne, ou une musique générée à partir de tes paroles.</p>
          <Link href="/clips?nouveau=1" className="btn btn--principal">
            Créer un clip
          </Link>
        </div>
      ) : null}

      {clips.length ? (
        <div className="grille-cartes">
          {clips.map((c) => {
            const etat = prod.etats.get(c.id);
            const serie = serieDe.get(c.serie_id);
            const espace = serie ? espaces.get(serie.espace_id) : undefined;
            const duree = c.extrait_fin !== null ? c.extrait_fin - c.extrait_debut : null;
            return (
              <article key={c.id} className="carte pile">
                <div className="ligne ligne--entre ligne--haut">
                  <div>
                    <h2 className="h2">{nomEpisode(c, undefined)}</h2>
                    <p className="tres-petit doux">
                      {NOMS_FORMATS_CLIP[c.format].split(" · ")[0]} · {duree !== null ? formaterDuree(duree) : "durée à venir"} · {NOMS_LANGUES[c.langue]}
                    </p>
                  </div>
                  {espace && !portee.courant ? (
                    <span className="puce">
                      <PastilleEspace couleur={espace.couleur} />
                      &nbsp;{espace.nom}
                    </span>
                  ) : null}
                </div>
                {etat ? (
                  <div className="pile pile--serree">
                    <div className="ligne ligne--entre">
                      <Puce ton={etat.ton}>{etat.statut}</Puce>
                      <span className="tres-petit mono doux">{etat.pourcentage} %</span>
                    </div>
                    <Jauge pourcentage={etat.pourcentage} libelle={`Avancement de ${nomEpisode(c, undefined)}`} />
                  </div>
                ) : null}
                <div className="ligne">
                  <Link href={lienEpisode(c, etat?.etape)} className="btn btn--principal">
                    {etat?.action ?? "Ouvrir"}
                  </Link>
                  <Link href={lienEpisode(c)} className="btn btn--discret">
                    Ouvrir
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {espacesClips.length ? (
        <section aria-labelledby="ec-h" className="pile">
          <h2 id="ec-h" className="h2">
            Nom et style par défaut
          </h2>
          <div className="grille-cartes">
            {espacesClips.map((s) => (
              <form key={s.id} action={modifierEspaceClips} className="carte pile">
                <input type="hidden" name="serie_id" value={s.id} />
                {!portee.courant ? <p className="surtitre">{espaces.get(s.espace_id)?.nom}</p> : null}
                <div className="champ">
                  <label className="etiquette" htmlFor={`ec-nom-${s.id}`}>
                    Nom d’artiste (titres « Nom — Titre »)
                  </label>
                  <input id={`ec-nom-${s.id}`} name="nom" type="text" required maxLength={120} defaultValue={s.nom} />
                </div>
                <div className="champ">
                  <label className="etiquette" htmlFor={`ec-style-${s.id}`}>
                    Style visuel par défaut
                  </label>
                  <input id={`ec-style-${s.id}`} name="style_visuel" type="text" maxLength={500} defaultValue={s.style_visuel} />
                  <span className="tres-petit doux">Chaque clip peut avoir le sien dans son étape « Son et paroles ».</span>
                </div>
                <div>
                  <BoutonEnvoi>Enregistrer</BoutonEnvoi>
                </div>
              </form>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
