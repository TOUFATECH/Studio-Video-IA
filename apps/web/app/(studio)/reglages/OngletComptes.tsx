// Onglet « Comptes » : espaces (nom, couleur, fuseau, plafond), réseaux connectés et connexion OAuth.
import { NOMS_RESEAUX, RESEAUX } from "@studio-video-ia/core";
import Link from "next/link";
import { creerEspace, definirAuditTiktok, deconnecterReseau, modifierEspace, modifierLangueReseau, retirerReseau } from "@/app/actions/reglages";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { BadgeReseau, PastilleEspace, Puce } from "@/components/ui/elements";
import { COLONNES_RESEAU } from "@/lib/appartenance";
import { FOURNISSEUR_DU_RESEAU } from "@/lib/cles";
import type { Portee } from "@/lib/espace-courant";
import { jourCourt } from "@/lib/format";
import { OPTIONS_LANGUES, statutCompte } from "@/lib/libelles";
import { ligneReseau, lignes } from "@/lib/lignes";
import { utilisateur } from "@/lib/session";
import { z } from "zod";

/** Contraintes de chaque réseau, rappelées à côté du bouton de connexion. */
const CONTRAINTES = {
  tiktok: "Tant que ton app n’a pas passé l’audit TikTok, les vidéos publiées par l’API restent privées.",
  instagram: "Il faut un compte professionnel (Créateur ou Entreprise). Limite de 100 publications par API sur 24 h.",
  youtube: "Connexion Google, envoi en Short (vertical) ou en vidéo classique (film 16:9), programmation native. Quota d’envoi journalier limité.",
} as const;

/** Fuseaux proposés dans la liste (Intl les connaît tous ; la saisie libre reste possible). */
function fuseaux(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["Europe/Paris", "Indian/Mayotte", "Asia/Tokyo", "Asia/Seoul", "America/Sao_Paulo", "America/New_York", "UTC"];
  }
}

