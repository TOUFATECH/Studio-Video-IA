// Clips musicaux : lecture des paroles, placement des paroles dans la chanson, découpage en plans
// calés sur les paroles et le tempo, plan de composition pour générer la musique, sous-titres des paroles.
import { DUREES_AUTORISEES, DUREE_MAX_CLIP, type ChoixSousTitres, type FormatEpisode, type Langue, type TypePlan } from "./constantes";
import { couperLignes, type Repere } from "./sous-titres";
import type { Episode, LigneParole } from "./types";

// ---------------------------------------------------------------------------------------------
// Paroles
// ---------------------------------------------------------------------------------------------

/** Une section des paroles (« Couplet 1 », « Refrain »…) et ses lignes chantées. */
export type SectionParoles = { nom: string; lignes: string[] };

/** Reconnaît une ligne d'en-tête de section : « [Refrain] », « (Couplet 2) », « Refrain : ». */
const EN_TETE = /^\s*(?:\[([^\]]{1,60})\]|\(([^)]{1,60})\)|([\p{L}\p{N} ]{1,30})\s*:)\s*$/u;

/**
 * Lit des paroles saisies librement. Les lignes vides sont ignorées, les en-têtes « [Refrain] » ouvrent une section.
 * Sans en-tête, tout est rangé dans une seule section « Chanson ».
 */
export function analyserParoles(texte: string): { sections: SectionParoles[]; lignes: string[] } {
  const sections: SectionParoles[] = [];
  let courante: SectionParoles | null = null;
  for (const brut of texte.replace(/\r/g, "").split("\n")) {
    const ligne = brut.replace(/\s+/g, " ").trim();
    if (!ligne) continue;
    const m = EN_TETE.exec(ligne);
    if (m) {
      courante = { nom: (m[1] ?? m[2] ?? m[3] ?? "").trim(), lignes: [] };
      sections.push(courante);
      continue;
    }
    if (!courante) {
      courante = { nom: "Chanson", lignes: [] };
      sections.push(courante);
    }
    courante.lignes.push(ligne);
  }
  const pleines = sections.filter((s) => s.lignes.length > 0);
  return { sections: pleines, lignes: pleines.flatMap((s) => s.lignes) };
}

/** Un mot horodaté renvoyé par l'alignement ou la transcription d'ElevenLabs. */
export type MotHorodate = { text: string; start: number; end: number; type?: string };
/** Un caractère horodaté renvoyé par l'alignement d'ElevenLabs. */
export type CaractereHorodate = { text: string; start: number; end: number };

/** Nombre de caractères visibles (sans espaces) d'un texte. */
function visibles(t: string): number {
  return t.replace(/\s+/g, "").length;
}

/**
 * Regroupe le résultat de l'alignement forcé (mots ou caractères horodatés) en lignes de paroles.
 * 1. Si le nombre de mots correspond aux mots des lignes, chaque ligne prend ses mots.
 * 2. Sinon (japonais, coréen, ponctuation détachée…), on suit les caractères visibles un à un.
 * 3. En dernier recours, on répartit les lignes à parts égales entre le premier et le dernier mot.
 */
export function regrouperEnLignes(lignes: readonly string[], mots: readonly MotHorodate[], caracteres: readonly CaractereHorodate[] = []): LigneParole[] {
  const vraisMots = mots.filter((m) => (m.type ?? "word") === "word" && m.text.trim());
  const jetons = lignes.map((l) => l.split(/\s+/).filter(Boolean).length);
  const totalJetons = jetons.reduce((a, b) => a + b, 0);
  if (lignes.length === 0) return [];

  if (vraisMots.length === totalJetons && totalJetons > 0) {
    const out: LigneParole[] = [];
    let i = 0;
    lignes.forEach((texte, k) => {
      const n = jetons[k] ?? 0;
      const premier = vraisMots[i];
      const dernier = vraisMots[i + n - 1];
      i += n;
      if (premier && dernier) out.push({ texte, debut: premier.start, fin: dernier.end });
    });
    return lisser(out);
  }

  const car = caracteres.filter((c) => c.text.trim());
  const totalCar = lignes.reduce((a, l) => a + visibles(l), 0);
  if (car.length > 0 && Math.abs(car.length - totalCar) <= Math.max(2, totalCar * 0.02)) {
    const out: LigneParole[] = [];
    let i = 0;
    for (const texte of lignes) {
      const n = visibles(texte);
      const premier = car[Math.min(i, car.length - 1)];
      const dernier = car[Math.min(i + n - 1, car.length - 1)];
      i += n;
      if (premier && dernier) out.push({ texte, debut: premier.start, fin: Math.max(premier.start, dernier.end) });
    }
    return lisser(out);
  }

  // Dernier recours : répartition proportionnelle à la longueur des lignes.
  const debut = vraisMots[0]?.start ?? car[0]?.start ?? 0;
  const fin = vraisMots[vraisMots.length - 1]?.end ?? car[car.length - 1]?.end ?? debut + lignes.length * 3;
  const poids = lignes.map((l) => Math.max(1, visibles(l)));
  const total = poids.reduce((a, b) => a + b, 0);
  let t = debut;
  return lisser(
    lignes.map((texte, k) => {
      const d = ((fin - debut) * (poids[k] ?? 1)) / total;
      const ligne = { texte, debut: t, fin: t + d };
      t += d;
      return ligne;
    }),
  );
}

