"use client";
// Deuxième étape de connexion : le code à 6 chiffres de l'appli d'authentification.
import { useActionState } from "react";
import { connexionCode, type EtatConnexion } from "@/app/actions/session";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";

/** Formulaire du code. */
export function FormulaireCode({ suite }: { suite: string }) {
  const [etat, action] = useActionState<EtatConnexion, FormData>(connexionCode, {});
  return (
    <form action={action} className="carte pile">
      <input type="hidden" name="suite" value={suite} />
      <div className="champ">
        <label className="etiquette" htmlFor="c-code">
          Code à 6 chiffres
        </label>
        <input id="c-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus />
      </div>
      {etat.erreur ? (
        <p className="bandeau bandeau--erreur" role="alert">
          {etat.erreur}
        </p>
      ) : null}
      <BoutonEnvoi variante="principal" enCours="Vérification…">
        Valider
      </BoutonEnvoi>
    </form>
  );
}
