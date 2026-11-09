"use client";
// Import d'un fichier vers /api/import (échantillon de voix, musique, image de référence), puis rafraîchissement.
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

/** Champ d'import avec son bouton et son message de retour. */
export function ImportFichier({
  genre,
  cible,
  libelle,
  accepte,
  aide,
}: {
  genre: "echantillon_voix" | "musique" | "fiche";
  /** Identifiant visé : personnage (voix, fiche) ou espace (musique). */
  cible: string;
  libelle: string;
  accepte: string;
  aide: string;
}) {
  const router = useRouter();
  const idChamp = useId();
  const [etat, setEtat] = useState<{ ton: "info" | "erreur" | "succes"; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  /** Envoie le fichier ; le serveur vérifie le type réel et l'appartenance. */
  async function envoyer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setEnvoi(true);
    setEtat({ ton: "info", texte: "Envoi…" });
    try {
      const r = await fetch("/api/import", { method: "POST", body: fd });
      const corps: unknown = await r.json().catch(() => ({}));
      const message = typeof corps === "object" && corps !== null && "message" in corps && typeof corps.message === "string" ? corps.message : r.ok ? "Fichier importé." : "Import impossible.";
      setEtat({ ton: r.ok ? "succes" : "erreur", texte: message });
      if (r.ok) {
        e.currentTarget?.reset();
        router.refresh();
      }
    } catch {
      setEtat({ ton: "erreur", texte: "Connexion perdue pendant l’envoi." });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={envoyer} className="pile pile--serree">
      <input type="hidden" name="genre" value={genre} />
      <input type="hidden" name="cible" value={cible} />
      <label className="etiquette" htmlFor={idChamp}>
        {libelle}
      </label>
      <div className="ligne">
        <input id={idChamp} name="fichier" type="file" accept={accepte} required className="extensible" />
        <button type="submit" className="btn" disabled={envoi}>
          {envoi ? "Envoi…" : "Importer"}
        </button>
      </div>
      <p className="tres-petit doux">{aide}</p>
      {etat ? (
        <p className={`bandeau bandeau--${etat.ton}`} role="status">
          {etat.texte}
        </p>
      ) : null}
    </form>
  );
}