/** Remet les lignes dans l'ordre du temps, sans chevauchement, en arrondissant au centième. */
function lisser(lignes: LigneParole[]): LigneParole[] {
  const r = (x: number): number => Math.round(x * 100) / 100;
  let precedenteFin = 0;
  return lignes.map((l) => {
    const debut = r(Math.max(l.debut, precedenteFin));
    const fin = r(Math.max(debut + 0.2, l.fin));
    precedenteFin = fin;
    return { texte: l.texte, debut, fin };
  });
}

/**
 * Lignes de paroles à partir d'une transcription (quand l'utilisateur n'a pas saisi les paroles).
 * Une nouvelle ligne commence après un silence de plus de 0,7 s, une fin de phrase, ou au-delà de 9 mots.
 */
export function lignesDepuisTranscription(mots: readonly MotHorodate[], langue: Langue): LigneParole[] {
  const vraisMots = mots.filter((m) => (m.type ?? "word") === "word" && m.text.trim());
  const sansEspaces = langue === "ja";
  const out: LigneParole[] = [];
  let courant: MotHorodate[] = [];
  const fermer = (): void => {
    const premier = courant[0];
    const dernier = courant[courant.length - 1];
    if (premier && dernier) {
      const texte = courant.map((m) => m.text.trim()).join(sansEspaces ? "" : " ");
      out.push({ texte, debut: premier.start, fin: dernier.end });
    }
    courant = [];
  };
  for (const m of vraisMots) {
    const precedent = courant[courant.length - 1];
    if (precedent && (m.start - precedent.end > 0.7 || courant.length >= (sansEspaces ? 14 : 9))) fermer();
    courant.push(m);
    if (/[.!?。！？]$/.test(m.text.trim())) fermer();
  }
  fermer();
  return lisser(out);
}

// ---------------------------------------------------------------------------------------------
// Extrait et découpage
// ---------------------------------------------------------------------------------------------

/** Durée la plus courte d'un plan de clip (en dessous, la coupe est illisible). */
export const DUREE_MIN_PLAN_CLIP = 2.5;
/** Durée visée au plus pour un plan de clip : au-delà, on coupe pour garder du rythme. */
export const DUREE_MAX_PLAN_CLIP = 8;

/** Extrait de la chanson utilisé par le clip (secondes dans le fichier audio). */
export type Extrait = { debut: number; fin: number };

/**
 * Extrait effectif d'un clip : celui choisi, borné par la durée de la chanson et la durée maximale du format.
 * Sans fin choisie, l'extrait part de `extrait_debut` et dure le plus possible.
 */
export function extraitClip(episode: Pick<Episode, "extrait_debut" | "extrait_fin" | "format">, dureeChanson: number): Extrait {
  const max = DUREE_MAX_CLIP[episode.format];
  const debut = Math.min(Math.max(0, episode.extrait_debut), Math.max(0, dureeChanson - 3));
  const finVoulue = episode.extrait_fin ?? dureeChanson;
  const fin = Math.min(finVoulue, dureeChanson, debut + max);
  return { debut: arrondir(debut), fin: arrondir(Math.max(debut + 3, fin)) };
}

/**
 * Extrait proposé par défaut : commence 1 s avant la première ligne chantée (ou au début),
 * et dure au plus le maximum du format.
 */
export function extraitParDefaut(lignes: readonly LigneParole[] | null, dureeChanson: number, format: FormatEpisode): Extrait {
  const premiere = lignes?.[0];
  const debut = format === "court" && premiere ? Math.max(0, premiere.debut - 1) : 0;
  return extraitClip({ extrait_debut: debut, extrait_fin: null, format }, dureeChanson);
}

/** Un segment du clip : il deviendra un plan (une image, un clip Grok). */
export type SegmentClip = { debut: number; fin: number; texte: string; type: TypePlan };

