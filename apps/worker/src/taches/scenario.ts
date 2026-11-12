// Tâche « scenario » : écriture complète d'un épisode par l'IA, ou modification ciblée de plans à la demande.
import {
  BORNES_DUREE,
  DUREE_PLAN,
  EFFETS,
  nombreChapitres,
  nombrePlansCible,
  promptArc,
  promptModification,
  promptScenario,
  schemaArcIA,
  schemaScenarioIA,
  texteBible,
  TRANSITIONS,
  type Element,
  type EpisodePrecedent,
  type FaitMemoire,
  type Fichier,
  type Personnage,
  type Plan,
  type Saison,
  type Serie,
} from "@studio-video-ia/core";
import { chargerBibliotheque } from "../donnees";
import { demanderJson } from "@studio-video-ia/integrations";
import { demanderTexteIA, fournisseurDisponible } from "../ia";
import { decouperLeClip } from "./decoupage";
import { z } from "zod";
import { exigerCle } from "../cles";
import type { Contexte } from "../contexte";
import { chargerEpisode, supprimerFichiers, type EpisodeComplet } from "../donnees";
import { ecrire, lignes, ligneOuNull } from "../bdd";

/** Données acceptées par la tâche. */
export const schemaDonneesScenario = z.object({
  // « ecriture » : valeur envoyée par d'anciennes versions du site, traitée comme « ecrire ».
  // « arc » : découpage d'une saison en épisodes (tâche sans épisode, avec saison_id).
  mode: z
    .enum(["ecrire", "ecriture", "modification", "arc"])
    .default("ecrire")
    .transform((m) => (m === "ecriture" ? "ecrire" : m)),
  demande: z.string().optional(),
  plan_ids: z.array(z.string()).optional(),
  saison_id: z.string().optional(),
  idee: z.string().max(4000).optional(),
  nombre: z.number().int().min(1).max(30).optional(),
});

/** Retrouve un élément de la bibliothèque par son nom (casse et accents ignorés), dans un genre donné. */
export function trouverElement(elements: readonly Element[], nom: string | null | undefined, genre: Element["genre"]): Element | null {
  if (!nom) return null;
  const cle = cleNom(nom);
  return elements.find((e) => e.genre === genre && cleNom(e.nom) === cle) ?? null;
}

/** Ramène une valeur libre à une des clés permises, sinon la valeur par défaut. */
function parmi<T extends string>(valeur: string | null | undefined, permises: Record<T, string>, defaut: T): T {
  const v = (valeur ?? "").trim().toLowerCase();
  return (Object.keys(permises) as T[]).find((k) => k === v) ?? defaut;
}

/** Réponse attendue de l'IA pour une modification. */
export const schemaModificationIA = z.object({ plans: z.array(z.object({ id: z.string(), texte: z.string().min(1), replique: z.string().default("") })) });

