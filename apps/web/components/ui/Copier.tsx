"use client";
// Bouton qui copie un texte dans le presse-papiers et le confirme.
import { useState } from "react";
import { Icone } from "./Icone";

/** Copie `texte` au clic. */
export function Copier({ texte, libelle = "Copier le texte" }: { texte: string; libelle?: string }) {
  const [etat, setEtat] = useState<"repos" | "copie" | "echec">("repos");
  /** Copie et affiche la confirmation pendant 2 s. */
  async function copier() {
    try {
      await navigator.clipboard.writeText(texte);
      setEtat("copie");
    } catch {
      setEtat("echec");
    }
    setTimeout(() => setEtat("repos"), 2000);
  }
  return (
    <button type="button" className="btn" onClick={copier} aria-live="polite">
      <Icone nom="copier" />
      {etat === "copie" ? "Copié" : etat === "echec" ? "Copie impossible" : libelle}
    </button>
  );
}
