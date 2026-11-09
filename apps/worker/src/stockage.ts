// Fichiers du bucket privé « medias » : envoi, lecture, URL signée d'une heure, suppression.
// Chemins : <espace_id>/<episode_id>/<genre>/<nom> (ou <espace_id>/test/… et <espace_id>/personnages/…).
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { Base } from "./supabase";

/** Nom du bucket privé des médias. */
export const BUCKET = "medias";

/** Durée de validité des URL signées (1 h : assez pour qu'Instagram ou xAI téléchargent le fichier). */
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
  const ext = chemin.split(".").pop()?.toLowerCase() ?? "";
  const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", mp4: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", srt: "text/plain" };
  return types[ext] ?? "application/octet-stream";
}

/** Accès au bucket des médias. */
export class Stockage {
  /** Crée l'accès à partir du client service_role. */
  constructor(private readonly db: Base) {}

  /** Envoie des octets à un chemin (remplace le fichier s'il existe). */
  async envoyer(chemin: string, donnees: Uint8Array, type: string = typeMime(chemin)): Promise<void> {
    const { error } = await this.db.storage.from(BUCKET).upload(chemin, donnees, { contentType: type, upsert: true });
    if (error) throw new Error(`Envoi vers le stockage impossible (${chemin}) : ${error.message}`);
  }

  /** Envoie un fichier local. */
  async envoyerFichier(chemin: string, cheminLocal: string, type: string = typeMime(chemin)): Promise<void> {
    await this.envoyer(chemin, await readFile(cheminLocal), type);
  }

  /** Lit un fichier en mémoire. */
  async lire(chemin: string): Promise<Buffer> {
    const { data, error } = await this.db.storage.from(BUCKET).download(chemin);
    if (error || !data) throw new Error(`Lecture du stockage impossible (${chemin}) : ${error?.message ?? "fichier absent"}`);
    return Buffer.from(await data.arrayBuffer());
  }

  /** Télécharge un fichier vers un chemin local. */
  async telechargerVers(chemin: string, cheminLocal: string): Promise<string> {
    await writeFile(cheminLocal, await this.lire(chemin));
    return cheminLocal;
  }

  /** URL signée (1 h par défaut) pour qu'un service externe lise le fichier. Ne jamais la journaliser. */
  async urlSignee(chemin: string, secondes = VALIDITE_URL_SIGNEE_S): Promise<string> {
    const { data, error } = await this.db.storage.from(BUCKET).createSignedUrl(chemin, secondes);
    if (error || !data?.signedUrl) throw new Error(`URL signée impossible (${chemin}) : ${error?.message ?? "réponse vide"}`);
    return data.signedUrl;
  }

  /** Supprime des fichiers (sans erreur si la liste est vide). */
  async supprimer(chemins: readonly string[]): Promise<void> {
    const liste = chemins.filter(Boolean);
    if (liste.length === 0) return;
    const { error } = await this.db.storage.from(BUCKET).remove([...liste]);
    if (error) throw new Error(`Suppression dans le stockage impossible : ${error.message}`);
  }
}
