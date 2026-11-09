"use client";
// Bouton « Tester » d'une clé : le serveur déchiffre la clé et l'essaie, le résultat s'affiche à côté.
import { useActionState } from "react";
import { testerCle, type ResultatTestCle } from "@/app/actions/reglages";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";

/** Test d'une clé enregistrée. */
export function TesterCle({ fournisseur, desactive }: { fournisseur: string; desactive: boolean }) {
  const [etat, action] = useActionState<ResultatTestCle, FormData>(testerCle, {});
  return (
    <form action={action} className="ligne ligne--serree">
      <input type="hidden" name="fournisseur" value={fournisseur} />
      <BoutonEnvoi desactive={desactive} enCours="Test…">
        Tester
      </BoutonEnvoi>
      {etat.message ? (
        <span className={`tres-petit ${etat.ok ? "texte-succes" : "texte-erreur"}`} role="status">
          {etat.message}
        </span>
      ) : null}
    </form>
  );
}
