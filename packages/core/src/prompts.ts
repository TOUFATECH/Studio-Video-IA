// Textes envoyés aux IA : scénario, images, clips, mémoire, traductions, fiches personnages, bruitages.
// Tout le contexte de continuité (bible, mémoire, épisodes précédents) est assemblé ici, en un seul endroit.
import { LISTE_TYPES_PLAN, NOMS_LANGUES, TYPES_PLAN, type Langue } from "./constantes";
import type { Episode, FaitMemoire, Personnage, Plan, Serie } from "./types";

/** Message pour un modèle de langage. */
export type MessagesIA = { system: string; user: string };

/** Résumé d'un épisode précédent, pour la continuité. */
export type EpisodePrecedent = { code: string; titre: string; idee: string; fin: string };

/** Décrit la bible d'une série en texte compact. */
export function texteBible(serie: Pick<Serie, "nom" | "univers" | "fil_rouge" | "style_visuel">, personnages: readonly Pick<Personnage, "nom" | "description">[]): string {
  const persos = personnages.map((p) => `- ${p.nom} : ${p.description || "(sans description)"}`).join("\n");
  return [
    `Série : ${serie.nom}`,
    `Style visuel : ${serie.style_visuel}`,
    `Univers et règles qui ne changent jamais : ${serie.univers || "(non précisé)"}`,
    `Fil rouge des saisons : ${serie.fil_rouge || "(non précisé)"}`,
    `Personnages :\n${persos || "- (aucun)"}`,
  ].join("\n");
}

/** Décrit la mémoire de la série : faits établis, puis mystères encore ouverts. */
export function texteMemoire(memoire: readonly Pick<FaitMemoire, "genre" | "texte" | "ouvert">[]): string {
  const faits = memoire.filter((f) => f.genre !== "mystere").map((f) => `- [${f.genre}] ${f.texte}`);
  const ouverts = memoire.filter((f) => f.genre === "mystere" && f.ouvert).map((f) => `- ${f.texte}`);
  const resolus = memoire.filter((f) => f.genre === "mystere" && !f.ouvert).map((f) => `- ${f.texte}`);
  return [
    `Faits établis (ne jamais les contredire) :\n${faits.join("\n") || "- (aucun)"}`,
    `Mystères ouverts (à faire avancer, pas forcément à résoudre) :\n${ouverts.join("\n") || "- (aucun)"}`,
    `Mystères déjà résolus (ne pas les rouvrir) :\n${resolus.join("\n") || "- (aucun)"}`,
  ].join("\n\n");
}

/**
 * Prompt d'écriture du scénario d'un épisode.
 * La réponse attendue est un JSON conforme à `schemaScenarioIA` (titre, plans, chapitres pour un film).
 */