/** Gestion des espaces et des réseaux. */
export async function OngletComptes({ portee, espaceDemande }: { portee: Portee; espaceDemande: string | undefined }) {
  const espace = portee.espaces.find((e) => e.id === espaceDemande) ?? portee.courant ?? portee.espaces[0];
  const { db } = await utilisateur();
  const [rReseaux, rCles] = await Promise.all([
    espace ? db.from("reseaux_connectes").select(COLONNES_RESEAU).eq("espace_id", espace.id).order("cree_le") : Promise.resolve({ data: [] }),
    db.from("cles_api").select("fournisseur"),
  ]);
  const reseaux = lignes(ligneReseau, rReseaux.data, "reseaux");
  const cles = new Set(z.array(z.object({ fournisseur: z.string() })).catch([]).parse(rCles.data).map((c) => c.fournisseur));

  return (
    <div className="colonnes">
      <section aria-labelledby="esp-h" className="carte pile pile--serree" style={{ flex: "1 1 260px" }}>
        <h2 id="esp-h" className="h3">
          Comptes
        </h2>
        <ul className="liste-nue pile pile--serree">
          {portee.espaces.map((e) => (
            <li key={e.id}>
              <Link href={`/reglages?onglet=comptes&espace=${e.id}`} className="segment" aria-current={e.id === espace?.id ? "true" : undefined} style={{ width: "100%", justifyContent: "flex-start" }}>
                <PastilleEspace couleur={e.couleur} />
                {e.nom}
              </Link>
            </li>
          ))}
        </ul>
        <form action={creerEspace} id="nouveau-compte" className="pile pile--serree" style={{ borderTop: "1px solid var(--couleur-bordure)", paddingTop: 12 }}>
          <label className="etiquette" htmlFor="nc-nom">
            Nouveau compte
          </label>
          <input id="nc-nom" name="nom" type="text" required maxLength={80} placeholder="Ex. : Chaîne Japon" />
          <BoutonEnvoi variante="principal">Créer le compte</BoutonEnvoi>
        </form>
      </section>

      {espace ? (
        <section aria-labelledby="det-h" className="carte principale pile">
          <form action={modifierEspace} className="pile">
            <input type="hidden" name="id" value={espace.id} />
            <h2 id="det-h" className="h2">
              {espace.nom}
            </h2>
            <div className="ligne ligne--bas">
              <div className="champ champ--large">
                <label className="etiquette" htmlFor="e-nom">
                  Nom du compte
                </label>
                <input id="e-nom" name="nom" type="text" defaultValue={espace.nom} required maxLength={80} />
              </div>
              <div className="champ champ--etroit">
                <label className="etiquette" htmlFor="e-couleur">
                  Couleur
                </label>
                <input id="e-couleur" name="couleur" type="color" defaultValue={espace.couleur.toLowerCase()} />
              </div>
            </div>
            <div className="ligne ligne--bas">
              <div className="champ">
                <label className="etiquette" htmlFor="e-fuseau">
                  Fuseau horaire (heures de publication)
                </label>
                <input id="e-fuseau" name="fuseau" type="text" list="liste-fuseaux" defaultValue={espace.fuseau} required />
                <datalist id="liste-fuseaux">
                  {fuseaux().map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
              <div className="champ champ--etroit">
                <label className="etiquette" htmlFor="e-plafond">
                  Plafond mensuel (€)
                </label>
                <input id="e-plafond" name="plafond_mensuel" type="number" min="0" step="5" defaultValue={espace.plafond_mensuel} required />
              </div>
            </div>
            <div>
              <BoutonEnvoi variante="principal">Enregistrer</BoutonEnvoi>
            </div>
          </form>

          <div>
            <h2 className="h2">Réseaux connectés</h2>
            <p className="tres-petit doux">Chaque compte a ses propres réseaux. Plusieurs comptes du même réseau sont possibles (ex. une chaîne YouTube par langue).</p>
          </div>
          {reseaux.length === 0 ? <p className="petit doux">Aucun réseau connecté.</p> : null}
          <ul className="liste-nue">
            {reseaux.map((r) => {
              const st = statutCompte(r);
              return (
                <li key={r.id} className="liste-ligne">
                  <BadgeReseau reseau={r.reseau} />
                  <span className="petit extensible">
                    {r.nom_compte}
                    <br />
                    <span className="tres-petit doux">{r.jeton_expire_le ? `Jeton valable jusqu’au ${jourCourt(r.jeton_expire_le, espace.fuseau)}` : "Jeton sans date d’expiration connue"}</span>
                  </span>
                  <form action={modifierLangueReseau} className="ligne ligne--serree">
                    <input type="hidden" name="id" value={r.id} />
                    <label className="invisible" htmlFor={`l-${r.id}`}>
                      Langue publiée sur {r.nom_compte}
                    </label>
                    <select id={`l-${r.id}`} name="langue" defaultValue={r.langue} style={{ width: "auto" }}>
                      {OPTIONS_LANGUES.map((l) => (
                        <option key={l.valeur} value={l.valeur}>
                          {l.libelle}
                        </option>
                      ))}
                    </select>
                    <BoutonEnvoi variante="discret">OK</BoutonEnvoi>
                  </form>
                  <Puce ton={st.ton}>{st.texte}</Puce>
                  {r.statut === "connecte" ? (
                    <form action={deconnecterReseau}>
                      <input type="hidden" name="id" value={r.id} />
                      <BoutonEnvoi>Déconnecter</BoutonEnvoi>
                    </form>
                  ) : (
                    <a href={`/api/oauth/${r.reseau}/debut?espace=${espace.id}`} className="btn btn--principal">
                      Reconnecter
                    </a>
                  )}
                  <form action={retirerReseau}>
                    <input type="hidden" name="id" value={r.id} />
                    <BoutonEnvoi variante="discret" libelleAria={`Retirer ${r.nom_compte}`}>
                      Retirer
                    </BoutonEnvoi>
                  </form>
                  {r.reseau === "tiktok" ? (
                    <form action={definirAuditTiktok} className="ligne ligne--serree" style={{ flexBasis: "100%" }}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="valide" value={r.audit_tiktok_valide ? "" : "on"} />
                      <span className="tres-petit doux">Audit TikTok : {r.audit_tiktok_valide ? "validé" : "non validé (vidéos privées)"}</span>
                      <BoutonEnvoi variante="discret">{r.audit_tiktok_valide ? "Marquer non validé" : "Marquer l’audit comme validé"}</BoutonEnvoi>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="pile pile--serree" style={{ borderTop: "1px solid var(--couleur-bordure)", paddingTop: 14 }}>
            <p className="h3">Connecter un réseau</p>
            {RESEAUX.map((r) => {
              const app = cles.has(FOURNISSEUR_DU_RESEAU[r]);
              return (
                <div key={r} className="liste-ligne">
                  <BadgeReseau reseau={r} />
                  <span className="tres-petit doux extensible">{CONTRAINTES[r]}</span>
                  {app ? (
                    <a href={`/api/oauth/${r}/debut?espace=${espace.id}`} className="btn btn--principal">
                      Connecter {NOMS_RESEAUX[r]}
                    </a>
                  ) : (
                    <Link href="/reglages?onglet=cles" className="btn">
                      Ajouter l’app {NOMS_RESEAUX[r]} d’abord
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