/** Arrondi au millième (les colonnes debut/fin gardent 3 décimales). */
function arrondir(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/**
 * Découpe l'extrait en segments calés sur les paroles :
 * une coupe au début de chaque ligne chantée et à la fin d'un long passage instrumental,
 * posée sur le temps le plus proche si le tempo est connu ; les segments trop courts sont fusionnés,
 * les trop longs coupés en parts égales (sur la mesure si le tempo est connu).
 */
export function decouperClip(params: { lignes: readonly LigneParole[]; extrait: Extrait; bpm: number | null }): SegmentClip[] {
  const { extrait, bpm } = params;
  const lignes = params.lignes.filter((l) => l.fin > extrait.debut && l.debut < extrait.fin);
  const temps = bpm ? 60 / bpm : null;
  // Le premier temps est calé sur la première ligne chantée (les chanteurs attaquent en général sur le temps).
  const ancre = lignes[0]?.debut ?? extrait.debut;
  const caler = (t: number): number => {
    if (!temps) return t;
    const k = Math.round((t - ancre) / temps);
    return ancre + k * temps;
  };

  // 1. Points de coupe candidats.
  const coupes = new Set<number>();
  lignes.forEach((l, i) => {
    coupes.add(caler(l.debut));
    const suivante = lignes[i + 1];
    const finPassage = suivante ? suivante.debut : extrait.fin;
    // Passage instrumental de plus de 4 s après la ligne : il a son propre plan.
    if (finPassage - l.fin > 4) coupes.add(caler(l.fin + 0.3));
  });
  const points = [extrait.debut, ...[...coupes].filter((t) => t > extrait.debut + 0.5 && t < extrait.fin - 0.5).sort((a, b) => a - b), extrait.fin];

  // 2. Segments bruts, puis fusion des trop courts avec le suivant (ou le précédent pour le dernier).
  let segs: { debut: number; fin: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a !== undefined && b !== undefined && b > a) segs.push({ debut: a, fin: b });
  }
  const fusionnes: { debut: number; fin: number }[] = [];
  for (const s of segs) {
    const dernier = fusionnes[fusionnes.length - 1];
    if (dernier && dernier.fin - dernier.debut < DUREE_MIN_PLAN_CLIP) dernier.fin = s.fin;
    else fusionnes.push({ ...s });
  }
  const queue = fusionnes[fusionnes.length - 1];
  const avant = fusionnes[fusionnes.length - 2];
  if (queue && avant && queue.fin - queue.debut < DUREE_MIN_PLAN_CLIP) {
    avant.fin = queue.fin;
    fusionnes.pop();
  }
  segs = fusionnes;

  // 3. Les segments trop longs sont coupés en parts égales (multiples d'une mesure de 4 temps si possible).
  const decoupes: { debut: number; fin: number }[] = [];
  for (const s of segs) {
    const d = s.fin - s.debut;
    if (d <= DUREE_MAX_PLAN_CLIP) {
      decoupes.push(s);
      continue;
    }
    const n = Math.ceil(d / DUREE_MAX_PLAN_CLIP);
    const mesure = temps ? temps * 4 : null;
    let t = s.debut;
    for (let k = 1; k < n; k++) {
      let coupe = s.debut + (d * k) / n;
      if (mesure) {
        const calee = s.debut + Math.round((coupe - s.debut) / mesure) * mesure;
        if (calee - t >= DUREE_MIN_PLAN_CLIP && s.fin - calee >= DUREE_MIN_PLAN_CLIP && calee - t <= 15) coupe = calee;
      }
      decoupes.push({ debut: t, fin: coupe });
      t = coupe;
    }
    decoupes.push({ debut: t, fin: s.fin });
  }

  // 4. Texte chanté pendant chaque segment et type de plan.
  const compte = new Map<string, number>();
  for (const l of params.lignes) compte.set(cleLigne(l.texte), (compte.get(cleLigne(l.texte)) ?? 0) + 1);
  return decoupes.map((s, i): SegmentClip => {
    const chante = lignes.filter((l) => l.debut < s.fin - 0.2 && l.fin > s.debut + 0.2);
    const texte = chante.map((l) => l.texte).join(" / ");
    const refrain = chante.some((l) => (compte.get(cleLigne(l.texte)) ?? 0) >= 2);
    let type: TypePlan;
    if (i === 0) type = "accroche";
    else if (i === decoupes.length - 1) type = "final";
    else if (!chante.length) type = "decor";
    else if (refrain) type = "climax";
    else type = "action";
    return { debut: arrondir(s.debut), fin: arrondir(s.fin), texte, type };
  });
}