export function promptScenario(params: {
  serie: Pick<Serie, "nom" | "univers" | "fil_rouge" | "style_visuel">;
  personnages: readonly Pick<Personnage, "nom" | "description">[];
  memoire: readonly Pick<FaitMemoire, "genre" | "texte" | "ouvert">[];
  precedents: readonly EpisodePrecedent[];
  episode: Pick<Episode, "titre" | "idee" | "format" | "genre" | "duree_cible" | "langue">;
  nombrePlans: number;
  nombreChapitres: number;
}): MessagesIA {
  const { episode } = params;
  const types = LISTE_TYPES_PLAN.map((t) => `${t} (${TYPES_PLAN[t].libelle}, environ ${TYPES_PLAN[t].base} s)`).join(", ");
  const noms = params.personnages.map((p) => p.nom).join(", ") || "(aucun)";
  const langue = NOMS_LANGUES[episode.langue];
  const system = [
    "Tu es scénariste de séries courtes en vidéo verticale, générées plan par plan par une IA vidéo.",
    "Chaque plan devient un clip de 3 à 15 secondes animé à partir d'une seule image : décris ce qu'on VOIT, en une ou deux phrases concrètes (cadrage, action, lumière), sans mouvement de caméra impossible.",
    "Règles de continuité : respecte strictement la bible et la mémoire, reprends là où l'épisode précédent s'est arrêté, garde les mêmes personnages avec la même apparence, fais avancer au moins un mystère ouvert si c'est cohérent, ne contredis jamais un fait établi.",
    "Règles de récit : le premier plan est une accroche forte (type accroche), il y a une montée de tension, un climax, et le dernier plan (type final) donne envie de voir la suite.",
    `Types de plan possibles : ${types}.`,
    `Les dialogues (type dialogue) ont un personnage choisi EXACTEMENT parmi : ${noms}, et une réplique courte (12 mots maximum) écrite en ${langue}.`,
    "Pour les autres types, personnage = null et replique = \"\".",
    `Écris les descriptions des plans en ${langue}.`,
    "Réponds uniquement en JSON.",
  ].join("\n");
  const precedents = params.precedents.length
    ? params.precedents.map((p) => `- ${p.code} « ${p.titre} » : ${p.idee} — se termine sur : ${p.fin}`).join("\n")
    : "- C'est le premier épisode.";
  const forme =
    episode.genre !== "episode"
      ? `Générique ${episode.genre === "opening" ? "d'ouverture" : "de fin"} de saison, ${params.nombrePlans} plans, sans dialogue.`
      : episode.format === "moyen"
        ? `Épisode YouTube de ${Math.round(episode.duree_cible / 60)} minutes en 16:9, ${params.nombrePlans} plans, section "principal". Le rythme peut prendre le temps d'installer une scène, mais garde une accroche forte et une fin qui appelle la suite.`
        : episode.format === "long"
        ? `Film de ${Math.round(episode.duree_cible / 60)} minutes en ${params.nombreChapitres} chapitres (sections "ch1", "ch2"…), environ ${params.nombrePlans} plans au total. Donne la liste "chapitres" [{section, titre}] et la section de chaque plan.`
        : `Épisode court de ${episode.duree_cible} secondes, ${params.nombrePlans} plans, section "principal".`;
  const user = [
    texteBible(params.serie, params.personnages),
    "",
    texteMemoire(params.memoire),
    "",
    `Épisodes précédents :\n${precedents}`,
    "",
    `À écrire : ${forme}`,
    `Titre de travail : ${episode.titre || "(à proposer)"}`,
    `Idée : ${episode.idee || "(libre, dans la continuité)"}`,
    "",
    'Format JSON : {"titre": string, "chapitres"?: [{"section": string, "titre": string}], "plans": [{"type": string, "texte": string, "personnage": string|null, "replique": string, "section": string}]}',
  ].join("\n");
  return { system, user };
}

/** Prompt de réécriture d'un plan ou d'un épisode à partir d'une demande de l'utilisateur. */
export function promptModification(params: { contexte: string; plans: readonly Pick<Plan, "id" | "type" | "texte" | "replique">[]; demande: string; langue: Langue }): MessagesIA {
  return {
    system: [
      "Tu modifies un scénario existant à la demande de son auteur.",
      "Change uniquement les plans nécessaires pour satisfaire la demande, garde les autres mots pour mots.",
      `Écris en ${NOMS_LANGUES[params.langue]}. Réponds uniquement en JSON : {"plans": [{"id": string, "texte": string, "replique": string}]} avec SEULEMENT les plans modifiés.`,
    ].join("\n"),
    user: `${params.contexte}\n\nPlans actuels :\n${params.plans.map((p) => `- ${p.id} [${p.type}] ${p.texte}${p.replique ? ` — « ${p.replique} »` : ""}`).join("\n")}\n\nDemande : ${params.demande}`,
  };
}

