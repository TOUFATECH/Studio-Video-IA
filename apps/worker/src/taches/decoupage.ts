// Découpage d'un clip musical (tâche « scenario » d'un épisode de genre « clip ») :
// segments calés sur les paroles et le tempo, une scène par segment écrite par ChatGPT ou Claude,
// traduction des paroles pour les sous-titres, puis remplacement des plans.
import {
  decouperClip,
  decouperInstrumental,
  extraitClip,
  languesATraduire,
  LANGUES,
  promptClip,
  promptTraductionParoles,
  schemaClipIA,
  type Langue,
  type SegmentClip,
} from "@studio-video-ia/core";
import { z } from "zod";
import type { Contexte } from "../contexte";
import { chansonDuClip, supprimerFichiers, type EpisodeComplet } from "../donnees";
import { demanderTexteIA } from "../ia";
import { sonder } from "../rendu/executant";
import { ecrire } from "../bdd";
import { trouverPersonnage } from "./scenario";

/** Réponse attendue pour la traduction des paroles. */
export const schemaTraductionParolesIA = z.object({
  titre: z.record(z.string()).default({}),
  lignes: z.record(z.array(z.string())).default({}),
});

/** Texte d'un plan quand l'IA n'a rien renvoyé pour son segment : on garde un plan utilisable et modifiable. */
export function texteDeSecours(s: SegmentClip, idee: string): string {
  return s.texte ? `Illustration de « ${s.texte} ». ${idee}`.trim() : `Plan d'ambiance en rythme avec la musique. ${idee}`.trim();
}

/**
 * Traduit les paroles synchronisées dans les langues de sous-titres qui n'en ont pas encore (ligne pour ligne),
 * enregistre le résultat et met à jour l'épisode en mémoire. Utilisé au découpage et, si besoin, au rendu.
 */
export async function traduireParoles(ctx: Contexte, e: EpisodeComplet, titreDeSecours = ""): Promise<void> {
  const lignes = e.episode.paroles_alignees ?? [];
  const vers = languesATraduire(e.episode.langue, [e.episode.langue], e.episode.sous_titres).filter((l) => (e.episode.paroles_traduites[l]?.length ?? 0) !== lignes.length);
  if (!vers.length || !lignes.length) return;
  await ctx.progression({ etape: `Traduction des paroles (${vers.join(", ")})` });
  const r = await demanderTexteIA(ctx, e.episode.fournisseur_texte, promptTraductionParoles({ titre: e.episode.titre || titreDeSecours, lignes: lignes.map((l) => l.texte), de: e.episode.langue, vers }), schemaTraductionParolesIA);
  const traduites = { ...e.episode.paroles_traduites };
  const titres = { ...e.episode.titres_traduits };
  for (const l of LANGUES as readonly Langue[]) {
    if (!vers.includes(l)) continue;
    const t = r.lignes[l];
    // Une traduction au mauvais nombre de lignes décalerait tous les sous-titres : on la refuse.
    if (t && t.length === lignes.length) traduites[l] = t.map((x) => x.trim());
    else ctx.journal(`traduction ${l} ignorée : ${t?.length ?? 0} lignes au lieu de ${lignes.length}`);
    const titre = r.titre[l]?.trim();
    if (titre) titres[l] = titre;
  }
  e.episode.paroles_traduites = traduites;
  e.episode.titres_traduits = titres;
  await ecrire(ctx.db.from("episodes").update({ paroles_traduites: traduites, titres_traduits: titres }).eq("id", e.episode.id), "paroles traduites");
}

