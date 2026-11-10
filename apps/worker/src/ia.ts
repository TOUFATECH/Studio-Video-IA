// Choix du modèle de texte : ChatGPT (OpenAI) ou Claude (Anthropic), selon le réglage du clip.
import type { FournisseurTexte } from "@studio-video-ia/core";
import { demanderJson, demanderJsonClaude } from "@studio-video-ia/integrations";
import type { z } from "zod";
import { exigerCle } from "./cles";
import type { Contexte } from "./contexte";

/** Demande une réponse JSON validée au fournisseur de texte choisi (clé correspondante obligatoire). */
export async function demanderTexteIA<T>(
  ctx: Contexte,
  fournisseur: FournisseurTexte,
  messages: { system: string; user: string },
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const cles = await ctx.cles();
  if (fournisseur === "anthropic") return demanderJsonClaude(exigerCle(cles, "anthropic"), ctx.config.modeles.claude, messages, schema, ctx.f);
  return demanderJson(exigerCle(cles, "openai"), ctx.config.modeles.texte, messages, schema, ctx.f);
}
