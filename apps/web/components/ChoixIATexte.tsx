import { NOMS_FOURNISSEURS_TEXTE, type FournisseurTexte } from "@studio-video-ia/core";
import Link from "next/link";

/**
 * Choix de l'IA qui écrit (ChatGPT ou Claude) pour l'arc, le scénario et les modifications.
 * `cles` : fournisseurs dont une clé est enregistrée (seulement leur nom, jamais la valeur).
 */
export function ChoixIATexte({ defaut, cles, nom = "fournisseur_texte" }: { defaut: FournisseurTexte; cles: string[]; nom?: string }) {
  return (
    <fieldset className="segments">
      <legend className="etiquette">IA qui écrit</legend>
      {(["openai", "anthropic"] as const).map((f) => (
        <label key={f} className="segment">
          <input type="radio" name={nom} value={f} defaultChecked={defaut === f} />
          {NOMS_FOURNISSEURS_TEXTE[f]}
          {!cles.includes(f) ? " (clé à ajouter)" : ""}
        </label>
      ))}
      {!cles.includes("anthropic") ? (
        <span className="tres-petit doux">
          Claude : ajoute sa clé dans <Link href="/reglages?onglet=cles">Réglages → Clés API</Link>.
        </span>
      ) : null}
    </fieldset>
  );
}
