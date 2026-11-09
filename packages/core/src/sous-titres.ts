// Construction des sous-titres (format SRT) à partir des répliques et des durées des plans.
import type { ChoixSousTitres, Langue } from "./constantes";
import type { Plan } from "./types";

/** Un sous-titre : début et fin en secondes, texte déjà découpé en lignes. */
export type Repere = { debut: number; fin: number; texte: string };

/** Texte d'une réplique dans une langue : la traduction, ou l'original si c'est la langue d'origine. */
export function repliqueEn(plan: Pick<Plan, "replique" | "repliques_traduites">, langue: Langue, langueOrigine: Langue): string | null {
  const t = plan.repliques_traduites[langue];
  if (t && t.trim()) return t.trim();
  if (langue === langueOrigine && plan.replique.trim()) return plan.replique.trim();
  return null;
}

/**
 * Coupe un texte en lignes lisibles : 42 caractères par ligne en alphabet latin,
 * 16 en japonais et en coréen (caractères larges), deux lignes au maximum par sous-titre.
 */
export function couperLignes(texte: string, langue: Langue): string[] {
  const max = langue === "ja" || langue === "ko" ? 16 : 42;
  const propre = texte.replace(/\s+/g, " ").trim();
  if (propre.length <= max) return [propre];
  // Japonais : pas d'espaces entre les mots, on coupe au nombre de caractères.
  if (langue === "ja") {
    const out: string[] = [];
    for (let i = 0; i < propre.length; i += max) out.push(propre.slice(i, i + max));
    return regrouper(out);
  }
  const mots = propre.split(" ");
  const lignes: string[] = [];
  let ligne = "";
  for (const mot of mots) {
    if (!ligne) ligne = mot;
    else if ((ligne + " " + mot).length <= max) ligne += " " + mot;
    else {
      lignes.push(ligne);
      ligne = mot;
    }
  }
  if (ligne) lignes.push(ligne);
  return regrouper(lignes);
}

/** Ramène une liste de lignes à deux lignes au plus, en fusionnant la fin dans la seconde. */
function regrouper(lignes: string[]): string[] {
  if (lignes.length <= 2) return lignes;
  return [lignes[0] ?? "", lignes.slice(1).join(" ")];
}

/**
 * Repères de sous-titres d'une version.
 * `decalage` : secondes avant le premier plan (30 s d'opening dans un film long).
 * Renvoie une liste vide si aucun sous-titre n'est demandé.
 */
export function construireReperes(params: {
  plans: readonly Plan[];
  durees: Map<string, number>;
  choix: ChoixSousTitres;
  langueOrigine: Langue;
  decalage?: number;
}): Repere[] {
  const { plans, durees, choix, langueOrigine } = params;
  if (choix === "aucun") return [];
  const out: Repere[] = [];
  let t = params.decalage ?? 0;
  for (const p of plans) {
    const d = durees.get(p.id) ?? 0;
    const texte = repliqueEn(p, choix, langueOrigine);
    if (texte && d > 0) {
      // Petites marges pour que le sous-titre n'apparaisse pas sur la coupe entre deux plans.
      out.push({ debut: t + 0.2, fin: t + Math.max(0.6, d - 0.2), texte: couperLignes(texte, choix).join("\n") });
    }
    t += d;
  }
  return out;
}

/** Formate des secondes en horodatage SRT « hh:mm:ss,mmm ». */
export function horodatageSrt(secondes: number): string {
  const ms = Math.max(0, Math.round(secondes * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`;
}

/** Fichier SRT complet à partir des repères. */
export function versSrt(reperes: readonly Repere[]): string {
  return reperes.map((r, i) => `${i + 1}\n${horodatageSrt(r.debut)} --> ${horodatageSrt(r.fin)}\n${r.texte}\n`).join("\n");
}

/** Langues dont il faut une traduction des répliques : langues des voix et langues de sous-titres choisies. */
export function languesATraduire(langueOrigine: Langue, langues: readonly Langue[], sousTitres: Partial<Record<Langue, ChoixSousTitres>>): Langue[] {
  const set = new Set<Langue>();
  for (const l of langues) if (l !== langueOrigine) set.add(l);
  for (const v of Object.values(sousTitres)) if (v && v !== "aucun" && v !== langueOrigine) set.add(v);
  return [...set];
}
