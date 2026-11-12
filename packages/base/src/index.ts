// Point d'entrée de la base : choix du moteur (SQLite local par défaut, PostgreSQL externe avec DATABASE_URL),
// création du schéma au premier lancement, clients serveur et utilisateur, dépôt des médias, clé de chiffrement.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Depot } from "./depot";
import { FONCTIONS } from "./fonctions";
import { migrer, type BilanMigration } from "./migrations";
import { moteurPostgres, moteurSqlite, type Moteur } from "./moteur";
import { Client } from "./requete";

export * from "./comptes";
export * from "./depot";
export * from "./totp";
export { debutDuMois } from "./fonctions";
export * from "./migrations";
export { ErreurSql, isoDepuisPostgres, moteurPostgres, moteurSqlite, numeroter, type LigneBrute, type Moteur } from "./moteur";
export { Client, Requete, iso, ligneJs, versBase, type ErreurRequete, type Reponse, type Role } from "./requete";
export { REGLES, TABLES, estTable, type NomTable } from "./tables";

/** Réglages de la base. */
export type ConfigBase = {
  /** « sqlite:/chemin/studio.db » ou « postgres://… ». */
  url: string;
  /** Dossier des données (base SQLite, médias, clé de chiffrement générée). */
  dossierDonnees: string;
  /** Dossier des médias. */
  dossierMedias: string;
};

/** Racine du dépôt (dossier dont le package.json déclare les workspaces), pour des chemins identiques au site et au worker. */
export function racineDepot(depart = process.cwd()): string | null {
  let d = resolve(depart);
  for (let i = 0; i < 8; i++) {
    const p = join(d, "package.json");
    if (existsSync(p)) {
      try {
        const json = JSON.parse(readFileSync(p, "utf8")) as { workspaces?: unknown };
        if (json.workspaces) return d;
      } catch {
        // package.json illisible : on continue vers le parent.
      }
    }
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return null;
}

/** Chemin absolu : relatif à la racine du dépôt (ou au dossier courant). */
function absolu(chemin: string): string {
  return isAbsolute(chemin) ? chemin : resolve(racineDepot() ?? process.cwd(), chemin);
}

/** Lit les réglages dans l'environnement : DATABASE_URL, DONNEES_DIR, MEDIAS_DIR. Tout a une valeur par défaut. */
export function configBase(env: Record<string, string | undefined> = process.env): ConfigBase {
  const dossierDonnees = absolu(env.DONNEES_DIR?.trim() || "donnees");
  const brute = env.DATABASE_URL?.trim();
  let url: string;
  if (!brute) url = `sqlite:${join(dossierDonnees, "studio.db")}`;
  else if (/^postgres(ql)?:\/\//i.test(brute)) url = brute;
  else url = `sqlite:${absolu(brute.replace(/^(sqlite|file):(\/\/)?/i, ""))}`;
  return { url, dossierDonnees, dossierMedias: absolu(env.MEDIAS_DIR?.trim() || join(dossierDonnees, "medias")) };
}

/** Vrai si la base est PostgreSQL (externe). */
export function estPostgres(c: Pick<ConfigBase, "url">): boolean {
  return /^postgres(ql)?:\/\//i.test(c.url);
}

/** Adresse lisible de la base, sans mot de passe (pour le diagnostic). */
export function adresseLisible(c: Pick<ConfigBase, "url">): string {
  if (!estPostgres(c)) return c.url.replace(/^sqlite:/, "SQLite · ");
  try {
    const u = new URL(c.url);
    return `PostgreSQL · ${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "PostgreSQL";
  }
}

/**
 * Clé de chiffrement des clés API et des jetons : ENCRYPTION_KEY si fournie, sinon une clé générée au premier lancement
 * dans le dossier des données (fichier lisible par le seul propriétaire), partagée par le site et le worker.
 */
export function assurerCleChiffrement(dossierDonnees: string, env: Record<string, string | undefined> = process.env): string {
  const deja = env.ENCRYPTION_KEY?.trim();
  if (deja) return deja;
  const fichier = join(dossierDonnees, "cle-chiffrement");
  mkdirSync(dossierDonnees, { recursive: true });
  if (!existsSync(fichier)) {
    try {
      writeFileSync(fichier, randomBytes(32).toString("base64"), { flag: "wx", mode: 0o600 });
    } catch (e) {
      // Créée au même instant par l'autre processus : on la relit.
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  const cle = readFileSync(fichier, "utf8").trim();
  env.ENCRYPTION_KEY = cle;
  env.ENCRYPTION_KEY_SOURCE = "fichier";
  return cle;
}

/** Base ouverte : moteur, clients et dépôt de médias. */
export type Base = {
  config: ConfigBase;
  moteur: Moteur;
  /** Client du serveur et du worker : accès complet (à utiliser APRÈS avoir vérifié l'appartenance). */
  admin: Client;
  /** Client d'un utilisateur connecté : chaque requête est limitée à ses données. */
  pour: (utilisateurId: string) => Client;
  depot: Depot;
  migration: BilanMigration;
  fermer: () => Promise<void>;
};

/** Ouvre la base, crée ou met à jour le schéma, prépare le dépôt des médias. */
export async function ouvrirBase(config: ConfigBase = configBase()): Promise<Base> {
  const cle = assurerCleChiffrement(config.dossierDonnees);
  const moteur = estPostgres(config) ? await moteurPostgres(config.url) : await moteurSqlite(config.url.replace(/^sqlite:/, ""));
  const migration = await migrer(moteur);
  mkdirSync(config.dossierMedias, { recursive: true });
  return {
    config,
    moteur,
    admin: new Client(moteur, { genre: "admin" }, FONCTIONS),
    pour: (id) => new Client(moteur, { genre: "utilisateur", id }, FONCTIONS),
    depot: new Depot(config.dossierMedias, cle),
    migration,
    fermer: () => moteur.fermer(),
  };
}

/** Base partagée par tout le processus (une seule ouverture, survit au rechargement à chaud du site). */
export function baseGlobale(): Promise<Base> {
  const g = globalThis as typeof globalThis & { __studioVideoIaBase?: Promise<Base> };
  if (!g.__studioVideoIaBase) {
    g.__studioVideoIaBase = ouvrirBase().catch((e: unknown) => {
      g.__studioVideoIaBase = undefined;
      throw e;
    });
  }
  return g.__studioVideoIaBase;
}