/** Clé de comparaison d'une ligne (pour repérer le refrain, qui revient plusieurs fois). */
function cleLigne(t: string): string {
  return t.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Découpage d'une musique sans paroles : des plans de 4 à 6 s, calés sur les mesures si le tempo est connu.
 */
export function decouperInstrumental(extrait: Extrait, bpm: number | null): SegmentClip[] {
  const d = extrait.fin - extrait.debut;
  const mesure = bpm ? (60 / bpm) * 4 : null;
  // Une ou deux mesures par plan, autour de 5 s.
  const pas = mesure ? mesure * Math.max(1, Math.round(5 / mesure)) : 5;
  const n = Math.max(1, Math.round(d / pas));
  const out: SegmentClip[] = [];
  for (let i = 0; i < n; i++) {
    const debut = extrait.debut + (d * i) / n;
    const fin = i === n - 1 ? extrait.fin : extrait.debut + (d * (i + 1)) / n;
    out.push({ debut: arrondir(debut), fin: arrondir(fin), texte: "", type: i === 0 ? "accroche" : i === n - 1 ? "final" : i % 3 === 2 ? "decor" : "action" });
  }
  return out;
}

/**
 * Durée demandée à Grok pour un plan : le palier autorisé (3, 5, 8, 10 ou 15 s) juste au-dessus de la durée du plan.
 * Le clip est ensuite coupé à la durée exacte au montage. Pour un épisode, la durée est déjà un palier.
 */
export function dureeGenerationClip(dureePlan: number): number {
  const paliers: readonly number[] = DUREES_AUTORISEES;
  return paliers.find((p) => p >= dureePlan - 0.01) ?? 15;
}

// ---------------------------------------------------------------------------------------------
// Sous-titres des paroles
// ---------------------------------------------------------------------------------------------

/**
 * Sous-titres d'un clip : les lignes de paroles comprises dans l'extrait, en temps relatif au début de l'extrait.
 * `choix` = langue des sous-titres : celle de la chanson affiche les paroles, une autre affiche leur traduction.
 */
export function reperesParoles(params: {
  lignes: readonly LigneParole[];
  traductions: Partial<Record<Langue, string[]>>;
  extrait: Extrait;
  choix: ChoixSousTitres;
  langueChanson: Langue;
}): Repere[] {
  const { lignes, extrait, choix, langueChanson } = params;
  if (choix === "aucun") return [];
  const traduites = choix === langueChanson ? null : params.traductions[choix];
  if (choix !== langueChanson && !traduites) return [];
  const out: Repere[] = [];
  lignes.forEach((l, i) => {
    const texte = traduites ? traduites[i] : l.texte;
    if (!texte || !texte.trim()) return;
    const debut = Math.max(l.debut, extrait.debut) - extrait.debut;
    const fin = Math.min(l.fin + 0.3, extrait.fin) - extrait.debut;
    if (fin - debut < 0.3) return;
    out.push({ debut: arrondir(debut), fin: arrondir(fin), texte: couperLignes(texte, choix).join("\n") });
  });
  // Pas de chevauchement : un sous-titre s'efface quand le suivant arrive.
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i];
    const b = out[i + 1];
    if (a && b && a.fin > b.debut) a.fin = b.debut;
  }
  return out.filter((r) => r.fin - r.debut >= 0.3);
}

// ---------------------------------------------------------------------------------------------
// Génération de la musique (ElevenLabs Music)
// ---------------------------------------------------------------------------------------------

/** Section d'un plan de composition ElevenLabs. */
export type SectionComposition = {
  section_name: string;
  positive_local_styles: string[];
  negative_local_styles: string[];
  duration_ms: number;
  lines: string[];
};
/** Plan de composition ElevenLabs (modèle music_v1). */
export type PlanComposition = { positive_global_styles: string[]; negative_global_styles: string[]; sections: SectionComposition[] };

/** Bornes imposées par ElevenLabs Music. */
export const BORNES_MUSIQUE = { totalMinMs: 3000, totalMaxMs: 600_000, sectionMinMs: 3000, sectionMaxMs: 120_000, lignesMax: 30, caracteresMax: 200 } as const;

