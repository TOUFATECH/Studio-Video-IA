"use client";
// Formulaires de connexion (mot de passe et lien magique) avec leurs messages d'erreur.
import { useActionState } from "react";
import { connexionMotDePasse, lienMagique, type EtatConnexion } from "@/app/actions/session";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";

/** Les deux façons de se connecter. */
export function FormulairesConnexion({ suite }: { suite: string }) {
  const [etatMdp, actionMdp] = useActionState<EtatConnexion, FormData>(connexionMotDePasse, {});
  const [etatLien, actionLien] = useActionState<EtatConnexion, FormData>(lienMagique, {});
  return (
    <div className="pile">
      <form action={actionMdp} className="carte pile">
        <input type="hidden" name="suite" value={suite} />
        <div className="champ">
          <label className="etiquette" htmlFor="c-email">
            E-mail
          </label>
          <input id="c-email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="champ">
          <label className="etiquette" htmlFor="c-mdp">
            Mot de passe
          </label>
          <input id="c-mdp" name="mot_de_passe" type="password" autoComplete="current-password" required minLength={6} />
        </div>
        {etatMdp.erreur ? (
          <p className="bandeau bandeau--erreur" role="alert">
            {etatMdp.erreur}
          </p>
        ) : null}
        <BoutonEnvoi variante="principal" enCours="Connexion…">
          Se connecter
        </BoutonEnvoi>
      </form>
      <form action={actionLien} className="carte pile">
        <input type="hidden" name="suite" value={suite} />
        <div className="champ">
          <label className="etiquette" htmlFor="c-email2">
            Sans mot de passe : recevoir un lien par e-mail
          </label>
          <input id="c-email2" name="email" type="email" autoComplete="email" required />
        </div>
        {etatLien.erreur ? (
          <p className="bandeau bandeau--erreur" role="alert">
            {etatLien.erreur}
          </p>
        ) : null}
        {etatLien.info ? (
          <p className="bandeau bandeau--succes" role="status">
            {etatLien.info}
          </p>
        ) : null}
        <BoutonEnvoi enCours="Envoi…">Recevoir le lien</BoutonEnvoi>
      </form>
    </div>
  );
}
