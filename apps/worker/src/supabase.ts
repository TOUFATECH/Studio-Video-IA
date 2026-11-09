// Client Supabase du worker (clé service_role : accès complet, côté serveur uniquement) et aides de lecture typée.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "./config";

/** Client Supabase utilisé par le worker. */
export type Base = SupabaseClient;

/** Crée le client service_role, sans session persistée (pas de navigateur ici). */
export function creerClient(config: Pick<Config, "supabaseUrl" | "supabaseCle">): Base {
  return createClient(config.supabaseUrl, config.supabaseCle, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Résultat brut d'une requête Supabase. */
type Resultat = { data: unknown; error: { message: string; code?: string } | null };

/** Erreur de base de données lisible, avec le code Postgres quand il existe. */
export class ErreurBase extends Error {
  /** Crée l'erreur « Base (quoi) : message ». */
  constructor(
    quoi: string,
    message: string,
    public readonly code?: string,
  ) {
    super(`Base de données (${quoi}) : ${message}`);
    this.name = "ErreurBase";
  }
}

/** Liste de lignes typées ; lève une ErreurBase en cas d'échec. Les lignes suivent le schéma SQL (types de core). */
export async function lignes<T>(requete: PromiseLike<Resultat>, quoi: string): Promise<T[]> {
  const { data, error } = await requete;
  if (error) throw new ErreurBase(quoi, error.message, error.code);
  return Array.isArray(data) ? (data as T[]) : [];
}

/** Une ligne obligatoire ; lève une erreur claire si elle n'existe pas. */
export async function ligne<T>(requete: PromiseLike<Resultat>, quoi: string): Promise<T> {
  const { data, error } = await requete;
  if (error) throw new ErreurBase(quoi, error.message, error.code);
  const d = Array.isArray(data) ? data[0] : data;
  if (d === null || d === undefined) throw new ErreurBase(quoi, "introuvable");
  return d as T;
}

/** Une ligne facultative (null si absente). */
export async function ligneOuNull<T>(requete: PromiseLike<Resultat>, quoi: string): Promise<T | null> {
  const { data, error } = await requete;
  if (error) throw new ErreurBase(quoi, error.message, error.code);
  const d = Array.isArray(data) ? data[0] : data;
  return d === null || d === undefined ? null : (d as T);
}

/** Exécute une écriture et lève une ErreurBase en cas d'échec. */
export async function ecrire(requete: PromiseLike<{ error: { message: string; code?: string } | null }>, quoi: string): Promise<void> {
  const { error } = await requete;
  if (error) throw new ErreurBase(quoi, error.message, error.code);
}
