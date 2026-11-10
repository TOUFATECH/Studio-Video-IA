// Constructeur de requêtes de l'application, compatible avec la forme utilisée jusqu'ici
// (`client.from("episodes").select("*").eq("id", x).maybeSingle()` → `{ data, error, count }`).
// Il produit du SQL paramétré pour SQLite ou PostgreSQL, convertit les valeurs (JSON, booléens, dates),
// et applique les règles d'accès de l'utilisateur connecté (lecture filtrée, écritures vérifiées).
import { ErreurSql, type LigneBrute, type Moteur } from "./moteur";
import { estTable, REGLES, TABLES, type Nature, type NomTable, type Operation, type Regle } from "./tables";

/** Erreur renvoyée dans `{ error }` (même forme qu'avant : message et code PostgreSQL). */
export type ErreurRequete = { message: string; code?: string };

/**
 * Résultat d'une requête. Les lignes ne sont pas typées ici (`any`, comme le client précédent) :
 * chaque appelant les valide avec Zod ou les type. Liste par défaut, une ligne après single() / maybeSingle().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Reponse<R = any[]> = { data: R | null; error: ErreurRequete | null; count: number | null };
/** Résultat interne avant typage (liste ou ligne). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReponseLibre = Reponse<any>;

/** Qui fait la requête : le serveur (accès complet) ou un utilisateur (règles d'accès appliquées). */
export type Role = { genre: "admin" } | { genre: "utilisateur"; id: string };

type Filtre = { sql: string; valeurs: unknown[] };
type Action = "select" | "insert" | "update" | "delete" | "upsert";

/** Message d'erreur des règles d'accès (même texte que PostgreSQL, testé par l'application). */
function refus(table: string): ErreurSql {
  return new ErreurSql(`new row violates row-level security policy for table "${table}"`, "42501");
}

