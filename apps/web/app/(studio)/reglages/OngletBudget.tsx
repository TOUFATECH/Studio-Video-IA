// Onglet « Budget » : tarifs servant aux estimations et plafond mensuel de chaque espace avec sa jauge.
import { enregistrerTarifs, modifierPlafond } from "@/app/actions/reglages";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Jauge, PastilleEspace } from "@/components/ui/elements";
import type { Portee } from "@/lib/espace-courant";
import { euros } from "@/lib/format";
import { chargerReglages } from "@/lib/reglages";
import { utilisateur } from "@/lib/session";

/** Tarifs et plafonds. */
export async function OngletBudget({ portee }: { portee: Portee }) {
  const { tarifs } = await chargerReglages();
  const { supabase } = await utilisateur();
  const depenses = await Promise.all(portee.espaces.map(async (e) => Number((await supabase.rpc("depense_du_mois", { e: e.id })).data ?? 0) || 0));
  return (
    <div className="colonnes">
      <section aria-labelledby="tarifs-h" className="carte">
        <form action={enregistrerTarifs} className="pile">
          <h2 id="tarifs-h" className="h2">
            Tarifs
          </h2>
          <p className="tres-petit texte-attention">Valeurs d’exemple : remplace-les par les prix de tes abonnements API.</p>
          <div className="champ">
            <label className="etiquette" htmlFor="t-image">
              Image (€ par image)
            </label>
            <input id="t-image" name="image" type="number" step="0.001" min="0" defaultValue={tarifs.image} required />
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor="t-video">
              Vidéo Grok (€ par seconde)
            </label>
            <input id="t-video" name="video_seconde" type="number" step="0.001" min="0" defaultValue={tarifs.video_seconde} required />
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor="t-voix">
              Voix ElevenLabs (€ pour 1 000 caractères)
            </label>
            <input id="t-voix" name="voix_1000_car" type="number" step="0.001" min="0" defaultValue={tarifs.voix_1000_car} required />
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor="t-musique">
              Musique ElevenLabs (€ par minute, clips)
            </label>
            <input id="t-musique" name="musique_minute" type="number" step="0.001" min="0" defaultValue={tarifs.musique_minute} required />
          </div>
          <div>
            <BoutonEnvoi variante="principal">Enregistrer les tarifs</BoutonEnvoi>
          </div>
        </form>
      </section>
      <section aria-labelledby="plafond-h" className="carte principale">
        <h2 id="plafond-h" className="h2">
          Plafond mensuel par compte
        </h2>
        <p className="tres-petit doux">Au-delà, la file de ce compte se met en pause. Alerte à 80 %.</p>
        <ul className="liste-nue">
          {portee.espaces.map((e, i) => {
            const depense = depenses[i] ?? 0;
            const part = e.plafond_mensuel ? depense / e.plafond_mensuel : 0;
            return (
              <li key={e.id} className="liste-ligne">
                <PastilleEspace couleur={e.couleur} />
                <span className="petit gras" style={{ flex: "1 1 140px" }}>
                  {e.nom}
                </span>
                <div style={{ flex: "1 1 180px" }}>
                  <Jauge pourcentage={100 * part} ton={part >= 1 ? "erreur" : part >= 0.8 ? "attention" : "succes"} libelle={`Budget de ${e.nom}`} />
                  <p className="tres-petit mono doux">
                    {euros(depense)} sur {euros(e.plafond_mensuel)}
                  </p>
                </div>
                <form action={modifierPlafond} className="ligne ligne--bas">
                  <input type="hidden" name="id" value={e.id} />
                  <div className="champ champ--etroit">
                    <label className="etiquette" htmlFor={`p-${e.id}`}>
                      Plafond €
                    </label>
                    <input id={`p-${e.id}`} name="plafond_mensuel" type="number" min="0" step="5" defaultValue={e.plafond_mensuel} required />
                  </div>
                  <BoutonEnvoi>OK</BoutonEnvoi>
                </form>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
