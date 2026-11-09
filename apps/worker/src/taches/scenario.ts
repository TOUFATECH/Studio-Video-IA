// Tâche « scenario » : écriture complète d'un épisode par l'IA, ou modification ciblée de plans à la demande.
import {
  nombreChapitres,
  nombrePlansCible,
  promptModification,
  promptScenario,
  schemaScenarioIA,
  texteBible,
  type EpisodePrecedent,
  type FaitMemoire,
  type Fichier,
  type Personnage,
  type Plan,
} from "@studio-video-ia/core";
import { demanderJson } from "@studio-video-ia/integrations";
import { z } from "zod";
import { exigerCle } from "../cles";
import type { Contexte } from "../contexte";
import { chargerEpisode, supprimerFichiers, type EpisodeComplet } from "../donnees";
import { ecrire, lignes, ligneOuNull } from "../supabase";

/** Données acceptées par la tâche. */
export const schemaDonneesScenario = z.object({
  mode: z.enum(["ecrire", "modification"]).default("ecrire"),
  demande: z.string().optional(),
  plan_ids: z.array(z.string()).optional(),
});

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
  if (!ctx.tache.episode_id) throw new Error("Tâche scénario sans épisode.");
  const e = await chargerEpisode(ctx.db, ctx.tache.episode_id);
  const cle = exigerCle(await ctx.cles(), "openai");
  if (donnees.mode === "modification") return modifier(ctx, e, cle, donnees.demande ?? "", donnees.plan_ids);

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
  });
  await ctx.progression({ fait: 1, total: 3, etape: "Écriture du scénario par l'IA" });
  const scenario = await demanderJson(cle, ctx.config.modeles.texte, messages, schemaScenarioIA, ctx.f);
  ctx.verifierArret();

  await ctx.progression({ fait: 2, total: 3, etape: "Enregistrement des plans" });
  // Remplacement complet : anciens plans et tous leurs fichiers (images, clips, voix), plus les rendus périmés.
  const anciensPlans = new Set(e.plans.map((p) => p.id));
  await supprimerFichiers(ctx.db, ctx.stockage, [...e.fichiers.filter((f) => f.plan_id && anciensPlans.has(f.plan_id)), ...fichiersDerives(e.fichiers)]);
  await ecrire(ctx.db.from("plans").delete().eq("episode_id", e.episode.id), "suppression des anciens plans");
  const long = e.episode.format === "long";
  const nouveaux = scenario.plans.map((p, i) => {
    const perso = trouverPersonnage(e.personnages, p.personnage);
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
    };
  });
  await ecrire(ctx.db.from("plans").insert(nouveaux), "enregistrement des plans");
  const majEpisode: Record<string, unknown> = { titres_traduits: {}, memoire_faite: false };
  if (!e.episode.titre.trim()) majEpisode.titre = scenario.titre;
  if (long) {
    const sections = [...new Set(nouveaux.map((p) => p.section))];
    majEpisode.chapitres = scenario.chapitres?.length ? scenario.chapitres : sections.map((s, i) => ({ section: s, titre: `Chapitre ${i + 1}` }));
  }
  await ecrire(ctx.db.from("episodes").update(majEpisode).eq("id", e.episode.id), "mise à jour de l'épisode");
  await ctx.progression({ fait: 3, total: 3, etape: `${nouveaux.length} plans écrits` });
}

/** Modification ciblée : seuls les plans renvoyés par l'IA changent ; ils repassent à valider et perdent leurs fichiers. */
async function modifier(ctx: Contexte, e: EpisodeComplet, cle: string, demande: string, planIds: string[] | undefined): Promise<void> {
  if (!demande.trim()) throw new Error("Demande de modification vide.");
  const cibles: Plan[] = planIds?.length ? e.plans.filter((p) => planIds.includes(p.id)) : e.plans;
  if (cibles.length === 0) throw new Error("Aucun plan à modifier.");
  await ctx.progression({ fait: 0, total: 2, etape: "Réécriture par l'IA" });
  const contexte = `${texteBible(e.serie, e.personnages)}\n\nÉpisode : ${e.episode.titre}\nIdée : ${e.episode.idee}`;
  const reponse = await demanderJson(cle, ctx.config.modeles.texte, promptModification({ contexte, plans: cibles, demande, langue: e.episode.langue }), schemaModificationIA, ctx.f);
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
