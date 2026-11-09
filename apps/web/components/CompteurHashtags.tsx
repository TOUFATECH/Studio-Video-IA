"use client";
// Champ de hashtags d'un réseau avec compteur « n / max » mis à jour pendant la saisie.
import { useId, useState } from "react";

/** Compte les hashtags distincts d'une saisie libre. */
function compter(texte: string): number {
  return new Set(texte.split(/[\s,;]+/).map((m) => m.replace(/^#+/, "").toLowerCase()).filter(Boolean)).size;
}

/** Zone de saisie des hashtags d'un réseau. */
export function CompteurHashtags({ nom, libelle, valeur, max, aide }: { nom: string; libelle: string; valeur: string; max: number; aide?: string }) {
  const [texte, setTexte] = useState(valeur);
  const idChamp = useId();
  const n = compter(texte);
  return (
    <div className="champ">
      <label className="etiquette ligne ligne--entre" htmlFor={idChamp}>
        <span>{libelle}</span>
        <span className={`mono ${n > max ? "texte-erreur" : ""}`} aria-live="polite">
          {n} / {max}
        </span>
      </label>
      <textarea id={idChamp} name={nom} rows={3} value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="#histoire #anime" />
      {aide ? <span className="tres-petit doux">{aide}</span> : null}
      {n > max ? <span className="tres-petit texte-erreur">Au-delà de {max}, les derniers seront retirés à l’enregistrement.</span> : null}
    </div>
  );
}
