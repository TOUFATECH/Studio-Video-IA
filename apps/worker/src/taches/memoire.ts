// Tâche « memoire » : extraction des faits à retenir après un épisode, fermeture des mystères résolus.
import { promptMemoire, schemaFaitsIA, type FaitMemoire } from "@feuilleton/core";
import { demanderJson } from "@feuilleton/integrations";
import { exigerCle } from "../cles";
import type { Contexte } from "../contexte";
import { chargerEpisode } from "../donnees";
import { cleNom } from "./scenario";
import { ecrire, lignes } from "../supabase";

/** Mystères ouverts que l'IA déclare résolus (comparaison souple : casse, accents, inclusion). */
export function mysteresResolus(ouverts: readonly Pick<FaitMemoire, "id" | "texte">[], resolus: readonly string[]): string[] {
  const cibles = resolus.map(cleNom).filter(Boolean);
  return ouverts.filter((m) => cibles.some((c) => cleNom(m.texte) === c || cleNom(m.texte).includes(c) || c.includes(cleNom(m.texte)))).map((m) => m.id);
}

/** Exécute la tâche memoire. */
export async function tacheMemoire(ctx: Contexte): Promise<void> {
  if (!ctx.tache.episode_id) throw new Error("Tâche mémoire sans épisode.");
  const e = await chargerEpisode(ctx.db, ctx.tache.episode_id);
  if (e.plans.length === 0) throw new Error("L'épisode n'a pas de plans : rien à retenir.");
  const cle = exigerCle(await ctx.cles(), "openai");
  const memoire = await lignes<FaitMemoire>(ctx.db.from("memoire").select("*").eq("serie_id", e.serie.id).order("cree_le"), "mémoire");
  await ctx.progression({ fait: 0, total: 2, etape: "Lecture de l'épisode par l'IA" });
  const r = await demanderJson(cle, ctx.config.modeles.texte, promptMemoire({ serie: e.serie, episode: e.episode, plans: e.plans, memoire }), schemaFaitsIA, ctx.f);
  await ctx.progression({ fait: 1, total: 2, etape: `${r.faits.length} fait(s) à retenir` });
  if (r.faits.length) {
    await ecrire(
      ctx.db.from("memoire").insert(r.faits.map((f) => ({ serie_id: e.serie.id, episode_id: e.episode.id, genre: f.genre, texte: f.texte, ouvert: f.genre === "mystere" ? f.ouvert : false }))),
      "faits de mémoire",
    );
  }
  const fermes = mysteresResolus(
    memoire.filter((m) => m.genre === "mystere" && m.ouvert),
    r.mysteres_resolus,
  );
  if (fermes.length) await ecrire(ctx.db.from("memoire").update({ ouvert: false }).in("id", fermes), "mystères résolus");
  await ecrire(ctx.db.from("episodes").update({ memoire_faite: true }).eq("id", e.episode.id), "mémoire faite");
  await ctx.progression({ fait: 2, total: 2, etape: `${r.faits.length} fait(s) ajouté(s), ${fermes.length} mystère(s) résolu(s)` });
}
