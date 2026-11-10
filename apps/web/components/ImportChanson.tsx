"use client";
// Import de la chanson d'un clip, avec la progression de l'envoi ; le serveur vérifie le type réel,
// remplace l'ancienne chanson et lance la synchronisation des paroles.
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

/** Lit le champ « message » d'une réponse JSON. */
function message(corps: unknown, defaut: string): string {
  return typeof corps === "object" && corps !== null && "message" in corps && typeof corps.message === "string" ? corps.message : defaut;
}

/** Envoie le formulaire en suivant la progression (fetch ne la donne pas). Renvoie le statut et la réponse JSON. */
function envoyerAvecProgression(donnees: FormData, surProgression: (pourcent: number) => void): Promise<{ ok: boolean; corps: unknown }> {
  return new Promise((resoudre) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/import/chanson");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) surProgression(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let corps: unknown = {};
      try {
        corps = JSON.parse(xhr.responseText) as unknown;
      } catch {
        // Réponse non JSON : message par défaut.
      }
      resoudre({ ok: xhr.status >= 200 && xhr.status < 300, corps });
    };
    xhr.onerror = () => resoudre({ ok: false, corps: { message: "Connexion perdue pendant l’envoi." } });
    xhr.send(donnees);
  });
}

/** Champ d'import de la chanson d'un clip. */
export function ImportChanson({ clip, dejaUne }: { clip: string; dejaUne: boolean }) {
  const router = useRouter();
  const idChamp = useId();
  const [etat, setEtat] = useState<{ ton: "info" | "erreur" | "succes"; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  /** Envoie la chanson. */
  async function envoyer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formulaire = e.currentTarget;
    const fichier = new FormData(formulaire).get("fichier");
    if (!(fichier instanceof File) || fichier.size === 0) return;
    const extension = fichier.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["mp3", "wav", "m4a"].includes(extension)) {
      setEtat({ ton: "erreur", texte: "Formats acceptés : MP3, WAV ou M4A." });
      return;
    }
    setEnvoi(true);
    try {
      const donnees = new FormData();
      donnees.set("cible", clip);
      donnees.set("fichier", fichier);
      const r = await envoyerAvecProgression(donnees, (p) => setEtat({ ton: "info", texte: p < 100 ? `Envoi… ${p} %` : "Vérification du fichier…" }));
      setEtat({ ton: r.ok ? "succes" : "erreur", texte: message(r.corps, r.ok ? "Chanson importée." : "Import impossible.") });
      if (r.ok) {
        formulaire.reset();
        router.refresh();
      }
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={envoyer} className="pile pile--serree">
      <label className="etiquette" htmlFor={idChamp}>
        {dejaUne ? "Remplacer la chanson" : "Ta chanson"}
      </label>
      <div className="ligne">
        <input id={idChamp} name="fichier" type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" required className="extensible" />
        <button type="submit" className="btn btn--principal" disabled={envoi}>
          {envoi ? "Envoi…" : "Importer"}
        </button>
      </div>
      <p className="tres-petit doux">MP3, WAV ou M4A, 45 Mo maximum. Les paroles sont ensuite placées automatiquement dans la chanson.</p>
      {etat ? (
        <p className={`bandeau bandeau--${etat.ton}`} role="status">
          {etat.texte}
        </p>
      ) : null}
    </form>
  );
}
