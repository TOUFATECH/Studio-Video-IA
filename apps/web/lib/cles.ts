// Lecture des clés API et des applications OAuth, déchiffrées côté serveur uniquement.
import "server-only";
import { schemaAppOAuth, type AppOAuth, type Fournisseur, type Reseau } from "@studio-video-ia/core";
import { assurerCleChiffrement, configBase } from "@studio-video-ia/base";
import { dechiffrer, lireCleMaitre } from "@studio-video-ia/core/chiffrement";
import { lireEnv } from "./env";
import { clientAdmin } from "./bdd";

/** Application OAuth à utiliser pour chaque réseau. */
export const FOURNISSEUR_DU_RESEAU: Record<Reseau, Fournisseur> = { youtube: "google", instagram: "meta", tiktok: "tiktok" };

/** Clé maître de chiffrement : ENCRYPTION_KEY, ou celle générée au premier lancement dans le dossier des données. */
export function cleMaitre(): Buffer {
  return lireCleMaitre(lireEnv("ENCRYPTION_KEY") ?? assurerCleChiffrement(configBase().dossierDonnees));
}

/** Valeur déchiffrée d'une clé de l'utilisateur, ou null si elle n'est pas enregistrée. */
export async function lireCle(proprietaire: string, fournisseur: Fournisseur): Promise<string | null> {
  const { data } = await (await clientAdmin()).from("cles_api").select("valeur_chiffree").eq("proprietaire", proprietaire).eq("fournisseur", fournisseur).maybeSingle();
  const chiffre: unknown = data?.valeur_chiffree;
  if (typeof chiffre !== "string") return null;
  return dechiffrer(chiffre, cleMaitre());
}

/** Application OAuth (identifiant et secret) du réseau, ou null si absente ou mal formée. */
export async function lireAppOAuth(proprietaire: string, reseau: Reseau): Promise<AppOAuth | null> {
  const brut = await lireCle(proprietaire, FOURNISSEUR_DU_RESEAU[reseau]);
  if (!brut) return null;
  try {
    const r = schemaAppOAuth.safeParse(JSON.parse(brut));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
