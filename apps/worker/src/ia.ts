// Choix du modèle de texte : ChatGPT (OpenAI) ou Claude (Anthropic), selon le réglage du clip.
import type { FournisseurTexte } from "@studio-video-ia/core";
import { demanderJson, demanderJsonClaude, type ImageJointe } from "@studio-video-ia/integrations";
import type { z } from "zod";
import { exigerCle } from "./cles";
import type { Contexte } from "./contexte";

/** Demande une réponse JSON validée au fournisseur de texte choisi (clé correspondante obligatoire). */
export async function demanderTexteIA<T>(
  ctx: Contexte,
  fournisseur: FournisseurTexte,
  messages: { system: string; user: string },
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  images: readonly ImageJointe[] = [],
): Promise<T> {
  const cles = await ctx.cles();
  if (fournisseur === "anthropic") return demanderJsonClaude(exigerCle(cles, "anthropic"), ctx.config.modeles.claude, messages, schema, ctx.f, images);
  return demanderJson(exigerCle(cles, "openai"), ctx.config.modeles.texte, messages, schema, ctx.f, images);
}

/** Fournisseur de texte disponible : celui demandé s'il a sa clé, sinon l'autre, sinon null. */
export async function fournisseurDisponible(ctx: Contexte, prefere: FournisseurTexte): Promise<FournisseurTexte | null> {
  const cles = await ctx.cles();
  if (cles[prefere]) return prefere;
  const autre: FournisseurTexte = prefere === "openai" ? "anthropic" : "openai";
  return cles[autre] ? autre : null;
}
