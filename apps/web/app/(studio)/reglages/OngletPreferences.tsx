// Onglet « Préférences » : générations en parallèle, sous-titres et prises par défaut, mémoire automatique, thème.
import { cookies } from "next/headers";
import { enregistrerPreferences } from "@/app/actions/reglages";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { chargerReglages } from "@/lib/reglages";

/** Préférences générales. */
export async function OngletPreferences() {
  const { preferences } = await chargerReglages();
  const theme = (await cookies()).get("theme")?.value === "clair" ? "clair" : "sombre";
  // Les sous-titres par défaut proposés ici se limitent à Aucun, Français, Anglais.
  const sousTitres = preferences.sous_titres === "fr" || preferences.sous_titres === "en" ? preferences.sous_titres : "aucun";
  return (
    <section aria-label="Préférences" className="carte">
      <form action={enregistrerPreferences} className="pile">
        <div className="ligne ligne--bas">
          <div className="champ">
            <label className="etiquette" htmlFor="pf-par">
              Générations en parallèle
            </label>
            <select id="pf-par" name="parallele" defaultValue={String(preferences.parallele)}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor="pf-st">
              Sous-titres par défaut
            </label>
            <select id="pf-st" name="sous_titres" defaultValue={sousTitres}>
              <option value="aucun">Aucun</option>
              <option value="fr">Français</option>
              <option value="en">Anglais</option>
            </select>
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor="pf-prises">
              Prises par plan par défaut
            </label>
            <select id="pf-prises" name="prises" defaultValue={String(preferences.prises)}>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor="pf-theme">
              Thème
            </label>
            <select id="pf-theme" name="theme" defaultValue={theme}>
              <option value="sombre">Sombre</option>
              <option value="clair">Clair</option>
            </select>
          </div>
        </div>
        <label className="case">
          <input type="checkbox" name="memoire_auto" defaultChecked={preferences.memoire_auto} />
          <span>Mettre à jour la mémoire après chaque rendu</span>
        </label>
        <h2 className="h3">Génération des images</h2>
        <div className="ligne ligne--bas">
          <div className="champ">
            <label className="etiquette" htmlFor="pf-prop">
              Propositions d’image par plan
            </label>
            <select id="pf-prop" name="propositions" defaultValue={String(preferences.propositions)}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor="pf-plafond">
              Confirmation au-delà de (€ par épisode)
            </label>
            <input id="pf-plafond" name="plafond_episode" type="number" min={0} max={10000} step={1} defaultValue={preferences.plafond_episode} style={{ width: 140 }} />
          </div>
        </div>
        <label className="case">
          <input type="checkbox" name="controle_qualite" defaultChecked={preferences.controle_qualite} />
          <span>Contrôle qualité de chaque image par l’IA (personnages, visages, décor, texte parasite) ; un plan douteux est signalé en orange</span>
        </label>
        <div>
          <BoutonEnvoi variante="principal">Enregistrer</BoutonEnvoi>
        </div>
      </form>
    </section>
  );
}
