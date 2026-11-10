// Dépôt des médias sur le disque (images, clips, voix, rendus, chansons), dans le dossier des données.
// Les chemins sont relatifs (« <espace>/<episode>/… ») et ne peuvent jamais sortir du dossier.
// L'accès depuis le navigateur passe par des adresses signées (HMAC) à durée limitée.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** Type MIME d'après l'extension. */
export function typeDepuisChemin(chemin: string): string {
  const ext = chemin.split(".").pop()?.toLowerCase() ?? "";
  const types: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", mp3: "audio/mpeg",
    wav: "audio/wav", m4a: "audio/mp4", srt: "application/x-subrip", json: "application/json",
  };
  return types[ext] ?? "application/octet-stream";
}

/** Vérifie et normalise un chemin relatif (pas de « .. », pas de chemin absolu, caractères sûrs). */
export function cheminSur(chemin: string): string {
  const c = chemin.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!c || c.length > 400 || c.split("/").some((p) => p === "" || p === "." || p === "..") || !/^[\w\-./]+$/.test(c)) {
    throw new Error(`Chemin de fichier refusé : ${chemin}`);
  }
  return c;
}

/** Dépôt de fichiers local. */
export class Depot {
  private readonly racine: string;
  private readonly cleSignature: Buffer;

  /** Crée le dépôt dans `dossier` ; `secret` sert à signer les adresses. */
  constructor(dossier: string, secret: string) {
    this.racine = resolve(dossier);
    this.cleSignature = createHmac("sha256", "studio-video-ia:medias").update(secret).digest();
  }

  /** Chemin absolu d'un fichier du dépôt (toujours sous la racine). */
  absolu(chemin: string): string {
    const abs = resolve(this.racine, cheminSur(chemin));
    if (!abs.startsWith(this.racine + sep)) throw new Error(`Chemin de fichier refusé : ${chemin}`);
    return abs;
  }

  /** Écrit un fichier (écriture atomique : fichier temporaire puis renommage). */
  async ecrire(chemin: string, donnees: Uint8Array): Promise<void> {
    const abs = this.absolu(chemin);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, donnees);
    await rename(tmp, abs);
  }

  /** Copie un fichier local dans le dépôt (gros fichiers : pas de passage en mémoire). */
  async importer(chemin: string, source: string): Promise<void> {
    const abs = this.absolu(chemin);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
    await copyFile(source, tmp);
    await rename(tmp, abs);
  }

  /** Lit un fichier entier. */
  async lire(chemin: string): Promise<Buffer> {
    return readFile(this.absolu(chemin));
  }

  /** Taille d'un fichier, ou null s'il n'existe pas. */
  async taille(chemin: string): Promise<number | null> {
    try {
      const s = await stat(this.absolu(chemin));
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  }

  /** Flux de lecture (avec plage d'octets pour la lecture vidéo dans le navigateur). */
  flux(chemin: string, plage?: { debut: number; fin: number }): ReadStream {
    return createReadStream(this.absolu(chemin), plage ? { start: plage.debut, end: plage.fin } : undefined);
  }

  /** Supprime des fichiers (absents : ignorés). */
  async supprimer(chemins: readonly (string | null | undefined)[]): Promise<void> {
    for (const c of chemins) {
      if (!c) continue;
      try {
        await rm(this.absolu(c), { force: true });
      } catch {
        // Chemin invalide ou déjà supprimé : rien à faire.
      }
    }
  }

  /** Signature d'un chemin pour une date d'expiration (secondes Unix). */
  private signer(chemin: string, expire: number): string {
    return createHmac("sha256", this.cleSignature).update(`${chemin}\n${expire}`).digest("base64url");
  }

  /** Adresse signée relative (« /api/medias/… ») valable `secondes`. Préfixer par l'adresse du site si besoin. */
  adresseSignee(chemin: string, secondes: number, maintenant = Date.now()): string {
    const c = cheminSur(chemin);
    const expire = Math.floor(maintenant / 1000) + Math.max(1, Math.floor(secondes));
    return `/api/medias/${c.split("/").map(encodeURIComponent).join("/")}?e=${expire}&s=${this.signer(c, expire)}`;
  }

  /** Vérifie une adresse signée. */
  verifier(chemin: string, expire: string | null, signature: string | null, maintenant = Date.now()): boolean {
    if (!expire || !signature || !/^\d+$/.test(expire)) return false;
    if (Number(expire) * 1000 < maintenant) return false;
    let c: string;
    try {
      c = cheminSur(chemin);
    } catch {
      return false;
    }
    const attendue = Buffer.from(this.signer(c, Number(expire)));
    const recue = Buffer.from(signature);
    return attendue.length === recue.length && timingSafeEqual(attendue, recue);
  }

  /** Dossier racine (pour le diagnostic). */
  get dossier(): string {
    return this.racine;
  }

  /** Vérifie qu'on peut écrire dans le dossier. */
  async testerEcriture(): Promise<void> {
    await mkdir(this.racine, { recursive: true });
    const t = join(this.racine, `.test-${process.pid}`);
    await writeFile(t, "ok");
    await rm(t, { force: true });
  }
}
