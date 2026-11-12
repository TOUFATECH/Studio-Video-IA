"use client";
// Import d'un fichier vers /api/import (échantillon de voix, musique, image de référence, photo ou vidéo de la bibliothèque,
// remplacement de l'image ou du clip d'un plan), puis rafraîchissement. Glisser-déposer accepté sur le champ.
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

/** Champ d'import avec son bouton et son message de retour. */
export function ImportFichier({
  genre,
  cible,
  libelle,
  accepte,
  aide,
  cibleType,
  droitImage = false,
}: {
  genre: "echantillon_voix" | "musique" | "fiche" | "reference" | "remplacement_image" | "remplacement_clip";
  /** Identifiant visé : personnage (voix, fiche), espace (musique), élément de la bibliothèque ou plan (remplacement). */
  cible: string;
  libelle: string;
  accepte: string;
  aide: string;
  /** Référence : personnage ou élément de la bibliothèque. */
  cibleType?: "personnage" | "element";
  /** Affiche les cases « vraie personne » et « accord de la personne » (droit à l'image). */
  droitImage?: boolean;
}) {
  const [reelle, setReelle] = useState(false);
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
      {cibleType ? <input type="hidden" name="cible_type" value={cibleType} /> : null}
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
      {droitImage ? (
        <div className="pile pile--serree">
          <label className="ligne ligne--serree tres-petit">
            <input type="checkbox" name="personne_reelle" checked={reelle} onChange={(e) => setReelle(e.target.checked)} />
            Photo ou vidéo d’une vraie personne
          </label>
          {reelle ? (
            <label className="ligne ligne--serree tres-petit">
              <input type="checkbox" name="accord" required />
              J’ai l’accord de cette personne pour utiliser son image (obligatoire)
            </label>
          ) : null}
        </div>
      ) : null}
      {etat ? (
        <p className={`bandeau bandeau--${etat.ton}`} role="status">
          {etat.texte}
        </p>
      ) : null}
    </form>
  );
}
