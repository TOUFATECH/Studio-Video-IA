// Client OpenAI : réponses JSON validées (scénario, mémoire, traductions) et images (génération, édition avec références).
import { z } from "zod";
import type { Fetch } from "./contrat";
import { appelJson, erreurReponseInvalide, versOctets } from "./http";

/** Adresse de base de l'API OpenAI. */
export const BASE_OPENAI = "https://api.openai.com/v1";
const FOURNISSEUR = "OpenAI";

/** Un message de conversation au format OpenAI. */
export type MessageChat = { role: "system" | "user" | "assistant"; content: string };

/** Messages acceptés : la paire {system, user} produite par les prompts de core, ou une liste complète. */
export type MessagesEntree = { system: string; user: string } | readonly MessageChat[];

/** Taille d'image : verticale (9:16 approché), horizontale (16:9 approché) ou carrée. */
export type TailleImage = "1024x1536" | "1536x1024" | "1024x1024";

/** Qualité d'image optionnelle (moins chère en « low »). */
export type QualiteImage = "low" | "medium" | "high" | "auto";

/** Image de référence envoyée à l'édition (fiche personnage, image du plan précédent). */
export type ImageReference = { nom: string; donnees: Uint8Array; type?: string };

const schemaChat = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

const schemaImages = z.object({ data: z.array(z.object({ b64_json: z.string().min(1) })).min(1) });

const schemaModeles = z.object({ data: z.array(z.object({ id: z.string() })) });

/** En-têtes d'authentification. */
function entetes(cle: string, json = true): Record<string, string> {
  return json ? { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" } : { Authorization: `Bearer ${cle}` };
}

/** Convertit l'entrée en liste de messages OpenAI. */
function versMessages(m: MessagesEntree): MessageChat[] {
  if (Array.isArray(m)) return [...(m as readonly MessageChat[])];
  const paire = m as { system: string; user: string };
  return [
    { role: "system", content: paire.system },
    { role: "user", content: paire.user },
  ];
}

/** Analyse le texte renvoyé : JSON puis schéma. Renvoie l'erreur lisible en cas d'échec. */
function analyser<T>(texte: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): { ok: true; valeur: T } | { ok: false; erreur: string } {
  let brut: unknown;
  try {
    brut = JSON.parse(texte) as unknown;
  } catch {
    return { ok: false, erreur: "le texte n'est pas du JSON valide" };
  }
  const r = schema.safeParse(brut);
  if (r.success) return { ok: true, valeur: r.data };
  return { ok: false, erreur: r.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "racine"} : ${i.message}`).join(" ; ") };
}

/**
 * Demande une réponse JSON au modèle de texte et la valide avec Zod.
 * Si le JSON est invalide ou ne respecte pas le schéma, une seule relance est faite en expliquant l'erreur au modèle.
 */
export async function demanderJson<T>(
  cle: string,
  modele: string,
  messages: MessagesEntree,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  f: Fetch = fetch,
): Promise<T> {
  const conversation = versMessages(messages);
  let derniereErreur = "";
  for (let essai = 0; essai < 2; essai++) {
    const rep = await appelJson(
      f,
      FOURNISSEUR,
      `${BASE_OPENAI}/chat/completions`,
      { method: "POST", headers: entetes(cle), body: JSON.stringify({ model: modele, messages: conversation, response_format: { type: "json_object" } }) },
      schemaChat,
      [cle],
    );
    const choix = rep.choices[0];
    if (choix?.message.refusal) throw erreurReponseInvalide(FOURNISSEUR, `refus du modèle : ${choix.message.refusal}`);
    const texte = choix?.message.content ?? "";
    const r = analyser(texte, schema);
    if (r.ok) return r.valeur;
    derniereErreur = r.erreur;
    // Relance : on montre au modèle sa réponse et ce qui ne va pas, pour qu'il corrige seulement le format.
    conversation.push({ role: "assistant", content: texte });
    conversation.push({ role: "user", content: `Ta réponse est invalide (${r.erreur}). Renvoie uniquement le JSON corrigé, au format demandé.` });
  }
  throw erreurReponseInvalide(FOURNISSEUR, `JSON non conforme après une relance : ${derniereErreur}`);
}

/** Génère une image à partir d'un texte. Renvoie les octets PNG. */
export async function genererImage(
  cle: string,
  params: { modele: string; prompt: string; taille: TailleImage; qualite?: QualiteImage },
  f: Fetch = fetch,
): Promise<Buffer> {
  const corps: Record<string, unknown> = { model: params.modele, prompt: params.prompt, size: params.taille, n: 1 };
  if (params.qualite) corps.quality = params.qualite;
  const rep = await appelJson(f, FOURNISSEUR, `${BASE_OPENAI}/images/generations`, { method: "POST", headers: entetes(cle), body: JSON.stringify(corps) }, schemaImages, [cle]);
  return Buffer.from(rep.data[0]?.b64_json ?? "", "base64");
}

/**
 * Génère une image en s'appuyant sur des images de référence (fiches personnages, plan précédent).
 * Envoi multipart vers /images/edits avec un champ `image[]` par référence.
 */
export async function modifierImage(
  cle: string,
  params: { modele: string; prompt: string; taille: TailleImage; references: readonly ImageReference[]; qualite?: QualiteImage },
  f: Fetch = fetch,
): Promise<Buffer> {
  if (params.references.length === 0) throw new Error("modifierImage : au moins une image de référence est nécessaire.");
  const form = new FormData();
  form.append("model", params.modele);
  form.append("prompt", params.prompt);
  form.append("size", params.taille);
  form.append("n", "1");
  if (params.qualite) form.append("quality", params.qualite);
  for (const ref of params.references) {
    form.append("image[]", new Blob([versOctets(ref.donnees)], { type: ref.type ?? "image/png" }), ref.nom);
  }
  // Pas de Content-Type manuel : fetch ajoute lui-même la frontière multipart.
  const rep = await appelJson(f, FOURNISSEUR, `${BASE_OPENAI}/images/edits`, { method: "POST", headers: entetes(cle, false), body: form }, schemaImages, [cle]);
  return Buffer.from(rep.data[0]?.b64_json ?? "", "base64");
}

/** Liste les identifiants des modèles accessibles avec la clé (sert au diagnostic). */
export async function listerModelesOpenAI(cle: string, f: Fetch = fetch): Promise<string[]> {
  const rep = await appelJson(f, FOURNISSEUR, `${BASE_OPENAI}/models`, { method: "GET", headers: entetes(cle, false) }, schemaModeles, [cle]);
  return rep.data.map((m) => m.id);
}
