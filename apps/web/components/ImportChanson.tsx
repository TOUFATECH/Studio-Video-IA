"use client";
// Import de la chanson d'un clip : demande d'une adresse signée, envoi direct au stockage avec progression,
// puis validation par le serveur (type réel, remplacement de l'ancienne chanson, synchronisation des paroles).
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

/** Lit le champ « message » d'une réponse JSON. */
function message(corps: unknown, defaut: string): string {
  return typeof corps === "object" && corps !== null && "message" in corps && typeof corps.message === "string" ? corps.message : defaut;
}

/** Envoie un fichier vers une adresse signée en suivant la progression (fetch ne la donne pas). */
function envoyerAvecProgression(adresse: string, fichier: File, surProgression: (pourcent: number) => void): Promise<boolean> {
  return new Promise((resoudre) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", adresse);
    xhr.setRequestHeader("content-type", fichier.type || "audio/mpeg");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) surProgression(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => resoudre(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resoudre(false);
    xhr.send(fichier);
  });
}

/** Champ d'import de la chanson d'un clip. */
export function ImportChanson({ clip, dejaUne }: { clip: string; dejaUne: boolean }) {
  const router = useRouter();
  const idChamp = useId();
  const [etat, setEtat] = useState<{ ton: "info" | "erreur" | "succes"; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  /** Les trois temps de l'import. */
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
      setEtat({ ton: "info", texte: "Préparation…" });
      const r1 = await fetch("/api/import/chanson", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ etape: "adresse", cible: clip, taille: fichier.size, extension }) });
      const c1: unknown = await r1.json().catch(() => ({}));
      if (!r1.ok || typeof c1 !== "object" || c1 === null || !("adresse" in c1) || !("chemin" in c1) || typeof c1.adresse !== "string" || typeof c1.chemin !== "string") {
        setEtat({ ton: "erreur", texte: message(c1, "Import impossible.") });
        return;
      }
      const chemin = c1.chemin;
      const ok = await envoyerAvecProgression(c1.adresse, fichier, (p) => setEtat({ ton: "info", texte: `Envoi… ${p} %` }));
      if (!ok) {
        setEtat({ ton: "erreur", texte: "L’envoi a échoué (connexion ou limite de taille du stockage). Réessaie." });
        return;
      }
      setEtat({ ton: "info", texte: "Vérification du fichier…" });
      const r2 = await fetch("/api/import/chanson", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ etape: "valider", cible: clip, chemin }) });
      const c2: unknown = await r2.json().catch(() => ({}));
      setEtat({ ton: r2.ok ? "succes" : "erreur", texte: message(c2, r2.ok ? "Chanson importée." : "Import impossible.") });
      if (r2.ok) {
        formulaire.reset();
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
