"use client";
// Formulaires de connexion et de création de compte, avec leurs messages d'erreur.
import { useActionState, useState } from "react";
import { connexionMotDePasse, inscription, type EtatConnexion } from "@/app/actions/session";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";

/** Connexion, ou création du compte (onglet). */
export function FormulairesConnexion({ suite, creation, inscriptionPossible }: { suite: string; creation: boolean; inscriptionPossible: boolean }) {
  const [mode, setMode] = useState<"connexion" | "inscription">(creation && inscriptionPossible ? "inscription" : "connexion");
  const [etatMdp, actionMdp] = useActionState<EtatConnexion, FormData>(connexionMotDePasse, {});
  const [etatIns, actionIns] = useActionState<EtatConnexion, FormData>(inscription, {});
  const etat = mode === "connexion" ? etatMdp : etatIns;
  return (
    <div className="pile">
      {inscriptionPossible ? (
        <div className="segments" role="group" aria-label="Connexion ou création de compte">
          <button type="button" aria-pressed={mode === "connexion"} className="segment" onClick={() => setMode("connexion")}>
            J’ai un compte
          </button>
          <button type="button" aria-pressed={mode === "inscription"} className="segment" onClick={() => setMode("inscription")}>
            Créer un compte
          </button>
        </div>
      ) : null}
      <form action={mode === "connexion" ? actionMdp : actionIns} className="carte pile" key={mode}>
        <input type="hidden" name="suite" value={suite} />
        <div className="champ">
          <label className="etiquette" htmlFor="c-email">
            E-mail
          </label>
          <input id="c-email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="champ">
          <label className="etiquette" htmlFor="c-mdp">
            Mot de passe{mode === "inscription" ? " (10 caractères minimum)" : ""}
          </label>
          <input id="c-mdp" name="mot_de_passe" type="password" autoComplete={mode === "connexion" ? "current-password" : "new-password"} required minLength={mode === "inscription" ? 10 : 1} />
        </div>
        {mode === "inscription" ? (
          <div className="champ">
            <label className="etiquette" htmlFor="c-mdp2">
              Confirme le mot de passe
            </label>
            <input id="c-mdp2" name="confirmation" type="password" autoComplete="new-password" required minLength={10} />
          </div>
        ) : null}
        {etat.erreur ? (
          <p className="bandeau bandeau--erreur" role="alert">
            {etat.erreur}
          </p>
        ) : null}
        <BoutonEnvoi variante="principal" enCours={mode === "connexion" ? "Connexion…" : "Création…"}>
          {mode === "connexion" ? "Se connecter" : "Créer mon compte"}
        </BoutonEnvoi>
      </form>
    </div>
  );
}
