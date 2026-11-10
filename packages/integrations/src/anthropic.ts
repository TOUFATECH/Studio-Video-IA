// Client Anthropic (Claude) : réponses JSON validées, utilisées pour écrire les scènes et les paroles des clips.
import { z } from "zod";
import type { Fetch } from "./contrat";
import { appelJson, erreurReponseInvalide } from "./http";

/** Adresse de base de l'API Anthropic. */
export const BASE_ANTHROPIC = "https://api.anthropic.com/v1";
/** Version d'API envoyée dans l'en-tête `anthropic-version`. */
export const VERSION_ANTHROPIC = "2023-06-01";
/** Modèle par défaut (modifiable avec ANTHROPIC_MODEL). */
export const MODELE_CLAUDE_DEFAUT = "claude-sonnet-5-5";
const FOURNISSEUR = "Anthropic";

const schemaMessage = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  stop_reason: z.string().nullish(),
});

const schemaModeles = z.object({ data: z.array(z.object({ id: z.string(), display_name: z.string().nullish() })) });

/** En-têtes d'authentification Anthropic. */
function entetes(cle: string): Record<string, string> {
  return { "x-api-key": cle, "anthropic-version": VERSION_ANTHROPIC, "Content-Type": "application/json" };
}

/** Extrait l'objet JSON d'une réponse texte (Claude peut l'entourer de ```json … ``` ou d'une phrase). */
export function extraireJson(texte: string): string {
  const bloc = /```(?:json)?\s*([\s\S]*?)```/i.exec(texte);
  const brut = (bloc?.[1] ?? texte).trim();
  const debut = brut.indexOf("{");
  const fin = brut.lastIndexOf("}");
  return debut >= 0 && fin > debut ? brut.slice(debut, fin + 1) : brut;
}

/** Analyse le texte : JSON puis schéma. */
function analyser<T>(texte: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): { ok: true; valeur: T } | { ok: false; erreur: string } {
  let brut: unknown;
  try {
    brut = JSON.parse(extraireJson(texte)) as unknown;
  } catch {
    return { ok: false, erreur: "le texte n'est pas du JSON valide" };
  }
  const r = schema.safeParse(brut);
  if (r.success) return { ok: true, valeur: r.data };
  return { ok: false, erreur: r.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "racine"} : ${i.message}`).join(" ; ") };
}

type MessageClaude = { role: "user" | "assistant"; content: string };

/**
 * Demande une réponse JSON à Claude (POST /v1/messages) et la valide avec Zod.
 * Une seule relance si le JSON est invalide, en montrant l'erreur au modèle.
 */
export async function demanderJsonClaude<T>(
  cle: string,
  modele: string,
  messages: { system: string; user: string },
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  f: Fetch = fetch,
): Promise<T> {
  const conversation: MessageClaude[] = [{ role: "user", content: messages.user }];
  const system = `${messages.system}\nRéponds avec le seul objet JSON, sans texte autour ni bloc de code.`;
  let derniereErreur = "";
  for (let essai = 0; essai < 2; essai++) {
    const rep = await appelJson(
      f,
      FOURNISSEUR,
      `${BASE_ANTHROPIC}/messages`,
      { method: "POST", headers: entetes(cle), body: JSON.stringify({ model: modele, max_tokens: 8000, system, messages: conversation }) },
      schemaMessage,
      [cle],
    );
    const texte = rep.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    if (rep.stop_reason === "refusal") throw erreurReponseInvalide(FOURNISSEUR, "refus du modèle");
    const r = analyser(texte, schema);
    if (r.ok) return r.valeur;
    derniereErreur = rep.stop_reason === "max_tokens" ? "réponse coupée (trop longue)" : r.erreur;
    conversation.push({ role: "assistant", content: texte || "(vide)" });
    conversation.push({ role: "user", content: `Ta réponse est invalide (${derniereErreur}). Renvoie uniquement le JSON corrigé, au format demandé.` });
  }
  throw erreurReponseInvalide(FOURNISSEUR, `JSON non conforme après une relance : ${derniereErreur}`);
}

/** Liste les modèles accessibles avec la clé (sert au test de la clé). */
export async function listerModelesAnthropic(cle: string, f: Fetch = fetch): Promise<string[]> {
  const rep = await appelJson(f, FOURNISSEUR, `${BASE_ANTHROPIC}/models`, { method: "GET", headers: entetes(cle) }, schemaModeles, [cle]);
  return rep.data.map((m) => m.id);
}