/** Clé de comparaison d'un nom de personnage (casse, accents et espaces ignorés). */
export function cleNom(nom: string): string {
  return nom.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Retrouve un personnage par son nom, sans tenir compte de la casse ni des accents. */
export function trouverPersonnage(personnages: readonly Personnage[], nom: string | null): Personnage | null {
  if (!nom) return null;
  const cle = cleNom(nom);
  return personnages.find((p) => cleNom(p.nom) === cle) ?? null;
}

/** Les 3 épisodes précédents de la série (même ordre que l'interface : saison puis numéro). */
async function episodesPrecedents(ctx: Contexte, e: EpisodeComplet): Promise<EpisodePrecedent[]> {
  const saisons = await lignes<{ id: string; numero: number }>(ctx.db.from("saisons").select("id, numero").eq("serie_id", e.serie.id), "saisons");
  const numeroSaison = new Map(saisons.map((s) => [s.id, s.numero]));
  const episodes = await lignes<{ id: string; saison_id: string; numero: number; titre: string; idee: string }>(
    ctx.db.from("episodes").select("id, saison_id, numero, titre, idee").eq("serie_id", e.serie.id).eq("genre", "episode"),
    "épisodes de la série",
  );
  const ordre = (x: { saison_id: string; numero: number }): number => (numeroSaison.get(x.saison_id) ?? 0) * 10_000 + x.numero;
  const courant = ordre(e.episode);
  const avant = episodes.filter((x) => x.id !== e.episode.id && ordre(x) < courant).sort((a, b) => ordre(a) - ordre(b)).slice(-3);
  const out: EpisodePrecedent[] = [];
  for (const x of avant) {
    const dernier = await ligneOuNull<{ texte: string }>(ctx.db.from("plans").select("texte").eq("episode_id", x.id).order("position", { ascending: false }).limit(1), "dernier plan");
    out.push({ code: `S${numeroSaison.get(x.saison_id) ?? 1}E${x.numero}`, titre: x.titre, idee: x.idee, fin: dernier?.texte ?? "(pas encore écrit)" });
  }
  return out;
}

/** Fichiers dérivés de tout l'épisode (rendus, bande annonce, bruitage) : périmés dès que le scénario change. */
function fichiersDerives(fichiers: readonly Fichier[]): Fichier[] {
  return fichiers.filter((f) => f.genre === "rendu" || f.genre === "bande_annonce" || f.genre === "bruitage");
}

/** Exécute la tâche scenario. */
export async function tacheScenario(ctx: Contexte): Promise<void> {
  const donnees = schemaDonneesScenario.parse(ctx.tache.donnees ?? {});
  if (donnees.mode === "arc") return ecrireArc(ctx, donnees.saison_id ?? "", donnees.idee ?? "", donnees.nombre ?? null);
  if (!ctx.tache.episode_id) throw new Error("Tâche scénario sans épisode.");
  const e = await chargerEpisode(ctx.db, ctx.tache.episode_id);
  if (donnees.mode === "modification") return modifier(ctx, e, donnees.demande ?? "", donnees.plan_ids);
  // Un clip musical se découpe sur sa chanson au lieu de s'écrire comme un épisode.
  if (e.episode.genre === "clip") return decouperLeClip(ctx, e);
  const cle = exigerCle(await ctx.cles(), "openai");

  await ctx.progression({ fait: 0, total: 3, etape: "Préparation du contexte (bible, mémoire, épisodes précédents)" });
  const memoire = await lignes<FaitMemoire>(ctx.db.from("memoire").select("*").eq("serie_id", e.serie.id).order("cree_le"), "mémoire");
  const precedents = await episodesPrecedents(ctx, e);
  const messages = promptScenario({
    serie: e.serie,
    personnages: e.personnages,
    memoire,
    precedents,
    episode: e.episode,
    nombrePlans: nombrePlansCible(e.episode.format, e.episode.duree_cible),
    nombreChapitres: nombreChapitres(e.episode.duree_cible),
    bibliotheque: e.elements,
    arc: e.saison.arc,
  });
  await ctx.progression({ fait: 1, total: 3, etape: "Écriture du scénario par l'IA" });
  // ChatGPT par défaut ; Claude si l'épisode le demande et que sa clé est enregistrée.
  const scenario = e.episode.fournisseur_texte === "anthropic" ? await demanderTexteIA(ctx, "anthropic", messages, schemaScenarioIA) : await demanderJson(cle, ctx.config.modeles.texte, messages, schemaScenarioIA, ctx.f);
  ctx.verifierArret();

  await ctx.progression({ fait: 2, total: 3, etape: "Enregistrement des plans" });
  // Remplacement complet : anciens plans et tous leurs fichiers (images, clips, voix), plus les rendus périmés.
  const anciensPlans = new Set(e.plans.map((p) => p.id));
  await supprimerFichiers(ctx.db, ctx.stockage, [...e.fichiers.filter((f) => f.plan_id && anciensPlans.has(f.plan_id)), ...fichiersDerives(e.fichiers)]);
  await ecrire(ctx.db.from("plans").delete().eq("episode_id", e.episode.id), "suppression des anciens plans");
  await ecrire(ctx.db.from("scenes").delete().eq("episode_id", e.episode.id), "suppression des anciennes scènes");
  const long = e.episode.format === "long";
  // Scènes : lieu et personnages retrouvés par leur nom dans la bibliothèque.
  const scenes = (scenario.scenes ?? []).map((sc, i) => ({
    episode_id: e.episode.id,
    position: i,
    titre: sc.titre,
    lieu_id: trouverElement(e.elements, sc.lieu, "decor")?.id ?? null,
    moment: sc.moment ?? "",
    resume: sc.resume,
    personnages: (sc.personnages ?? []).map((n) => trouverPersonnage(e.personnages, n)?.id).filter((x): x is string => !!x),
  }));
  const idsScenes: string[] = [];
  if (scenes.length) {
    const inserees = await lignes<{ id: string; position: number }>(ctx.db.from("scenes").insert(scenes).select("id, position"), "enregistrement des scènes");
    for (const x of [...inserees].sort((a, b) => a.position - b.position)) idsScenes.push(x.id);
  }
  const court = e.episode.format === "court";
  const nouveaux = scenario.plans.map((p, i) => {
    const perso = trouverPersonnage(e.personnages, p.personnage);
    const presents = (p.personnages ?? []).map((n) => trouverPersonnage(e.personnages, n)?.id).filter((x): x is string => !!x);
    const scene = p.scene != null ? idsScenes[p.scene] ?? null : null;
    // Durée proposée par l'IA : de 1 à 8 s pour un épisode court ; ailleurs, la répartition automatique décide.
    const duree = court && p.duree != null ? Math.min(DUREE_PLAN.max, Math.max(DUREE_PLAN.min, Math.round(p.duree * 2) / 2)) : null;
    return {
      episode_id: e.episode.id,
      position: i,
      section: p.section?.trim() || (long ? "ch1" : "principal"),
      type: p.type,
      texte: p.texte,
      personnage_id: perso?.id ?? null,
      // Une réplique sans personnage connu ne peut pas être dite : on la garde quand même, l'utilisateur choisira.
      replique: p.replique ?? "",
      repliques_traduites: {},
      valide: false,
      modifie: false,
      prise_choisie: "A",
      scene_id: scene,
      duree,
      personnages: [...new Set([...(perso ? [perso.id] : []), ...presents])],
      decor_id: trouverElement(e.elements, p.decor, "decor")?.id ?? (scene ? scenes[p.scene ?? -1]?.lieu_id ?? null : null),
      activite_id: trouverElement(e.elements, p.activite, "activite")?.id ?? null,
      cadrage: (p.cadrage ?? "").slice(0, 200),
      mouvement: (p.mouvement ?? "").slice(0, 500),
      texte_ecran: (p.texte_ecran ?? "").slice(0, 200),
      son: (p.son ?? "").slice(0, 300),
      effet: parmi(p.effet, EFFETS, "aucun"),
      transition: parmi(p.transition, TRANSITIONS, "coupe"),
    };
  });
  await ecrire(ctx.db.from("plans").insert(nouveaux), "enregistrement des plans");
  // Nouveau scénario : il est à relire et valider avant de générer les images.
  const majEpisode: Record<string, unknown> = { titres_traduits: {}, memoire_faite: false, scenario_valide: false };
  if (!e.episode.titre.trim()) majEpisode.titre = scenario.titre;
  if (!e.episode.accroche.trim() && scenario.accroche) majEpisode.accroche = scenario.accroche.slice(0, 500);
  if (!e.episode.deroule.trim() && scenario.deroule) majEpisode.deroule = scenario.deroule.slice(0, 20000);
  if (!e.episode.fin_suite.trim() && scenario.fin) majEpisode.fin_suite = scenario.fin.slice(0, 500);
  if (long) {
    const sections = [...new Set(nouveaux.map((p) => p.section))];
    majEpisode.chapitres = scenario.chapitres?.length ? scenario.chapitres : sections.map((s, i) => ({ section: s, titre: `Chapitre ${i + 1}` }));
  }
  await ecrire(ctx.db.from("episodes").update(majEpisode).eq("id", e.episode.id), "mise à jour de l'épisode");
  await ctx.progression({ fait: 3, total: 3, etape: `${nouveaux.length} plans écrits` });
}

/** Modification ciblée : seuls les plans renvoyés par l'IA changent ; ils repassent à valider et perdent leurs fichiers. */
async function modifier(ctx: Contexte, e: EpisodeComplet, demande: string, planIds: string[] | undefined): Promise<void> {
  if (!demande.trim()) throw new Error("Demande de modification vide.");
  const cibles: Plan[] = planIds?.length ? e.plans.filter((p) => planIds.includes(p.id)) : e.plans;
  if (cibles.length === 0) throw new Error("Aucun plan à modifier.");
  await ctx.progression({ fait: 0, total: 2, etape: "Réécriture par l'IA" });
  const contexte = `${texteBible(e.serie, e.personnages)}\n\nÉpisode : ${e.episode.titre}\nIdée : ${e.episode.idee}`;
  // Un clip garde l'IA choisie (ChatGPT ou Claude) ; ses scènes sont décrites en français.
  const clip = e.episode.genre === "clip";
  const reponse = await demanderTexteIA(
    ctx,
    clip ? e.episode.fournisseur_texte : "openai",
    promptModification({ contexte: clip ? `${contexte}\nClip musical : ne change pas les paroles, seulement ce qu'on voit.` : contexte, plans: cibles, demande, langue: clip ? "fr" : e.episode.langue }),
    schemaModificationIA,
  );
  const autorises = new Set(cibles.map((p) => p.id));
  const modifies = reponse.plans.filter((p) => autorises.has(p.id));
  await ctx.progression({ fait: 1, total: 2, etape: `${modifies.length} plan(s) modifié(s)` });
  for (const m of modifies) {
    const avant = e.plans.find((p) => p.id === m.id);
    const repliqueChangee = (avant?.replique ?? "") !== m.replique;
    await ecrire(
      ctx.db
        .from("plans")
        .update({ texte: m.texte, replique: m.replique, modifie: true, valide: false, ...(repliqueChangee ? { repliques_traduites: {} } : {}) })
        .eq("id", m.id),
      "plan modifié",
    );
  }
  const ids = new Set(modifies.map((m) => m.id));
  await supprimerFichiers(ctx.db, ctx.stockage, [...e.fichiers.filter((f) => f.plan_id && ids.has(f.plan_id)), ...(ids.size ? fichiersDerives(e.fichiers) : [])]);
  await ctx.progression({ fait: 2, total: 2, etape: `${modifies.length} plan(s) modifié(s)` });
}

/**
 * Arc de saison : l'IA découpe l'idée en N épisodes (titre, résumé, accroche) avec une progression logique.
 * Les épisodes existants sans scénario reçoivent leur titre et leur idée ; les manquants sont créés.
 * Un épisode déjà écrit (avec des plans) n'est jamais modifié.
 */
async function ecrireArc(ctx: Contexte, saisonId: string, idee: string, nombre: number | null): Promise<void> {
  if (!saisonId) throw new Error("Arc de saison sans saison.");
  const saison = await ligneOuNull<Saison>(ctx.db.from("saisons").select("*").eq("id", saisonId).limit(1), "saison");
  if (!saison) throw new Error("Saison introuvable.");
  const serie = await ligneOuNull<Serie>(ctx.db.from("series").select("*").eq("id", saison.serie_id).limit(1), "série");
  if (!serie || serie.espace_id !== ctx.tache.espace_id) throw new Error("Saison hors du compte de la tâche.");
  const n = nombre ?? saison.nombre_episodes ?? 12;
  await ctx.progression({ fait: 0, total: 3, etape: "Préparation du contexte (bible, bibliothèque, mémoire)" });
  const [personnages, memoire, biblio] = await Promise.all([
    lignes<Personnage>(ctx.db.from("personnages").select("*").eq("serie_id", serie.id).order("position"), "personnages"),
    lignes<FaitMemoire>(ctx.db.from("memoire").select("*").eq("serie_id", serie.id).order("cree_le"), "mémoire"),
    chargerBibliotheque(ctx.db, serie),
  ]);
  const fournisseur = (await fournisseurDisponible(ctx, "openai")) ?? "openai";
  await ctx.progression({ fait: 1, total: 3, etape: `Découpage de la saison en ${n} épisodes par l'IA` });
  const arc = await demanderTexteIA(
    ctx,
    fournisseur,
    promptArc({ serie, personnages, memoire, saison: { numero: saison.numero, titre: saison.titre ?? "" }, idee: idee || saison.arc || "", nombre: n, langue: serie.langue, bibliotheque: biblio.elements }),
    schemaArcIA,
  );
  ctx.verifierArret();
  await ctx.progression({ fait: 2, total: 3, etape: "Enregistrement des épisodes" });
  await ecrire(
    ctx.db.from("saisons").update({ arc: arc.arc.slice(0, 20000), nombre_episodes: n, ...(saison.titre?.trim() ? {} : { titre: arc.titre.slice(0, 120) }) }).eq("id", saison.id),
    "arc de la saison",
  );
  const existants = await lignes<{ id: string; numero: number }>(ctx.db.from("episodes").select("id, numero").eq("saison_id", saison.id).eq("genre", "episode"), "épisodes de la saison");
  const ecrits = new Set((await lignes<{ episode_id: string }>(ctx.db.from("plans").select("episode_id").in("episode_id", existants.map((x) => x.id)), "plans existants")).map((x) => x.episode_id));
  let crees = 0;
  let maj = 0;
  for (const [i, ep] of arc.episodes.slice(0, n).entries()) {
    const numero = i + 1;
    const existant = existants.find((x) => x.numero === numero);
    const valeurs = { titre: ep.titre.slice(0, 200), idee: ep.resume.slice(0, 4000), accroche: (ep.accroche ?? "").slice(0, 500) };
    if (existant) {
      if (ecrits.has(existant.id)) continue;
      await ecrire(ctx.db.from("episodes").update(valeurs).eq("id", existant.id), "épisode de l'arc");
      maj++;
    } else {
      await ecrire(
        ctx.db.from("episodes").insert({
          serie_id: serie.id,
          saison_id: saison.id,
          genre: "episode",
          numero,
          format: "court",
          duree_cible: BORNES_DUREE.court.defaut,
          langue: serie.langue,
          langues: [serie.langue],
          sous_titres: { [serie.langue]: "aucun" },
          ...valeurs,
        }),
        "nouvel épisode de l'arc",
      );
      crees++;
    }
  }
  await ctx.progression({ fait: 3, total: 3, etape: `Arc écrit : ${crees} épisode(s) créé(s), ${maj} mis à jour` });
}