/** Normalise un horodatage en ISO 8601 UTC (les comparaisons de texte restent justes en SQLite). */
export function iso(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

/** Convertit une valeur JavaScript vers la base, selon la nature de la colonne. */
export function versBase(nature: Nature | undefined, v: unknown, dialecte: Moteur["dialecte"]): unknown {
  if (v === undefined || v === null) return null;
  switch (nature) {
    case "json":
      return JSON.stringify(v);
    case "tableau":
      return dialecte === "sqlite" ? JSON.stringify(v) : v;
    case "booleen":
      return dialecte === "sqlite" ? (v ? 1 : 0) : Boolean(v);
    case "horodatage":
      return iso(v);
    case "nombre":
    case "entier":
      return typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v;
    default:
      return v;
  }
}

/** Convertit une valeur lue dans la base vers JavaScript. */
function depuisBase(nature: Nature | undefined, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (nature) {
    case "json":
    case "tableau":
      if (typeof v === "string") {
        try {
          return JSON.parse(v) as unknown;
        } catch {
          return v;
        }
      }
      return v;
    case "booleen":
      return v === true || v === 1 || v === "1" || v === "t";
    case "nombre":
    case "entier":
      return typeof v === "bigint" ? Number(v) : typeof v === "string" ? Number(v) : v;
    case "horodatage":
      return typeof v === "string" ? v : v instanceof Date ? v.toISOString() : v;
    default:
      return v;
  }
}

/** Remet une ligne brute d'une table dans les types JavaScript (JSON, booléens, nombres). */
export function ligneJs(table: NomTable, brute: LigneBrute): Record<string, unknown> {
  const colonnes = TABLES[table].colonnes as Record<string, Nature>;
  const out: Record<string, unknown> = {};
  for (const [c, v] of Object.entries(brute)) out[c] = depuisBase(colonnes[c], v);
  return out;
}

/** Analyse une liste de colonnes « a, b, c » ou « * ». */
function analyserColonnes(table: NomTable, liste: string): string[] | "*" {
  const brut = liste.trim();
  if (brut === "" || brut === "*") return "*";
  const cols = brut.split(",").map((c) => c.trim()).filter(Boolean);
  for (const c of cols) {
    if (!Object.prototype.hasOwnProperty.call(TABLES[table].colonnes, c)) throw new ErreurSql(`colonne inconnue « ${c} » dans ${table}`, "42703");
  }
  return cols;
}

/** Requête en construction ; `await` l'exécute. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Requete<R = any[]> implements PromiseLike<Reponse<R>> {
  private action: Action = "select";
  private colonnes: string[] | "*" = "*";
  private retour: string[] | "*" | null = null;
  private filtres: Filtre[] = [];
  private tri: { colonne: string; croissant: boolean }[] = [];
  private limite: number | null = null;
  private unique: "single" | "maybe" | null = null;
  private compter = false;
  private tete = false;
  private lignes: Record<string, unknown>[] = [];
  private maj: Record<string, unknown> = {};
  private conflit: string[] = [];
  private ignorerDoublons = false;
  private erreurConstruction: ErreurSql | null = null;

  /** Crée une requête sur une table. */
  constructor(
    private readonly moteur: Moteur,
    private readonly role: Role,
    private readonly table: NomTable,
  ) {}

  // ----- Actions -----

  /** Lecture (ou, après une écriture, colonnes à renvoyer). */
  select(colonnes = "*", options?: { count?: "exact"; head?: boolean }): this {
    this.essayer(() => {
      if (this.action === "select") {
        this.colonnes = analyserColonnes(this.table, colonnes);
        this.compter = options?.count === "exact";
        this.tete = options?.head === true;
      } else {
        this.retour = analyserColonnes(this.table, colonnes);
      }
    });
    return this;
  }

  /** Ajout d'une ou plusieurs lignes. */
  insert(valeurs: Record<string, unknown> | readonly Record<string, unknown>[]): this {
    this.action = "insert";
    this.lignes = Array.isArray(valeurs) ? [...valeurs] : [valeurs as Record<string, unknown>];
    return this;
  }

  /** Ajout, ou mise à jour si la clé `onConflict` existe déjà. */
  upsert(valeurs: Record<string, unknown> | readonly Record<string, unknown>[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.action = "upsert";
    this.lignes = Array.isArray(valeurs) ? [...valeurs] : [valeurs as Record<string, unknown>];
    this.essayer(() => {
      const cible = options?.onConflict ? analyserColonnes(this.table, options.onConflict) : [...TABLES[this.table].cle];
      this.conflit = cible === "*" ? [...TABLES[this.table].cle] : cible;
    });
    this.ignorerDoublons = options?.ignoreDuplicates === true;
    return this;
  }

  /** Modification des lignes filtrées. */
  update(valeurs: Record<string, unknown>): this {
    this.action = "update";
    this.maj = { ...valeurs };
    return this;
  }

  /** Suppression des lignes filtrées. */
  delete(): this {
    this.action = "delete";
    return this;
  }

  // ----- Filtres -----

  private nature(colonne: string): Nature | undefined {
    return (TABLES[this.table].colonnes as Record<string, Nature>)[colonne];
  }

  private col(colonne: string): string {
    if (!this.nature(colonne)) throw new ErreurSql(`colonne inconnue « ${colonne} » dans ${this.table}`, "42703");
    return `t.${colonne}`;
  }

  private val(colonne: string, v: unknown): unknown {
    return versBase(this.nature(colonne), v, this.moteur.dialecte);
  }

  private essayer(fn: () => void): void {
    if (this.erreurConstruction) return;
    try {
      fn();
    } catch (e) {
      this.erreurConstruction = e instanceof ErreurSql ? e : new ErreurSql(String(e), "XX000");
    }
  }

  private comparer(colonne: string, op: string, v: unknown): this {
    this.essayer(() => {
      if (v === null && (op === "=" || op === "<>")) this.filtres.push({ sql: `${this.col(colonne)} is ${op === "=" ? "" : "not "}null`, valeurs: [] });
      else this.filtres.push({ sql: `${this.col(colonne)} ${op} ?`, valeurs: [this.val(colonne, v)] });
    });
    return this;
  }

  eq(colonne: string, v: unknown): this {
    return this.comparer(colonne, "=", v);
  }
  neq(colonne: string, v: unknown): this {
    return this.comparer(colonne, "<>", v);
  }
  gt(colonne: string, v: unknown): this {
    return this.comparer(colonne, ">", v);
  }
  gte(colonne: string, v: unknown): this {
    return this.comparer(colonne, ">=", v);
  }
  lt(colonne: string, v: unknown): this {
    return this.comparer(colonne, "<", v);
  }
  lte(colonne: string, v: unknown): this {
    return this.comparer(colonne, "<=", v);
  }

  /** Colonne dans une liste (liste vide : aucune ligne). */
  in(colonne: string, liste: readonly unknown[]): this {
    this.essayer(() => {
      if (liste.length === 0) this.filtres.push({ sql: "1 = 0", valeurs: [] });
      else this.filtres.push({ sql: `${this.col(colonne)} in (${liste.map(() => "?").join(", ")})`, valeurs: liste.map((v) => this.val(colonne, v)) });
    });
    return this;
  }

  /** `is null`, `is true`, `is false`. */
  is(colonne: string, v: null | boolean): this {
    this.essayer(() => {
      if (v === null) this.filtres.push({ sql: `${this.col(colonne)} is null`, valeurs: [] });
      else this.filtres.push({ sql: `${this.col(colonne)} = ?`, valeurs: [this.val(colonne, v)] });
    });
    return this;
  }

  /** Négation : `not(colonne, "is", null)`, `not(colonne, "eq", v)`. */
  not(colonne: string, op: string, v: unknown): this {
    this.essayer(() => {
      if (op === "is" && v === null) this.filtres.push({ sql: `${this.col(colonne)} is not null`, valeurs: [] });
      else if (op === "eq") this.filtres.push({ sql: `${this.col(colonne)} <> ?`, valeurs: [this.val(colonne, v)] });
      else if (op === "in" && Array.isArray(v)) this.filtres.push({ sql: `${this.col(colonne)} not in (${v.map(() => "?").join(", ") || "null"})`, valeurs: v.map((x) => this.val(colonne, x)) });
      else throw new ErreurSql(`filtre « not ${op} » non pris en charge`, "42601");
    });
    return this;
  }

  /**
   * Alternative de filtres, forme « colonne.op.valeur » séparés par des virgules :
   * `cree_le.gte."2026-01-01",statut.in.(en_file,en_cours)`. Opérateurs : eq, neq, gt, gte, lt, lte, is, in.
   */
  or(expression: string): this {
    this.essayer(() => {
      const termes: string[] = [];
      let profondeur = 0;
      let guillemets = false;
      let courant = "";
      for (const c of expression) {
        if (c === '"') guillemets = !guillemets;
        if (!guillemets && c === "(") profondeur++;
        if (!guillemets && c === ")") profondeur--;
        if (c === "," && profondeur === 0 && !guillemets) {
          termes.push(courant);
          courant = "";
        } else courant += c;
      }
      if (courant) termes.push(courant);
      const parties: string[] = [];
      const valeurs: unknown[] = [];
      for (const terme of termes) {
        const m = /^([a-z_]+)\.(eq|neq|gt|gte|lt|lte|is|in)\.(.*)$/s.exec(terme.trim());
        if (!m) throw new ErreurSql(`terme « ${terme} » invalide dans or()`, "42601");
        const [, colonne = "", op = "", brut = ""] = m;
        const sansGuillemets = (s: string): string => s.replace(/^"(.*)"$/s, "$1");
        if (op === "in") {
          const liste = brut.replace(/^\(|\)$/g, "").split(",").map((x) => sansGuillemets(x.trim()));
          parties.push(`${this.col(colonne)} in (${liste.map(() => "?").join(", ")})`);
          valeurs.push(...liste.map((x) => this.val(colonne, x)));
        } else if (op === "is" && brut === "null") {
          parties.push(`${this.col(colonne)} is null`);
        } else if (op === "is") {
          parties.push(`${this.col(colonne)} = ?`);
          valeurs.push(this.val(colonne, brut === "true"));
        } else {
          const ops: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
          parties.push(`${this.col(colonne)} ${ops[op]} ?`);
          valeurs.push(this.val(colonne, sansGuillemets(brut)));
        }
      }
      this.filtres.push({ sql: `(${parties.join(" or ")})`, valeurs });
    });
    return this;
  }

  // ----- Tri, limite, forme du résultat -----

  order(colonne: string, options?: { ascending?: boolean }): this {
    this.essayer(() => {
      this.col(colonne);
      this.tri.push({ colonne, croissant: options?.ascending !== false });
    });
    return this;
  }

  limit(n: number): this {
    this.limite = Math.max(0, Math.floor(n));
    return this;
  }

  /** Exactement une ligne (sinon erreur). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  single(): Requete<any> {
    this.unique = "single";
    return this as Requete<unknown> as Requete<never>;
  }

  /** Zéro ou une ligne (null si aucune). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  maybeSingle(): Requete<any> {
    this.unique = "maybe";
    return this as Requete<unknown> as Requete<never>;
  }

  /** Colonne JSON qui contient ces paires clé → valeur (valeurs simples). */
  contains(colonne: string, valeur: Record<string, string | number | boolean>): this {
    this.essayer(() => {
      const c = this.col(colonne);
      if (this.nature(colonne) !== "json") throw new ErreurSql(`contains() demande une colonne JSON (${colonne})`, "42601");
      for (const [cle, v] of Object.entries(valeur)) {
        if (!/^\w+$/.test(cle)) throw new ErreurSql(`clé JSON invalide « ${cle} »`, "42601");
        if (this.moteur.dialecte === "sqlite") this.filtres.push({ sql: `json_extract(${c}, '$.${cle}') = ?`, valeurs: [typeof v === "boolean" ? (v ? 1 : 0) : v] });
        else this.filtres.push({ sql: `${c} ->> '${cle}' = ?`, valeurs: [String(v)] });
      }
    });
    return this;
  }

  // ----- Exécution -----

  then<A = Reponse<R>, B = never>(ok?: ((r: Reponse<R>) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return (this.executer() as Promise<Reponse<R>>).then(ok, ko);
  }

  /** Règle d'accès de la table pour l'utilisateur, ou null pour le serveur. Refuse les opérations non permises. */
  private regle(op: Operation): Regle | null {
    if (this.role.genre === "admin") return null;
    const r = REGLES[this.table];
    if (!r || !r.operations.includes(op)) throw new ErreurSql(`permission denied for table ${this.table}`, "42501");
    return r;
  }

  /** Condition de la règle, avec l'id de l'utilisateur. */
  private conditionRegle(r: Regle | null, ecriture: boolean): Filtre[] {
    if (!r || this.role.genre !== "utilisateur") return [];
    const id = this.role.id;
    const filtres: Filtre[] = [];
    const ajouter = (sql: string): void => {
      const n = (sql.match(/:u/g) ?? []).length;
      filtres.push({ sql: sql.replace(/:u/g, "?"), valeurs: Array.from({ length: n }, () => id) });
    };
    ajouter(r.condition);
    if (ecriture && r.ecriture) ajouter(r.ecriture);
    return filtres;
  }

  /** Colonnes lisibles : toutes pour le serveur, la liste de la règle pour l'utilisateur. */
  private colonnesLisibles(demande: string[] | "*", r: Regle | null): string[] {
    const toutes = Object.keys(TABLES[this.table].colonnes);
    const permises = r?.lecture ?? toutes;
    if (demande === "*") return [...permises];
    for (const c of demande) if (!permises.includes(c)) throw new ErreurSql(`permission denied for column ${c} of table ${this.table}`, "42501");
    return demande;
  }

  private ou(filtres: readonly Filtre[]): { sql: string; valeurs: unknown[] } {
    if (!filtres.length) return { sql: "", valeurs: [] };
    return { sql: ` where ${filtres.map((f) => f.sql).join(" and ")}`, valeurs: filtres.flatMap((f) => f.valeurs) };
  }

  /** Remet une ligne lue dans les types JavaScript. */
  private convertir(l: LigneBrute, colonnes: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const c of colonnes) out[c] = depuisBase(this.nature(c), l[c]);
    return out;
  }

  /** Forme du résultat selon single / maybeSingle. */
  private forme(lignes: Record<string, unknown>[], count: number | null): ReponseLibre {
    if (this.unique === "single") {
      if (lignes.length !== 1) return { data: null, error: { message: lignes.length ? "Plusieurs lignes au lieu d'une" : "Aucune ligne trouvée", code: "PGRST116" }, count };
      return { data: lignes[0], error: null, count };
    }
    if (this.unique === "maybe") {
      if (lignes.length > 1) return { data: null, error: { message: "Plusieurs lignes au lieu d'une", code: "PGRST116" }, count };
      return { data: lignes[0] ?? null, error: null, count };
    }
    return { data: lignes, error: null, count };
  }

  private async executer(): Promise<ReponseLibre> {
    try {
      if (this.erreurConstruction) throw this.erreurConstruction;
      switch (this.action) {
        case "select":
          return await this.lire();
        case "insert":
        case "upsert":
          return await this.ajouter();
        case "update":
          return await this.modifier();
        case "delete":
          return await this.supprimer();
      }
    } catch (e) {
      const err = e instanceof ErreurSql ? e : new ErreurSql(e instanceof Error ? e.message : String(e), "XX000");
      return { data: null, error: { message: err.message, code: err.code }, count: null };
    }
  }

  private async lire(): Promise<ReponseLibre> {
    const r = this.regle("lecture");
    const { sql: ou, valeurs } = this.ou([...this.filtres, ...this.conditionRegle(r, false)]);
    if (this.compter && this.tete) {
      const [l] = await this.moteur.lire(`select count(*) as n from ${this.table} t${ou}`, valeurs);
      return { data: null, error: null, count: Number(l?.n ?? 0) };
    }
    const colonnes = this.colonnesLisibles(this.colonnes, r);
    const tri = this.tri.length ? ` order by ${this.tri.map((x) => `t.${x.colonne} ${x.croissant ? "asc nulls last" : "desc nulls first"}`).join(", ")}` : "";
    const limite = this.limite !== null ? ` limit ${this.limite}` : "";
    const lignes = await this.moteur.lire(`select ${colonnes.map((c) => `t.${c}`).join(", ")} from ${this.table} t${ou}${tri}${limite}`, valeurs);
    let count: number | null = null;
    if (this.compter) {
      const [l] = await this.moteur.lire(`select count(*) as n from ${this.table} t${ou}`, valeurs);
      count = Number(l?.n ?? 0);
    }
    return this.forme(
      lignes.map((l) => this.convertir(l, colonnes)),
      count,
    );
  }

  /** Vérifie qu'une ligne écrite respecte la règle de l'utilisateur (sinon tout est annulé). */
  private async verifierEcrite(m: Moteur, r: Regle | null, ligne: Record<string, unknown>): Promise<void> {
    if (!r) return;
    const cles = TABLES[this.table].cle;
    const conditions = this.conditionRegle(r, true);
    const filtres: Filtre[] = [...cles.map((c) => ({ sql: `t.${c} = ?`, valeurs: [this.val(c, ligne[c])] })), ...conditions];
    const { sql, valeurs } = this.ou(filtres);
    const [l] = await m.lire(`select count(*) as n from ${this.table} t${sql}`, valeurs);
    if (Number(l?.n ?? 0) === 0) throw refus(this.table);
  }

  /** Colonnes renvoyées après une écriture. */
  private colonnesRetour(r: Regle | null): string[] | null {
    if (this.retour === null) return null;
    return this.colonnesLisibles(this.retour, r);
  }

  private async ajouter(): Promise<ReponseLibre> {
    const r = this.regle("ajout");
    if (this.action === "upsert" && !this.ignorerDoublons) this.regle("modification");
    const info = TABLES[this.table];
    const colonnesRetour = this.colonnesRetour(r);
    const toutes = Object.keys(info.colonnes);
    const ecrites = await this.moteur.transaction(async (m) => {
      const out: Record<string, unknown>[] = [];
      for (const brute of this.lignes) {
        const ligne: Record<string, unknown> = { ...brute };
        for (const c of Object.keys(ligne)) {
          if (!Object.prototype.hasOwnProperty.call(info.colonnes, c)) throw new ErreurSql(`colonne inconnue « ${c} » dans ${this.table}`, "42703");
          if (ligne[c] === undefined) delete ligne[c];
        }
        if (r?.proprietaire && this.role.genre === "utilisateur") ligne[r.proprietaire] = this.role.id;
        if (info.idAuto && (ligne.id === undefined || ligne.id === null)) ligne.id = crypto.randomUUID();
        const cols = Object.keys(ligne);
        const valeurs = cols.map((c) => this.val(c, ligne[c]));
        let sql = `insert into ${this.table} (${cols.join(", ")}) values (${cols.map(() => "?").join(", ")})`;
        if (this.action === "upsert") {
          const aMettreAJour = cols.filter((c) => !this.conflit.includes(c) && !(info.idAuto && c === "id"));
          sql += ` on conflict (${this.conflit.join(", ")}) ${this.ignorerDoublons || !aMettreAJour.length ? "do nothing" : `do update set ${aMettreAJour.map((c) => `${c} = excluded.${c}`).join(", ")}`}`;
        }
        const lignes = await m.lire(`${sql} returning ${toutes.join(", ")}`, valeurs);
        for (const l of lignes) {
          const convertie = this.convertir(l, toutes);
          await this.verifierEcrite(m, r, convertie);
          out.push(convertie);
        }
      }
      return out;
    });
    return this.resultatEcriture(ecrites, colonnesRetour);
  }

  private resultatEcriture(lignes: Record<string, unknown>[], colonnes: string[] | null): ReponseLibre {
    if (!colonnes) return { data: null, error: null, count: null };
    return this.forme(
      lignes.map((l) => Object.fromEntries(colonnes.map((c) => [c, l[c]]))),
      null,
    );
  }

  private async modifier(): Promise<ReponseLibre> {
    const r = this.regle("modification");
    const info = TABLES[this.table];
    const cols = Object.keys(this.maj).filter((c) => this.maj[c] !== undefined);
    for (const c of cols) {
      if (!Object.prototype.hasOwnProperty.call(info.colonnes, c)) throw new ErreurSql(`colonne inconnue « ${c} » dans ${this.table}`, "42703");
      if (r?.modification && !r.modification.includes(c)) throw new ErreurSql(`permission denied for column ${c} of table ${this.table}`, "42501");
      if (r?.proprietaire === c) throw refus(this.table);
    }
    const colonnesRetour = this.colonnesRetour(r);
    if (!cols.length) return this.resultatEcriture([], colonnesRetour);
    const toutes = Object.keys(info.colonnes);
    const { sql: ou, valeurs: vOu } = this.ou([...this.filtres, ...this.conditionRegle(r, true)]);
    const ecrites = await this.moteur.transaction(async (m) => {
      const lignes = await m.lire(
        `update ${this.table} as t set ${cols.map((c) => `${c} = ?`).join(", ")}${ou} returning ${toutes.join(", ")}`,
        [...cols.map((c) => this.val(c, this.maj[c])), ...vOu],
      );
      const out = lignes.map((l) => this.convertir(l, toutes));
      for (const l of out) await this.verifierEcrite(m, r, l);
      return out;
    });
    return this.resultatEcriture(ecrites, colonnesRetour);
  }

  private async supprimer(): Promise<ReponseLibre> {
    const r = this.regle("suppression");
    const toutes = Object.keys(TABLES[this.table].colonnes);
    const colonnesRetour = this.colonnesRetour(r);
    const { sql: ou, valeurs } = this.ou([...this.filtres, ...this.conditionRegle(r, true)]);
    const lignes = await this.moteur.lire(`delete from ${this.table} as t${ou} returning ${toutes.join(", ")}`, valeurs);
    return this.resultatEcriture(
      lignes.map((l) => this.convertir(l, toutes)),
      colonnesRetour,
    );
  }
}

/** Fonctions appelées par `client.rpc(nom, arguments)`. */
export type Fonction = (m: Moteur, role: Role, args: Record<string, unknown>) => Promise<unknown>;

/** Client de base de données : `from(table)` pour les requêtes, `rpc(nom)` pour les fonctions. */
export class Client {
  /** Crée le client d'un rôle. */
  constructor(
    readonly moteur: Moteur,
    readonly role: Role,
    private readonly fonctions: Record<string, Fonction>,
  ) {}

  /** Requête sur une table connue. */
  from(table: string): Requete {
    if (!estTable(table)) {
      // Table inconnue : la requête échouera proprement à l'exécution.
      const r = new Requete(this.moteur, this.role, "espaces");
      return r.select(`__table_inconnue_${table.replace(/[^a-z_]/gi, "")}`);
    }
    return new Requete(this.moteur, this.role, table);
  }

  /** Appelle une fonction de la base (dépense du mois, prise de tâche…). */
  async rpc(nom: string, args: Record<string, unknown> = {}): Promise<ReponseLibre> {
    const f = this.fonctions[nom];
    if (!f) return { data: null, error: { message: `fonction inconnue : ${nom}`, code: "42883" }, count: null };
    try {
      return { data: await f(this.moteur, this.role, args), error: null, count: null };
    } catch (e) {
      const err = e instanceof ErreurSql ? e : new ErreurSql(e instanceof Error ? e.message : String(e), "XX000");
      return { data: null, error: { message: err.message, code: err.code }, count: null };
    }
  }
}
