// Fichiers des médias, sur le disque partagé avec le site (dossier des données) : écriture, lecture,
// adresse publique signée (Instagram télécharge la vidéo), image en data URI (xAI), suppression.
// Chemins : <espace_id>/<episode_id>/<genre>/<nom> (ou <espace_id>/test/… et <espace_id>/personnages/…).
import { randomBytes } from "node:crypto";
import { copyFile } from "node:fs/promises";
import { typeDepuisChemin, type Depot } from "@studio-video-ia/base";

/** Durée de validité des adresses signées (1 h : assez pour qu'Instagram télécharge le fichier). */
export const VALIDITE_URL_SIGNEE_S = 3600;

/** Chemin d'un média d'épisode : <espace>/<episode>/<genre>/<nom>. */
export function cheminMedia(espaceId: string, episodeId: string, genre: string, nom: string): string {
  return `${espaceId}/${episodeId}/${genre}/${nom}`;
}

/** Chemin d'un média hors épisode (fiches, échantillons, tests) : <espace>/<dossier>/<nom>. */
export function cheminEspace(espaceId: string, dossier: string, nom: string): string {
  return `${espaceId}/${dossier}/${nom}`;
}

/** Nom de fichier unique (horodatage + aléa), pour ne jamais écraser une version précédente. */
export function nomUnique(base: string, extension: string): string {
  return `${base}-${Date.now().toString(36)}${randomBytes(3).toString("hex")}.${extension}`;
}

/** Type MIME d'une extension courante. */
export function typeMime(chemin: string): string {
  return typeDepuisChemin(chemin);
}

/** Vrai si l'adresse du site est joignable depuis Internet (pas localhost, pas un réseau privé). */
export function adressePublique(adresse: string): boolean {
  try {
    const u = new URL(adresse);
    return u.protocol === "https:" && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(u.hostname);
  } catch {
    return false;
  }
}

/** Accès aux médias. */
export class Stockage {
  /** Crée l'accès sur le dépôt local ; `adresseSite` sert aux adresses publiques (APP_URL). */
  constructor(
    private readonly depot: Depot,
    private readonly adresseSite = "",
  ) {}

  /** Écrit des octets à un chemin (remplace le fichier s'il existe). */
  async envoyer(chemin: string, donnees: Uint8Array, _type?: string): Promise<void> {
    try {
      await this.depot.ecrire(chemin, donnees);
    } catch (e) {
      throw new Error(`Écriture du média impossible (${chemin}) : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Copie un fichier local dans les médias. */
  async envoyerFichier(chemin: string, cheminLocal: string, _type?: string): Promise<void> {
    try {
      await this.depot.importer(chemin, cheminLocal);
    } catch (e) {
      throw new Error(`Écriture du média impossible (${chemin}) : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Lit un fichier en mémoire. */
  async lire(chemin: string): Promise<Buffer> {
    try {
      return await this.depot.lire(chemin);
    } catch {
      throw new Error(`Média introuvable (${chemin}) : il a peut-être été supprimé. Regénère-le.`);
    }
  }

  /** Copie un fichier vers un chemin local (dossier de travail). */
  async telechargerVers(chemin: string, cheminLocal: string): Promise<string> {
    try {
      await copyFile(this.depot.absolu(chemin), cheminLocal);
    } catch {
      throw new Error(`Média introuvable (${chemin}) : il a peut-être été supprimé. Regénère-le.`);
    }
    return cheminLocal;
  }

  /** Image en data URI (base64), pour les API qui acceptent l'image dans la requête (xAI). */
  async dataUri(chemin: string): Promise<string> {
    return `data:${typeMime(chemin)};base64,${(await this.lire(chemin)).toString("base64")}`;
  }

  /**
   * Image à donner à une IA (Grok) : adresse publique signée si le site est joignable depuis Internet
   * (requête légère), sinon l'image elle-même en data URI.
   */
  async urlPourIA(chemin: string): Promise<string> {
    return adressePublique(this.adresseSite) ? this.urlPublique(chemin) : this.dataUri(chemin);
  }

  /**
   * Adresse publique signée (1 h) pour qu'un service externe télécharge le fichier (Instagram).
   * Le site doit être joignable depuis Internet en https (APP_URL). Ne jamais la journaliser.
   */
  async urlPublique(chemin: string, secondes = VALIDITE_URL_SIGNEE_S): Promise<string> {
    if (!adressePublique(this.adresseSite)) {
      throw new Error(
        "Instagram télécharge la vidéo depuis ton site : APP_URL doit être une adresse https joignable depuis Internet (nom de domaine ou tunnel, voir docs/INSTALLER.md).",
      );
    }
    if ((await this.depot.taille(chemin)) === null) throw new Error(`Média introuvable (${chemin}).`);
    return `${this.adresseSite.replace(/\/+$/, "")}${this.depot.adresseSignee(chemin, secondes)}`;
  }

  /** Supprime des fichiers (sans erreur si la liste est vide). */
  async supprimer(chemins: readonly string[]): Promise<void> {
    await this.depot.supprimer(chemins.filter(Boolean));
  }
}
