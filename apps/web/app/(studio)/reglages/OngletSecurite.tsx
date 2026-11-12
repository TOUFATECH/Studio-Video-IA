// Onglet « Sécurité » : double authentification du propriétaire, droit à l'image, export et suppression des données.
import { adresseTotp, lireTotp } from "@studio-video-ia/base";
import { dechiffrer } from "@studio-video-ia/core/chiffrement";
import QRCode from "qrcode";
import { activerDeuxFacteurs, desactiverDeuxFacteurs, preparerDeuxFacteurs } from "@/app/actions/securite";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Puce } from "@/components/ui/elements";
import { base } from "@/lib/bdd";
import { cleMaitre } from "@/lib/cles";
import { utilisateur } from "@/lib/session";

/** Secret groupé par 4 caractères, pour la saisie à la main. */
function grouper(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

/** Onglet Sécurité. */
export async function OngletSecurite() {
  const { user } = await utilisateur();
  const etat = await lireTotp((await base()).moteur, user.id);
  let secret: string | null = null;
  let qr: string | null = null;
  if (etat.chiffre && !etat.actif) {
    try {
      secret = dechiffrer(etat.chiffre, cleMaitre());
      // QR code produit ici, à partir de notre propre adresse otpauth : SVG sûr.
      qr = await QRCode.toString(adresseTotp(secret, user.email), { type: "svg", margin: 1, width: 200 });
    } catch {
      secret = null;
    }
  }
  return (
    <div className="pile">
      <section aria-labelledby="sec-2fa-h" className="carte pile">
        <div className="ligne ligne--entre">
          <h2 id="sec-2fa-h" className="h2">
            Double authentification
          </h2>
          <Puce ton={etat.actif ? "succes" : "attention"}>{etat.actif ? "Active" : "Inactive"}</Puce>
        </div>
        <p className="petit doux">Un code à 6 chiffres de ton téléphone est demandé à chaque connexion, en plus du mot de passe. Recommandé pour le propriétaire du studio.</p>
        {etat.actif ? (
          <form action={desactiverDeuxFacteurs} className="ligne ligne--bas">
            <div className="champ">
              <label className="etiquette" htmlFor="sec-off">
                Code actuel pour désactiver
              </label>
              <input id="sec-off" name="code" type="text" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" />
            </div>
            <BoutonEnvoi variante="danger">Désactiver</BoutonEnvoi>
          </form>
        ) : secret && qr ? (
          <div className="ligne ligne--haut">
            {/* eslint-disable-next-line react/no-danger -- SVG généré par la bibliothèque qrcode à partir de notre adresse. */}
            <div aria-label="QR code à scanner avec l’appli d’authentification" role="img" style={{ background: "#fff", padding: 8, borderRadius: 8, width: 216 }} dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="pile pile--serree extensible">
              <p className="petit">1. Scanne ce QR code avec Google Authenticator, Microsoft Authenticator ou 1Password.</p>
              <p className="tres-petit doux">
                Ou saisis la clé : <span className="mono">{grouper(secret)}</span>
              </p>
              <form action={activerDeuxFacteurs} className="ligne ligne--bas">
                <div className="champ">
                  <label className="etiquette" htmlFor="sec-on">
                    2. Code affiché
                  </label>
                  <input id="sec-on" name="code" type="text" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" />
                </div>
                <BoutonEnvoi variante="principal">Activer</BoutonEnvoi>
              </form>
            </div>
          </div>
        ) : (
          <form action={preparerDeuxFacteurs}>
            <BoutonEnvoi variante="principal">Configurer la double authentification</BoutonEnvoi>
          </form>
        )}
        <p className="tres-petit doux">Téléphone perdu : sur la machine du studio, « npm run mot-de-passe -- ton@email "nouveau mot de passe" --sans-2fa » remet l’accès.</p>
      </section>
      <section aria-labelledby="sec-image-h" className="carte pile pile--serree">
        <h2 id="sec-image-h" className="h3">
          Droit à l’image
        </h2>
        <p className="petit doux">Toute photo ou vidéo d’une vraie personne importée dans la bibliothèque exige de cocher l’accord de la personne ; la base refuse l’enregistrement sinon.</p>
      </section>
    </div>
  );
}
