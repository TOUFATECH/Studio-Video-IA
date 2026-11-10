// Création et mise à jour du schéma : chaque version s'applique une seule fois, dans une transaction,
// même si le site et le worker démarrent en même temps.
import type { Moteur } from "./moteur";
import { MIGRATIONS_POSTGRES } from "./schema-postgres";
import { MIGRATIONS_SQLITE } from "./schema-sqlite";

/** Bilan d'une migration. */
export type BilanMigration = { appliquees: number[]; version: number };

/** Migrations du moteur. */
export function migrationsDe(m: Pick<Moteur, "dialecte">): readonly { version: number; nom: string; sql: string }[] {
  return m.dialecte === "sqlite" ? MIGRATIONS_SQLITE : MIGRATIONS_POSTGRES;
}

/** Dernière version connue du code. */
export function versionAttendue(m: Pick<Moteur, "dialecte">): number {
  return Math.max(...migrationsDe(m).map((x) => x.version));
}

/** Version actuelle de la base (0 si vide). */
export async function versionActuelle(m: Moteur): Promise<number> {
  await m.script(`create table if not exists schema_version (version integer primary key, nom text not null, applique_le text not null)`);
  const [l] = await m.lire(`select coalesce(max(version), 0) as v from schema_version`);
  return Number(l?.v ?? 0);
}

/** Applique les migrations manquantes. */
export async function migrer(moteur: Moteur): Promise<BilanMigration> {
  await versionActuelle(moteur);
  const appliquees: number[] = [];
  for (const mig of migrationsDe(moteur)) {
    await moteur.transaction(async (m) => {
      // Verrou propre à PostgreSQL : deux processus ne migrent jamais en même temps (SQLite : BEGIN IMMEDIATE).
      if (m.dialecte === "postgres") await m.lire(`select pg_advisory_xact_lock(424242)`);
      const [deja] = await m.lire(`select 1 as ok from schema_version where version = ?`, [mig.version]);
      if (deja) return;
      await m.script(mig.sql);
      await m.executer(`insert into schema_version (version, nom, applique_le) values (?, ?, ?)`, [mig.version, mig.nom, new Date().toISOString()]);
      appliquees.push(mig.version);
    });
  }
  return { appliquees, version: await versionActuelle(moteur) };
}
