// Client ElevenLabs : voix des personnages, bruitages d'ambiance, liste des voix et clonage instantané.
import { z } from "zod";
import type { Fetch, VoixElevenLabs } from "./contrat";
import { appelJson, lireOctets, requete, versOctets } from "./http";

/** Adresse de base de l'API ElevenLabs. */
export const BASE_ELEVENLABS = "https://api.elevenlabs.io/v1";
const FOURNISSEUR = "ElevenLabs";

/** Modèle de voix par défaut : parle français, anglais, japonais, coréen et portugais. */
export const MODELE_VOIX_DEFAUT = "eleven_multilingual_v2";

/** Format de sortie audio demandé (MP3 44,1 kHz, 128 kb/s). */
export const FORMAT_AUDIO = "mp3_44100_128";

/** Échantillon de voix envoyé au clonage. */
export type EchantillonVoix = { nom: string; donnees: Uint8Array; type?: string };

const schemaVoix = z.object({
  voices: z.array(z.object({ voice_id: z.string(), name: z.string(), category: z.string().nullish() })),
});

const schemaAjoutVoix = z.object({ voice_id: z.string().min(1) });

/** Informations utiles du compte (abonnement et caractères restants). */
export const schemaUtilisateur = z.object({
  subscription: z
    .object({
      tier: z.string().nullish(),
      character_count: z.number().nullish(),
      character_limit: z.number().nullish(),
    })
    .nullish(),
});
/** Compte ElevenLabs tel que lu par le diagnostic. */
export type UtilisateurElevenLabs = z.infer<typeof schemaUtilisateur>;

/** En-têtes d'authentification ElevenLabs. */
function entetes(cle: string, json = true): Record<string, string> {
  return json ? { "xi-api-key": cle, "Content-Type": "application/json" } : { "xi-api-key": cle };
}

/**
 * Lit un texte avec une voix. Renvoie les octets MP3.
 * Avec eleven_multilingual_v2, la langue est détectée dans le texte : on n'envoie pas `language_code`.
 */
export async function synthetiserVoix(cle: string, params: { voixId: string; texte: string; modele?: string }, f: Fetch = fetch): Promise<Buffer> {
  if (!params.voixId) throw new Error("Aucune voix choisie pour ce personnage.");
  if (!params.texte.trim()) throw new Error("Texte vide : rien à faire dire à la voix.");
  const url = `${BASE_ELEVENLABS}/text-to-speech/${encodeURIComponent(params.voixId)}?output_format=${FORMAT_AUDIO}`;
  const rep = await requete(f, FOURNISSEUR, url, {
    method: "POST",
    headers: { ...entetes(cle), Accept: "audio/mpeg" },
    body: JSON.stringify({ text: params.texte, model_id: params.modele ?? MODELE_VOIX_DEFAUT }),
  });
  return lireOctets(FOURNISSEUR, rep, [cle]);
}

/** Génère un bruitage ou une ambiance sonore (0,5 à 30 s). Renvoie les octets MP3. */
export async function genererBruitage(cle: string, params: { texte: string; duree: number }, f: Fetch = fetch): Promise<Buffer> {
  // L'API refuse une durée hors de [0,5 ; 30] : on borne plutôt que d'échouer.
  const duree = Math.min(30, Math.max(0.5, params.duree));
  const rep = await requete(f, FOURNISSEUR, `${BASE_ELEVENLABS}/sound-generation`, {
    method: "POST",
    headers: { ...entetes(cle), Accept: "audio/mpeg" },
    body: JSON.stringify({ text: params.texte, duration_seconds: duree }),
  });
  return lireOctets(FOURNISSEUR, rep, [cle]);
}

/** Liste les voix disponibles sur le compte (voix prédéfinies, clonées, générées). */
export async function listerVoix(cle: string, f: Fetch = fetch): Promise<VoixElevenLabs[]> {
  const rep = await appelJson(f, FOURNISSEUR, `${BASE_ELEVENLABS}/voices`, { method: "GET", headers: entetes(cle, false) }, schemaVoix, [cle]);
  return rep.voices.map((v) => ({ id: v.voice_id, nom: v.name, categorie: v.category ?? "inconnue" }));
}

/** Clone une voix à partir d'un ou plusieurs échantillons (clonage instantané). Renvoie l'identifiant de la voix. */
export async function clonerVoix(
  cle: string,
  params: { nom: string; description: string; echantillons: readonly EchantillonVoix[] },
  f: Fetch = fetch,
): Promise<string> {
  if (params.echantillons.length === 0) throw new Error("Aucun échantillon de voix : ajoute au moins un enregistrement.");
  const form = new FormData();
  form.append("name", params.nom);
  form.append("description", params.description);
  for (const e of params.echantillons) form.append("files", new Blob([versOctets(e.donnees)], { type: e.type ?? "audio/mpeg" }), e.nom);
  const rep = await appelJson(f, FOURNISSEUR, `${BASE_ELEVENLABS}/voices/add`, { method: "POST", headers: entetes(cle, false), body: form }, schemaAjoutVoix, [cle]);
  return rep.voice_id;
}

/** Lit les informations du compte (sert au diagnostic). */
export async function lireUtilisateurElevenLabs(cle: string, f: Fetch = fetch): Promise<UtilisateurElevenLabs> {
  return appelJson(f, FOURNISSEUR, `${BASE_ELEVENLABS}/user`, { method: "GET", headers: entetes(cle, false) }, schemaUtilisateur, [cle]);
}
