// Moteurs de base de données : SQLite (fichier local, node:sqlite) ou PostgreSQL (pg).
// Le reste de l'application ne voit qu'une interface commune : lire, exécuter, transaction.
// Les requêtes sont écrites avec des « ? » ; le moteur PostgreSQL les numérote ($1, $2…).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";

/** Une ligne lue dans la base. */
export type LigneBrute = Record<string, unknown>;

/** Erreur SQL ramenée aux codes PostgreSQL (23505 doublon, 23514 contrainte, 23503 lien, P0001 déclencheur…). */
export class ErreurSql extends Error {
  /** Crée l'erreur avec son code. */
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ErreurSql";
  }
}

/** Interface commune aux deux moteurs. */
export interface Moteur {
  readonly dialecte: "sqlite" | "postgres";
  /** Exécute une requête et renvoie ses lignes (SELECT, ou écriture avec RETURNING). */
  lire(sql: string, valeurs?: readonly unknown[]): Promise<LigneBrute[]>;
  /** Exécute une écriture et renvoie le nombre de lignes touchées. */
  executer(sql: string, valeurs?: readonly unknown[]): Promise<number>;
  /** Exécute un script SQL de plusieurs instructions (migrations), sans valeurs. */
  script(sql: string): Promise<void>;
  /** Exécute `fn` dans une transaction : tout ou rien. Les transactions imbriquées réutilisent la transaction en cours. */
  transaction<T>(fn: (m: Moteur) => Promise<T>): Promise<T>;
  /** Ferme les connexions. */
  fermer(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------------------------

/** Codes étendus SQLite → codes PostgreSQL utilisés par l'application. */
const CODES_SQLITE: Record<number, string> = {
  2067: "23505", // UNIQUE
  1555: "23505", // PRIMARY KEY
  275: "23514", // CHECK
  787: "23503", // FOREIGN KEY
  1811: "P0001", // RAISE dans un déclencheur
  1299: "23502", // NOT NULL
};

/** Traduit une erreur de node:sqlite. */
function erreurSqlite(e: unknown): ErreurSql {
  const err = e as { message?: string; errcode?: number; errstr?: string };
  const code = (err.errcode !== undefined ? CODES_SQLITE[err.errcode] : undefined) ?? "XX000";
  return new ErreurSql(err.message ?? String(e), code);
}

/** Type minimal de node:sqlite utilisé ici (le module est chargé à la demande). */
type SqliteSync = {
  exec(sql: string): void;
  prepare(sql: string): { all(...v: unknown[]): LigneBrute[]; run(...v: unknown[]): { changes: number | bigint } };
  close(): void;
};

/** Valeur acceptée par node:sqlite (pas de booléen ni d'objet). */
function valeurSqlite(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === "object" && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

/**
 * Moteur SQLite : un seul fichier, mode WAL (le site et le worker lisent et écrivent en même temps),
 * clés étrangères actives. Les transactions prennent le verrou d'écriture dès le début (BEGIN IMMEDIATE)
 * et sont exécutées une par une dans ce processus.
 */
class MoteurSqlite implements Moteur {
  readonly dialecte = "sqlite" as const;
  private db: SqliteSync;
  /** File d'attente : une transaction à la fois (node:sqlite partage une seule connexion). */
  private file: Promise<unknown> = Promise.resolve();
  private enTransaction = false;

  /** Ouvre (ou crée) le fichier. */
  constructor(chemin: string, Sqlite: new (chemin: string) => SqliteSync) {
    if (chemin !== ":memory:") mkdirSync(dirname(chemin), { recursive: true });
    this.db = new Sqlite(chemin);
    this.db.exec("pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 15000; pragma synchronous = normal;");
  }

  /** Attend la fin de la transaction en cours (hors transaction). */
  private async attendre(): Promise<void> {
    if (!this.enTransaction) return;
    await this.file.catch(() => undefined);
    if (this.enTransaction) await this.attendre();
  }

  /** Exécution directe (la connexion est synchrone). */
  private lireDirect(sql: string, valeurs: readonly unknown[]): LigneBrute[] {
    try {
      return this.db.prepare(sql).all(...valeurs.map(valeurSqlite));
    } catch (e) {
      throw erreurSqlite(e);
    }
  }

  private executerDirect(sql: string, valeurs: readonly unknown[]): number {
    try {
      return Number(this.db.prepare(sql).run(...valeurs.map(valeurSqlite)).changes);
    } catch (e) {
      throw erreurSqlite(e);
    }
  }

  async lire(sql: string, valeurs: readonly unknown[] = []): Promise<LigneBrute[]> {
    await this.attendre();
    return this.lireDirect(sql, valeurs);
  }

  async executer(sql: string, valeurs: readonly unknown[] = []): Promise<number> {
    await this.attendre();
    return this.executerDirect(sql, valeurs);
  }

  async script(sql: string): Promise<void> {
    await this.attendre();
    try {
      this.db.exec(sql);
    } catch (e) {
      throw erreurSqlite(e);
    }
  }

  async transaction<T>(fn: (m: Moteur) => Promise<T>): Promise<T> {
    const suite = this.file.catch(() => undefined).then(async () => {
      this.enTransaction = true;
      // Moteur lié à la transaction : il passe outre la file d'attente.
      const lie: Moteur = {
        dialecte: "sqlite",
        lire: async (s, v = []) => this.lireDirect(s, v),
        executer: async (s, v = []) => this.executerDirect(s, v),
        script: async (s) => {
          try {
            this.db.exec(s);
          } catch (e) {
            throw erreurSqlite(e);
          }
        },
        transaction: (f) => f(lie),
        fermer: async () => undefined,
      };
      try {
        this.db.exec("begin immediate");
      } catch (e) {
        this.enTransaction = false;
        throw erreurSqlite(e);
      }
      try {
        const r = await fn(lie);
        this.db.exec("commit");
        return r;
      } catch (e) {
        try {
          this.db.exec("rollback");
        } catch {
          // Transaction déjà annulée par SQLite.
        }
        throw e;
      } finally {
        this.enTransaction = false;
      }
    });
    this.file = suite;
    return suite;
  }

  async fermer(): Promise<void> {
    await this.attendre();
    this.db.close();
  }
}

/** Charge node:sqlite sans afficher l'avertissement « expérimental » de Node 22. */
async function chargerSqlite(): Promise<new (chemin: string) => SqliteSync> {
  const emettre = process.emitWarning.bind(process);
  process.emitWarning = ((avertissement: string | Error, ...reste: unknown[]) => {
    const texte = typeof avertissement === "string" ? avertissement : avertissement.message;
    if (/SQLite is an experimental feature/i.test(texte)) return;
    (emettre as (...a: unknown[]) => void)(avertissement, ...reste);
  }) as typeof process.emitWarning;
  try {
    // process.getBuiltinModule (Node 22.3+) : les outils de construction (Next, Vite) ne touchent pas à ce chargement.
    const charger = (process as unknown as { getBuiltinModule?: (nom: string) => unknown }).getBuiltinModule;
    if (!charger) throw new Error("Node.js 22.13 ou plus récent est nécessaire pour la base SQLite locale.");
    const mod = charger("node:sqlite") as { DatabaseSync?: new (chemin: string) => SqliteSync } | undefined;
    if (!mod?.DatabaseSync) throw new Error("Module node:sqlite indisponible : utilise Node.js 22.13 ou plus récent.");
    return mod.DatabaseSync;
  } finally {
    process.emitWarning = emettre;
  }
}

/** Ouvre une base SQLite (fichier ou « :memory: »). */
export async function moteurSqlite(chemin: string): Promise<Moteur> {
  return new MoteurSqlite(chemin, await chargerSqlite());
}

// ---------------------------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------------------------

/** Remplace les « ? » par $1, $2… (le SQL généré par l'application ne contient pas de « ? » littéral). */
export function numeroter(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

/** Horodatage PostgreSQL (« 2026-01-01 10:00:00.123456+00 ») → ISO 8601 (« 2026-01-01T10:00:00.123Z »). */
export function isoDepuisPostgres(v: string): string {
  const d = new Date(v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00").replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

/** Lecture des types : nombres en nombres, horodatages en ISO, dates en « AAAA-MM-JJ ». */
const TYPES_PG = {
  getTypeParser(oid: number, format?: string) {
    if (oid === 1700 || oid === 701 || oid === 700) return (v: string) => Number.parseFloat(v); // numeric, float
    if (oid === 20) return (v: string) => Number(v); // bigint
    if (oid === 1184 || oid === 1114) return (v: string) => isoDepuisPostgres(oid === 1114 ? `${v}+00` : v);
    if (oid === 1082) return (v: string) => v; // date
    return pg.types.getTypeParser(oid, format as "text");
  },
};

/** Traduit une erreur de pg (garde le code PostgreSQL). */
function erreurPg(e: unknown): ErreurSql {
  const err = e as { message?: string; code?: string };
  return new ErreurSql(err.message ?? String(e), err.code ?? "XX000");
}

/** Valeur envoyée à pg : les objets JSON en texte (les tableaux de texte restent des tableaux). */
function valeurPg(v: unknown): unknown {
  if (v === undefined) return null;
  return v;
}

/** Moteur PostgreSQL : un pool de connexions ; les transactions prennent une connexion dédiée. */
class MoteurPostgres implements Moteur {
  readonly dialecte = "postgres" as const;
  /** Crée le moteur sur un pool ou une connexion de transaction. */
  constructor(
    private readonly pool: pg.Pool,
    private readonly client: pg.PoolClient | null = null,
  ) {}

  private cible(): pg.Pool | pg.PoolClient {
    return this.client ?? this.pool;
  }

  async lire(sql: string, valeurs: readonly unknown[] = []): Promise<LigneBrute[]> {
    try {
      const r = await this.cible().query(numeroter(sql), valeurs.map(valeurPg));
      return r.rows as LigneBrute[];
    } catch (e) {
      throw erreurPg(e);
    }
  }

  async executer(sql: string, valeurs: readonly unknown[] = []): Promise<number> {
    try {
      const r = await this.cible().query(numeroter(sql), valeurs.map(valeurPg));
      return r.rowCount ?? 0;
    } catch (e) {
      throw erreurPg(e);
    }
  }

  async script(sql: string): Promise<void> {
    try {
      await this.cible().query(sql);
    } catch (e) {
      throw erreurPg(e);
    }
  }

  async transaction<T>(fn: (m: Moteur) => Promise<T>): Promise<T> {
    if (this.client) return fn(this);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const r = await fn(new MoteurPostgres(this.pool, client));
      await client.query("commit");
      return r;
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      throw e instanceof ErreurSql ? e : erreurPg(e);
    } finally {
      client.release();
    }
  }

  async fermer(): Promise<void> {
    if (!this.client) await this.pool.end();
  }
}

/** Ouvre une base PostgreSQL (adresse postgres://…). */
export async function moteurPostgres(url: string): Promise<Moteur> {
  const pool = new pg.Pool({ connectionString: url, max: 10, types: TYPES_PG });
  // Une connexion qui tombe ne doit pas arrêter le processus : le pool en rouvre une.
  pool.on("error", () => undefined);
  return new MoteurPostgres(pool);
}
