"use client";
// Bouton d'envoi qui se désactive pendant l'exécution de la Server Action du formulaire.
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** Bouton « submit » avec état d'attente. */
export function BoutonEnvoi({
  children,
  variante,
  enCours = "Un instant…",
  desactive,
  nom,
  valeur,
  titre,
  libelleAria,
}: {
  children: ReactNode;
  variante?: "principal" | "discret" | "danger";
  enCours?: string;
  desactive?: boolean;
  nom?: string;
  valeur?: string;
  titre?: string;
  libelleAria?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`btn${variante ? ` btn--${variante}` : ""}`}
      disabled={desactive || pending}
      aria-busy={pending}
      name={nom}
      value={valeur}
      title={titre}
      aria-label={libelleAria}
    >
      {pending ? enCours : children}
    </button>
  );
}