/** Découpe le clip et écrit ses scènes. */
export async function decouperLeClip(ctx: Contexte, e: EpisodeComplet): Promise<void> {
  const f = chansonDuClip(e.fichiers);
  if (!f?.chemin) throw new Error("Pas de chanson : ajoute-la dans l'étape « Son et paroles ».");
  if (e.episode.paroles_alignees === null) throw new Error("Les paroles ne sont pas encore synchronisées avec la chanson : lance d'abord la synchronisation.");
  await ctx.progression({ fait: 0, total: 4, etape: "Découpage sur les paroles et le tempo" });
  let dureeChanson = f.duree_s ? Number(f.duree_s) : 0;
  if (!dureeChanson) {
    const local = await ctx.stockage.telechargerVers(f.chemin, `${await ctx.dossier()}/chanson`);
    dureeChanson = (await sonder(ctx.config.ffprobe, local, ctx.signal)).duree;
  }
  const extrait = extraitClip(e.episode, dureeChanson);
  const lignes = e.episode.paroles_alignees;
  const segments = lignes.length && !e.episode.instrumental ? decouperClip({ lignes, extrait, bpm: e.episode.bpm }) : decouperInstrumental(extrait, e.episode.bpm);

  await ctx.progression({ fait: 1, total: 4, etape: `Écriture de ${segments.length} scènes par ${e.episode.fournisseur_texte === "anthropic" ? "Claude" : "ChatGPT"}` });
  const scenes = await demanderTexteIA(
    ctx,
    e.episode.fournisseur_texte,
    promptClip({ serie: e.serie, episode: e.episode, personnages: e.personnages, segments: segments.map((s, index) => ({ index, ...s })) }),
    schemaClipIA,
  );
  ctx.verifierArret();

  // Traduction des paroles pour les sous-titres dans une autre langue que celle de la chanson.
  await traduireParoles(ctx, e, scenes.titre);

  await ctx.progression({ fait: 3, total: 4, etape: "Enregistrement des plans" });
  await supprimerFichiers(ctx.db, ctx.stockage, e.fichiers.filter((x) => x.plan_id || x.genre === "rendu" || x.genre === "miniature"));
  await ecrire(ctx.db.from("plans").delete().eq("episode_id", e.episode.id), "suppression des anciens plans");
  // Les publications programmées attendront le nouveau rendu ; une vidéo déjà envoyée sur YouTube ne correspond plus.
  await ecrire(
    ctx.db.from("publications").update({ statut: "attend_rendu" }).eq("episode_id", e.episode.id).eq("statut", "programmee").is("id_externe", null),
    "publications en attente du nouveau rendu",
  );
  await ecrire(
    ctx.db
      .from("publications")
      .update({ statut: "echec", id_externe: null, url: null, erreur: "Le clip a été redécoupé après l’envoi sur YouTube : supprime l’ancienne vidéo dans YouTube Studio, puis clique Réessayer après le nouveau rendu." })
      .eq("episode_id", e.episode.id)
      .eq("statut", "programmee")
      .not("id_externe", "is", null),
    "publications YouTube périmées",
  );
  const parIndex = new Map(scenes.plans.map((p) => [p.index, p]));
  const nouveaux = segments.map((s, i) => {
    const scene = parIndex.get(i) ?? scenes.plans[i];
    const perso = trouverPersonnage(e.personnages, scene?.personnage ?? null);
    return {
      episode_id: e.episode.id,
      position: i,
      section: "principal",
      type: s.type,
      texte: scene?.texte?.trim() || texteDeSecours(s, e.episode.idee),
      personnage_id: perso?.id ?? null,
      replique: "",
      repliques_traduites: {},
      valide: false,
      modifie: false,
      prise_choisie: "A",
      debut: s.debut,
      fin: s.fin,
    };
  });
  await ecrire(ctx.db.from("plans").insert(nouveaux), "enregistrement des plans");
  const duree = Math.round(extrait.fin - extrait.debut);
  const maj: Record<string, unknown> = {
    duree_cible: Math.min(1200, Math.max(15, duree)),
    miniature: null,
    extrait_debut: extrait.debut,
    extrait_fin: extrait.fin,
  };
  if (!e.episode.titre.trim()) maj.titre = scenes.titre.slice(0, 200);
  await ecrire(ctx.db.from("episodes").update(maj).eq("id", e.episode.id), "mise à jour du clip");
  await ctx.progression({ fait: 4, total: 4, etape: `${nouveaux.length} plans calés sur la chanson` });
}