/** Découpe une saisie « pop, voix féminine ; 100 BPM » en liste de styles. */
export function listeStyles(saisie: string): string[] {
  return saisie
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * Plan de composition à partir des paroles : intro et outro instrumentales, puis une section par section des paroles,
 * d'une durée proportionnelle à son nombre de lignes, le tout ramené à la durée voulue.
 * Respecte les bornes d'ElevenLabs (3 à 120 s par section, 30 lignes, 200 caractères par ligne, 10 min au total).
 */
export function planComposition(params: { paroles: string; style: string; dureeCible: number; instrumental: boolean }): PlanComposition {
  const styles = listeStyles(params.style);
  const positifs = styles.length ? styles : ["pop", "modern production"];
  const negatifs = params.instrumental ? ["vocals", "singing", "lyrics"] : [];
  const totalMs = Math.min(BORNES_MUSIQUE.totalMaxMs, Math.max(BORNES_MUSIQUE.totalMinMs, Math.round(params.dureeCible * 1000)));
  const { sections } = params.instrumental ? { sections: [] as SectionParoles[] } : analyserParoles(params.paroles);

  // Sections à chanter, coupées à 30 lignes et 200 caractères par ligne.
  const chantees: SectionParoles[] = [];
  for (const s of sections) {
    for (let i = 0; i < s.lignes.length; i += BORNES_MUSIQUE.lignesMax) {
      chantees.push({ nom: i ? `${s.nom} (suite)` : s.nom, lignes: s.lignes.slice(i, i + BORNES_MUSIQUE.lignesMax).map((l) => l.slice(0, BORNES_MUSIQUE.caracteresMax)) });
    }
  }

  const brutes: { nom: string; poids: number; lignes: string[]; styles: string[]; sans: string[] }[] = [];
  if (chantees.length === 0) {
    // Musique instrumentale : intro, développement, final.
    brutes.push({ nom: "Intro", poids: 1, lignes: [], styles: ["atmospheric", "building"], sans: ["vocals"] });
    brutes.push({ nom: "Main", poids: 3, lignes: [], styles: ["full arrangement", "driving rhythm"], sans: ["vocals"] });
    brutes.push({ nom: "Outro", poids: 1, lignes: [], styles: ["resolving", "fade out"], sans: ["vocals"] });
  } else {
    brutes.push({ nom: "Intro", poids: 1.5, lignes: [], styles: ["instrumental intro"], sans: ["vocals"] });
    for (const s of chantees) {
      const refrain = /refrain|chorus|hook|サビ|후렴/i.test(s.nom);
      brutes.push({ nom: s.nom.slice(0, 100), poids: Math.max(1, s.lignes.length), lignes: s.lignes, styles: refrain ? ["anthemic", "full band", "catchy hook"] : ["clear vocals"], sans: [] });
    }
    brutes.push({ nom: "Outro", poids: 1.5, lignes: [], styles: ["instrumental outro", "fade out"], sans: ["vocals"] });
  }

  // Répartition de la durée, chaque section entre 3 et 120 s.
  const totalPoids = brutes.reduce((a, b) => a + b.poids, 0);
  const durees = brutes.map((b) => Math.min(BORNES_MUSIQUE.sectionMaxMs, Math.max(BORNES_MUSIQUE.sectionMinMs, Math.round((totalMs * b.poids) / totalPoids / 100) * 100)));
  // Si les bornes ont fait dépasser 10 min, on retire des sections instrumentales en trop.
  let somme = durees.reduce((a, b) => a + b, 0);
  while (somme > BORNES_MUSIQUE.totalMaxMs && durees.length > 1) {
    const i = durees.indexOf(Math.max(...durees));
    durees[i] = Math.max(BORNES_MUSIQUE.sectionMinMs, (durees[i] ?? 0) - (somme - BORNES_MUSIQUE.totalMaxMs));
    const nouvelle = durees.reduce((a, b) => a + b, 0);
    if (nouvelle === somme) break;
    somme = nouvelle;
  }
  return {
    positive_global_styles: positifs,
    negative_global_styles: negatifs,
    sections: brutes.map((b, i) => ({
      section_name: b.nom || `Section ${i + 1}`,
      positive_local_styles: b.styles,
      negative_local_styles: b.sans,
      duration_ms: durees[i] ?? BORNES_MUSIQUE.sectionMinMs,
      lines: b.lignes,
    })),
  };
}

/** Durée totale d'un plan de composition, en secondes. */
export function dureeComposition(plan: PlanComposition): number {
  return plan.sections.reduce((a, s) => a + s.duration_ms, 0) / 1000;
}

/** Paroles chantées pendant un passage (pour afficher ce qui est chanté sur un plan). */
export function parolesEntre(lignes: readonly LigneParole[] | null, debut: number, fin: number): string {
  if (!lignes) return "";
  return lignes
    .filter((l) => l.debut < fin - 0.2 && l.fin > debut + 0.2)
    .map((l) => l.texte)
    .join(" / ");
}

/** Formate des secondes en « m:ss.d » (dixième de seconde), pour les repères dans une chanson. */
export function formaterTemps(secondes: number): string {
  const t = Math.max(0, Math.round(secondes * 10) / 10);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}
