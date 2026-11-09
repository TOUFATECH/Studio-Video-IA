// Onglet « Clés API » : saisie chiffrée côté serveur, jamais réaffichée (seuls les 4 derniers caractères), test.
import { RESEAUX, type Fournisseur } from "@feuilleton/core";
import { enregistrerCle } from "@/app/actions/reglages";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Puce } from "@/components/ui/elements";
import { FOURNISSEUR_DU_RESEAU } from "@/lib/cles";
import { lireEnv } from "@/lib/env";
import { ilYa } from "@/lib/format";
import { utilisateur } from "@/lib/session";
import { z } from "zod";
import { TesterCle } from "./TesterCle";

/** Fournisseurs affichés, dans l'ordre, avec leur usage. */
const LIGNES: { cle: Fournisseur; nom: string; usage: string; application: boolean }[] = [
  { cle: "openai", nom: "OpenAI", usage: "Scénarios, images des plans, fiches personnages, miniatures", application: false },
  { cle: "xai", nom: "xAI · Grok", usage: "Clips vidéo, image → vidéo, 1 à 15 s", application: false },
  { cle: "elevenlabs", nom: "ElevenLabs", usage: "Voix multilingues, voix clonées, bruitages", application: false },
  { cle: "google", nom: "Google Cloud · YouTube", usage: "Envoi YouTube et Shorts, statistiques, revenus", application: true },
  { cle: "meta", nom: "Meta · Instagram", usage: "Reels Instagram (Instagram Login), statistiques", application: true },
  { cle: "tiktok", nom: "TikTok for Developers", usage: "Content Posting API, statistiques", application: true },
];

/** Liste des clés. */
export async function OngletCles() {
  const { supabase } = await utilisateur();
  const { data } = await supabase.from("cles_api").select("fournisseur, apercu, modifie_le");
  const cles = new Map(
    z
      .array(z.object({ fournisseur: z.string(), apercu: z.string(), modifie_le: z.string() }))
      .catch([])
      .parse(data)
      .map((c) => [c.fournisseur, c]),
  );
  const appUrl = lireEnv("APP_URL")?.replace(/\/+$/, "");
  const reseauDe = (f: Fournisseur) => RESEAUX.find((r) => FOURNISSEUR_DU_RESEAU[r] === f);

  return (
    <section aria-label="Clés API" className="carte">
      <p className="petit doux">Les clés sont envoyées au serveur, chiffrées et jamais réaffichées. Seuls les 4 derniers caractères restent visibles. Les comptes TikTok, Instagram et YouTube se connectent ensuite un par un dans Comptes.</p>
      {!appUrl ? <p className="bandeau bandeau--attention marge-haut">APP_URL n’est pas définie : les adresses de retour OAuth ne peuvent pas être calculées.</p> : null}
      <ul className="liste-nue">
        {LIGNES.map((l) => {
          const c = cles.get(l.cle);
          const reseau = reseauDe(l.cle);
          return (
            <li key={l.cle} className="liste-ligne liste-ligne--haut">
              <div className="extensible" style={{ flex: "1 1 230px" }}>
                <p className="gras petit">{l.nom}</p>
                <p className="tres-petit doux">{l.usage}</p>
                {l.application && reseau && appUrl ? (
                  <p className="tres-petit doux">
                    URL de redirection à déclarer : <span className="mono">{`${appUrl}/api/oauth/${reseau}/retour`}</span>
                  </p>
                ) : null}
              </div>
              <Puce ton={c ? "succes" : "neutre"}>{c ? `•••• ${c.apercu}` : "Absente"}</Puce>
              <form action={enregistrerCle} className="ligne ligne--bas" style={{ flex: "2 1 320px" }} autoComplete="off">
                <input type="hidden" name="fournisseur" value={l.cle} />
                {l.application ? (
                  <>
                    <div className="champ">
                      <label className="etiquette" htmlFor={`c-${l.cle}-id`}>
                        Identifiant de l’application
                      </label>
                      <input id={`c-${l.cle}-id`} name="client_id" type="password" autoComplete="off" required placeholder="Colle l’identifiant" />
                    </div>
                    <div className="champ">
                      <label className="etiquette" htmlFor={`c-${l.cle}-secret`}>
                        Secret de l’application
                      </label>
                      <input id={`c-${l.cle}-secret`} name="client_secret" type="password" autoComplete="off" required placeholder="Colle le secret" />
                    </div>
                  </>
                ) : (
                  <div className="champ">
                    <label className="etiquette" htmlFor={`c-${l.cle}`}>
                      Clé {l.nom}
                    </label>
                    <input id={`c-${l.cle}`} name="valeur" type="password" autoComplete="off" required placeholder="Colle la clé ici" />
                  </div>
                )}
                <BoutonEnvoi variante="principal">Enregistrer</BoutonEnvoi>
              </form>
              <div className="pile pile--serree">
                <TesterCle fournisseur={l.cle} desactive={!c} />
                {c ? <span className="tres-petit doux">Modifiée {ilYa(c.modifie_le)}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
