// Clés API d'un propriétaire, lues dans `cles_api` et déchiffrées (AES-GCM) avec ENCRYPTION_KEY.
// Pour google, meta et tiktok, la valeur déchiffrée est un JSON {client_id, client_secret}.
import { schemaAppOAuth, type AppOAuth, type Fournisseur, type Reseau } from "@studio-video-ia/core";
import { dechiffrer } from "@studio-video-ia/core/chiffrement";
import { fournisseurApp } from "@studio-video-ia/integrations";
import { ligne, lignes, type Base } from "./bdd";

/** Clés disponibles pour un propriétaire (absentes si non saisies). */
export type ClesProprietaire = {
  openai?: string;
  xai?: string;
  elevenlabs?: string;
  anthropic?: string;
  google?: AppOAuth;
  meta?: AppOAuth;
  tiktok?: AppOAuth;
};

/** Nom affiché de chaque fournisseur, pour les messages. */
export const NOMS_FOURNISSEURS_CLES: Record<Fournisseur, string> = {
  openai: "OpenAI",
  xai: "xAI (Grok)",
  elevenlabs: "ElevenLabs",
  anthropic: "Anthropic (Claude)",
  google: "Google (YouTube)",
  meta: "Meta (Instagram)",
  tiktok: "TikTok",
};

/** Propriétaire (utilisateur) d'un espace. */
export async function proprietaireEspace(db: Base, espaceId: string): Promise<string> {
  const e = await ligne<{ proprietaire: string }>(db.from("espaces").select("proprietaire").eq("id", espaceId).limit(1), "espace");
  return e.proprietaire;
}

/** Déchiffre une valeur, avec un message clair si ENCRYPTION_KEY ne correspond pas à celle du web. */
export function dechiffrerValeur(chiffre: string, cleMaitre: Buffer, quoi: string): string {
  try {
    return dechiffrer(chiffre, cleMaitre);
  } catch {
    throw new Error(`Impossible de déchiffrer ${quoi} : ENCRYPTION_KEY du worker différente de celle du site ? Enregistre à nouveau la valeur ou corrige la variable.`);
  }
}

/** Lit et déchiffre toutes les clés d'un propriétaire. Une clé d'application OAuth mal formée est ignorée. */
export async function chargerCles(db: Base, cleMaitre: Buffer, proprietaire: string): Promise<ClesProprietaire> {
  const rangs = await lignes<{ fournisseur: Fournisseur; valeur_chiffree: string }>(
    db.from("cles_api").select("fournisseur, valeur_chiffree").eq("proprietaire", proprietaire),
    "clés API",
  );
  const cles: ClesProprietaire = {};
  for (const r of rangs) {
    const valeur = dechiffrerValeur(r.valeur_chiffree, cleMaitre, `la clé ${NOMS_FOURNISSEURS_CLES[r.fournisseur]}`);
    if (r.fournisseur === "openai" || r.fournisseur === "xai" || r.fournisseur === "elevenlabs" || r.fournisseur === "anthropic") {
      cles[r.fournisseur] = valeur.trim();
    } else {
      let brut: unknown;
      try {
        brut = JSON.parse(valeur) as unknown;
      } catch {
        brut = null;
      }
      const app = schemaAppOAuth.safeParse(brut);
      if (app.success) cles[r.fournisseur] = app.data;
    }
  }
  return cles;
}

/** Clé obligatoire d'un fournisseur d'IA ; message clair si elle manque. */
export function exigerCle(cles: ClesProprietaire, fournisseur: "openai" | "xai" | "elevenlabs" | "anthropic"): string {
  const c = cles[fournisseur];
  if (!c) throw new Error(`Clé ${NOMS_FOURNISSEURS_CLES[fournisseur]} manquante : ajoute-la dans Réglages → Clés API.`);
  return c;
}

/** Application OAuth nécessaire pour un réseau (renouvellement des jetons). */
export function exigerApp(cles: ClesProprietaire, reseau: Reseau): AppOAuth {
  const f = fournisseurApp(reseau);
  const app = cles[f];
  if (!app) throw new Error(`Identifiants d'application ${NOMS_FOURNISSEURS_CLES[f]} manquants : ajoute-les dans Réglages → Clés API.`);
  return app;
}
