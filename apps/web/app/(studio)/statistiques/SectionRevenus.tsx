// Section « Ce que ça a rapporté » : revenus du mois et des 12 derniers mois, par réseau et par compte,
// avec la saisie manuelle pour TikTok et Instagram (pas d'API de revenus chez eux).
import { NOMS_RESEAUX, RESEAUX, type Reseau, type ReseauConnecte, type Revenu } from "@studio-video-ia/core";
import { enregistrerRevenu, supprimerRevenu } from "@/app/actions/statistiques";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { BadgeReseau, Kpi } from "@/components/ui/elements";
import { agregerRevenus, texteParDevise } from "@/lib/statistiques";

/** Devises proposées à la saisie. */
const DEVISES = ["EUR", "USD", "GBP", "JPY", "KRW", "BRL", "CHF", "CAD"];

/** Explication quand les revenus YouTube ne sont pas lisibles (texte écrit par le worker dans infos.revenus). */
function revenusIndisponibles(c: ReseauConnecte): boolean {
  const v = c.infos.revenus;
  return typeof v === "string" && v.toLowerCase().startsWith("indisponible");
}

/** Revenus des comptes affichés. `reseau` : limite à un réseau (onglet), sinon tous. */
export function SectionRevenus({ comptes, revenus, moisCourant, reseau }: { comptes: ReseauConnecte[]; revenus: Revenu[]; moisCourant: string; reseau: Reseau | null }) {
  const agregat = agregerRevenus(revenus, comptes, moisCourant);
  const reseaux = reseau ? [reseau] : RESEAUX.filter((r) => comptes.some((c) => c.reseau === r));
  const manuels = comptes.filter((c) => c.reseau !== "youtube");
  const saisies = revenus.filter((r) => r.source === "manuel" && manuels.some((c) => c.id === r.reseau_connecte_id)).sort((a, b) => b.mois.localeCompare(a.mois));
  const youtubeBloques = comptes.filter((c) => c.reseau === "youtube" && revenusIndisponibles(c));
  const noms = new Map(comptes.map((c) => [c.id, c]));

  return (
    <section aria-labelledby="rev-h" className="carte pile">
      <div>
        <h2 id="rev-h" className="h2">
          Ce que ça a rapporté
        </h2>
        <p className="tres-petit doux">YouTube : lu par l’API. TikTok et Instagram n’ont pas d’API de revenus : saisis le montant de chaque mois depuis leur tableau de bord.</p>
      </div>
      <div className="grille-kpi">
        <Kpi libelle="Ce mois-ci" valeur={texteParDevise(agregat.moisCourant)} />
        <Kpi libelle="12 derniers mois" valeur={texteParDevise(agregat.douzeMois)} />
      </div>
      {comptes.length === 0 ? <p className="petit doux">Aucun compte connecté.</p> : null}
      <ul className="liste-nue">
        {reseaux.map((r) => (
          <li key={r} className="liste-ligne liste-ligne--haut">
            <BadgeReseau reseau={r} />
            <div className="extensible pile pile--serree">
              <p className="petit">
                <span className="gras">{NOMS_RESEAUX[r]}</span> · ce mois-ci <span className="mono">{texteParDevise(agregat.parReseau[r]?.mois ?? {})}</span> · 12 mois{" "}
                <span className="mono">{texteParDevise(agregat.parReseau[r]?.douzeMois ?? {})}</span>
              </p>
              {comptes
                .filter((c) => c.reseau === r)
                .map((c) => (
                  <p key={c.id} className="tres-petit doux">
                    {c.nom_compte} : ce mois-ci <span className="mono">{texteParDevise(agregat.parCompte[c.id]?.mois ?? {})}</span> · 12 mois <span className="mono">{texteParDevise(agregat.parCompte[c.id]?.douzeMois ?? {})}</span>
                  </p>
                ))}
            </div>
          </li>
        ))}
      </ul>
      {youtubeBloques.length ? (
        <p className="bandeau bandeau--attention">
          Revenus indisponibles pour {youtubeBloques.map((c) => c.nom_compte).join(", ")} : la chaîne n’est pas monétisée (Programme Partenaire YouTube), ou il faut la reconnecter dans Réglages pour accorder l’accès aux revenus.
        </p>
      ) : null}
      {manuels.length ? (
        <div className="pile">
          <form action={enregistrerRevenu} className="ligne ligne--bas" aria-label="Saisir un revenu">
            <div className="champ">
              <label className="etiquette" htmlFor="rv-compte">
                Compte
              </label>
              <select id="rv-compte" name="reseau_connecte_id" required>
                {manuels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {NOMS_RESEAUX[c.reseau]} · {c.nom_compte}
                  </option>
                ))}
              </select>
            </div>
            <div className="champ champ--etroit">
              <label className="etiquette" htmlFor="rv-mois">
                Mois
              </label>
              <input id="rv-mois" name="mois" type="month" defaultValue={moisCourant} required />
            </div>
            <div className="champ champ--etroit">
              <label className="etiquette" htmlFor="rv-montant">
                Montant
              </label>
              <input id="rv-montant" name="montant" type="number" min="0" step="0.01" required />
            </div>
            <div className="champ champ--etroit">
              <label className="etiquette" htmlFor="rv-devise">
                Devise
              </label>
              <select id="rv-devise" name="devise" defaultValue="EUR">
                {DEVISES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </div>
            <div className="champ">
              <label className="etiquette" htmlFor="rv-note">
                Note
              </label>
              <input id="rv-note" name="note" type="text" maxLength={300} placeholder="Ex. : Creator Rewards" />
            </div>
            <BoutonEnvoi variante="principal">Enregistrer</BoutonEnvoi>
          </form>
          {saisies.length ? (
            <ul className="liste-nue">
              {saisies.map((s) => {
                const c = noms.get(s.reseau_connecte_id);
                return (
                  <li key={s.id} className="liste-ligne">
                    <form action={enregistrerRevenu} className="ligne ligne--bas extensible" aria-label={`Modifier ${s.mois.slice(0, 7)}`}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="reseau_connecte_id" value={s.reseau_connecte_id} />
                      {c ? <BadgeReseau reseau={c.reseau} /> : null}
                      <span className="petit" style={{ flex: "0 1 140px" }}>
                        {c?.nom_compte}
                      </span>
                      <input name="mois" type="month" defaultValue={s.mois.slice(0, 7)} aria-label="Mois" style={{ width: 150 }} required />
                      <input name="montant" type="number" min="0" step="0.01" defaultValue={s.montant} aria-label="Montant" style={{ width: 120 }} required />
                      <input name="devise" type="text" defaultValue={s.devise} aria-label="Devise" maxLength={3} style={{ width: 80 }} required />
                      <input name="note" type="text" defaultValue={s.note} aria-label="Note" maxLength={300} className="extensible" />
                      <BoutonEnvoi>Modifier</BoutonEnvoi>
                    </form>
                    <form action={supprimerRevenu}>
                      <input type="hidden" name="id" value={s.id} />
                      <BoutonEnvoi variante="danger" libelleAria={`Supprimer la saisie de ${s.mois.slice(0, 7)}`}>
                        Supprimer
                      </BoutonEnvoi>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="petit doux">Aucune saisie manuelle.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