/** Prompt de l'image clé d'un plan (ChatGPT / OpenAI Images). */
export function promptImage(params: {
  serie: Pick<Serie, "style_visuel" | "univers">;
  personnagesPresents: readonly Pick<Personnage, "nom" | "description">[];
  plan: Pick<Plan, "texte" | "type">;
  vertical: boolean;
  planPrecedent: string | null;
  avecFiches: boolean;
}): string {
  const persos = params.personnagesPresents.map((p) => `${p.nom} : ${p.description}`).join(" ; ");
  return [
    `Style : ${params.serie.style_visuel}. ${params.vertical ? "Cadrage vertical 9:16." : "Cadrage horizontal 16:9."}`,
    params.serie.univers ? `Univers : ${params.serie.univers}` : "",
    persos ? `Personnages présents (apparence identique à chaque image) : ${persos}.` : "",
    params.avecFiches ? "Respecte exactement les fiches de référence fournies (visage, couleurs, vêtements)." : "",
    params.planPrecedent ? `Continuité avec le plan précédent : ${params.planPrecedent}` : "",
    `Scène : ${params.plan.texte}`,
    "Pas de texte écrit dans l'image, pas de logo, pas de filigrane.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Prompt d'animation d'un plan (Grok, image vers vidéo). */
export function promptVideo(plan: Pick<Plan, "texte" | "type">, duree: number, avecDialogue: boolean): string {
  const rythme = plan.type === "action" || plan.type === "climax" ? "mouvement dynamique" : plan.type === "decor" ? "mouvement de caméra lent" : "mouvement naturel";
  return `${plan.texte} Animation de ${duree} secondes, ${rythme}, cohérente avec l'image de départ.${avecDialogue ? "" : " Pas de dialogue parlé."}`;
}

/** Prompt d'extraction des faits à retenir après un épisode. Réponse conforme à `schemaFaitsIA`. */
export function promptMemoire(params: { serie: Pick<Serie, "nom">; episode: Pick<Episode, "titre">; plans: readonly Pick<Plan, "texte" | "replique">[]; memoire: readonly Pick<FaitMemoire, "genre" | "texte" | "ouvert">[] }): MessagesIA {
  return {
    system: [
      "Tu tiens la mémoire d'une série pour garder ses histoires cohérentes d'un épisode à l'autre.",
      "À partir de l'épisode, liste 2 à 6 faits NOUVEAUX à retenir (événements, état des personnages, lieux, objets importants) et les nouveaux mystères ouverts.",
      "Indique aussi, mot pour mot, les mystères ouverts déjà en mémoire que cet épisode résout.",
      'Réponds uniquement en JSON : {"faits": [{"genre": "fait"|"personnage"|"lieu"|"objet"|"mystere", "texte": string, "ouvert": boolean}], "mysteres_resolus": [string]}',
    ].join("\n"),
    user: `Série : ${params.serie.nom}\nÉpisode : ${params.episode.titre}\n\n${texteMemoire(params.memoire)}\n\nPlans de l'épisode :\n${params.plans.map((p, i) => `${i + 1}. ${p.texte}${p.replique ? ` — « ${p.replique} »` : ""}`).join("\n")}`,
  };
}

/** Prompt de traduction des répliques et du titre. Réponse : {"titre": {langue: texte}, "repliques": {id: {langue: texte}}}. */
export function promptTraduction(params: { titre: string; repliques: readonly { id: string; texte: string }[]; de: Langue; vers: readonly Langue[] }): MessagesIA {
  return {
    system: [
      "Tu traduis les dialogues d'une série animée. Garde le ton, la longueur courte et le registre oral, adapte les expressions plutôt que de traduire mot à mot.",
      'Réponds uniquement en JSON : {"titre": {"<langue>": string}, "repliques": {"<id>": {"<langue>": string}}}. Codes de langue : fr, en, ja, ko, pt.',
    ].join("\n"),
    user: `Langue d'origine : ${params.de}\nLangues cibles : ${params.vers.join(", ")}\nTitre : ${params.titre}\nRépliques :\n${params.repliques.map((r) => `${r.id} : ${r.texte}`).join("\n")}`,
  };
}

/** Prompt de la fiche de référence d'un personnage (face, profil, dos sur une même image). */
export function promptFiche(personnage: Pick<Personnage, "nom" | "description">, serie: Pick<Serie, "style_visuel">): string {
  return `Fiche de référence de personnage, style ${serie.style_visuel}. ${personnage.nom} : ${personnage.description}. Trois vues côte à côte sur fond uni clair : de face, de profil, de dos. Même éclairage neutre, corps entier, aucun texte.`;
}

/** Prompt de l'ambiance sonore d'un épisode (ElevenLabs, bruitages). */
export function promptBruitage(serie: Pick<Serie, "univers">, plans: readonly Pick<Plan, "texte">[]): string {
  const extrait = plans.slice(0, 3).map((p) => p.texte).join(" ");
  return `Ambiance sonore de fond, sans musique ni voix : ${serie.univers || ""} ${extrait}`.slice(0, 400);
}

// ---------------------------------------------------------------------------------------------
// Clips musicaux
// ---------------------------------------------------------------------------------------------

/** Style visuel d'un clip : le sien s'il est rempli, sinon celui de l'espace Clips. */
export function styleVisuelClip(serie: Pick<Serie, "style_visuel">, episode: Pick<Episode, "style_visuel">): string {
  return episode.style_visuel.trim() || serie.style_visuel;
}

/** Un segment du clip tel qu'envoyé à l'IA : son index, sa place dans la chanson et ce qui y est chanté. */
export type SegmentPourIA = { index: number; debut: number; fin: number; texte: string; type: string };

/**
 * Prompt d'écriture des scènes d'un clip musical (ChatGPT ou Claude).
 * Une description d'image par segment, qui illustre ce qui est chanté à ce moment et l'énergie de la musique.
 * Réponse attendue conforme à `schemaClipIA`.
 */
export function promptClip(params: {
  serie: Pick<Serie, "nom" | "style_visuel">;
  episode: Pick<Episode, "titre" | "idee" | "style_visuel" | "langue" | "format" | "musique_style">;
  personnages: readonly Pick<Personnage, "nom" | "description">[];
  segments: readonly SegmentPourIA[];
}): MessagesIA {
  const { episode } = params;
  const noms = params.personnages.map((p) => p.nom).join(", ");
  const system = [
    "Tu es réalisateur de clips musicaux. Le clip est généré plan par plan : une image fixe par plan (ChatGPT Images), animée ensuite en vidéo de quelques secondes par une IA (Grok), puis montée sur la chanson.",
    "Pour chaque segment, écris en français une description de ce qu'on VOIT (une ou deux phrases concrètes : sujet, action, cadrage, lumière, couleurs), qui illustre les paroles chantées à ce moment ou l'énergie de la musique quand il n'y a pas de paroles.",
    "Le clip raconte une histoire visuelle cohérente du début à la fin : mêmes personnages avec la même apparence, mêmes lieux qui reviennent, une progression jusqu'au refrain (segments de type climax, les plus spectaculaires) et une image finale forte.",
    "Varie les cadrages (plan large, plan moyen, gros plan) d'un segment à l'autre. Pas de texte écrit, pas de logo, pas de personne réelle ou célèbre, pas d'artiste existant.",
    noms ? `Personnages récurrents possibles (indique "personnage" quand l'un d'eux est à l'image, sinon null) : ${noms}.` : 'Pas de personnage imposé : "personnage" vaut toujours null.',
    'Réponds uniquement en JSON : {"titre": string, "plans": [{"index": number, "texte": string, "personnage": string|null}]} avec exactement un plan par segment, dans le même ordre.',
  ].join("\n");
  const persos = params.personnages.map((p) => `- ${p.nom} : ${p.description || "(sans description)"}`).join("\n");
  const segments = params.segments
    .map((s) => `${s.index}. [${s.type}] ${s.debut.toFixed(1)}–${s.fin.toFixed(1)} s : ${s.texte ? `« ${s.texte} »` : "(instrumental)"}`)
    .join("\n");
  const user = [
    `Artiste / espace : ${params.serie.nom}`,
    `Titre de la chanson : ${episode.titre || "(à proposer)"}`,
    `Langue de la chanson : ${NOMS_LANGUES[episode.langue]}`,
    `Style visuel : ${styleVisuelClip(params.serie, episode) || "(libre, cohérent avec la musique)"}`,
    episode.musique_style ? `Style musical : ${episode.musique_style}` : "",
    `Idée du clip : ${episode.idee || "(libre, inspirée des paroles)"}`,
    `Cadrage : ${episode.format === "court" ? "vertical 9:16" : "horizontal 16:9"}`,
    persos ? `Personnages :\n${persos}` : "",
    "",
    `Segments (${params.segments.length}) :`,
    segments,
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { system, user };
}

/** Prompt d'écriture de paroles à partir d'une idée. Réponse conforme à `schemaParolesIA`. */
export function promptParoles(params: { idee: string; style: string; langue: Langue; dureeCible: number; titre: string }): MessagesIA {
  const lignes = Math.max(8, Math.min(48, Math.round(params.dureeCible / 4)));
  return {
    system: [
      "Tu es parolier. Tu écris des paroles originales, chantables, avec des rimes ou assonances naturelles et un refrain qui revient.",
      "Marque chaque section sur sa propre ligne entre crochets : [Couplet 1], [Refrain], [Couplet 2], [Pont]…",
      "N'imite aucun artiste existant, ne reprends aucune parole existante.",
      'Réponds uniquement en JSON : {"titre": string, "paroles": string} (les sauts de ligne en \\n).',
    ].join("\n"),
    user: [
      `Langue des paroles : ${NOMS_LANGUES[params.langue]}`,
      `Titre de travail : ${params.titre || "(à proposer)"}`,
      `Style musical : ${params.style || "(libre)"}`,
      `Durée visée : environ ${Math.round(params.dureeCible)} s, soit à peu près ${lignes} lignes chantées.`,
      `Idée : ${params.idee || "(libre)"}`,
    ].join("\n"),
  };
}

/**
 * Prompt de traduction des paroles ligne par ligne, pour les sous-titres d'un clip.
 * Réponse : {"titre": {"<langue>": string}, "lignes": {"<langue>": string[]}} avec autant de lignes que l'original.
 */
export function promptTraductionParoles(params: { titre: string; lignes: readonly string[]; de: Langue; vers: readonly Langue[] }): MessagesIA {
  return {
    system: [
      "Tu traduis des paroles de chanson pour des sous-titres. Garde le sens et l'image, une ligne traduite par ligne originale, courte et lisible.",
      'Réponds uniquement en JSON : {"titre": {"<langue>": string}, "lignes": {"<langue>": [string]}} avec EXACTEMENT le même nombre de lignes que l\'original, dans le même ordre. Codes de langue : fr, en, ja, ko, pt.',
    ].join("\n"),
    user: `Langue d'origine : ${params.de}\nLangues cibles : ${params.vers.join(", ")}\nTitre : ${params.titre}\nLignes (${params.lignes.length}) :\n${params.lignes.map((l, i) => `${i + 1}. ${l}`).join("\n")}`,
  };
}

/** Prompt d'animation d'un plan de clip (Grok) : mouvement calé sur l'énergie de la musique, sans son généré. */
export function promptVideoClip(plan: Pick<Plan, "texte" | "type">, duree: number): string {
  const energie = plan.type === "climax" ? "mouvement ample et énergique, en rythme" : plan.type === "decor" ? "mouvement de caméra lent et fluide" : "mouvement naturel, en rythme avec une musique";
  return `${plan.texte} Animation de ${duree} secondes, ${energie}, cohérente avec l'image de départ. Pas de paroles, pas de texte à l'écran.`;
}
