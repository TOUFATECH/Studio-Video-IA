// Lecture paresseuse des variables d'environnement : jamais au chargement du module,
// pour que « next build » passe sans fichier .env. L'accès par clé dynamique évite que Next fige la valeur au build.

/** Variables attendues par l'app web. */
export const NOMS_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ENCRYPTION_KEY",
  "APP_URL",
] as const;
export type NomEnv = (typeof NOMS_ENV)[number];

/** Valeur d'une variable, ou undefined si elle est absente ou vide. */
export function lireEnv(nom: NomEnv): string | undefined {
  const valeur = process.env[nom];
  return valeur && valeur.trim() ? valeur.trim() : undefined;
}

/** Valeur d'une variable obligatoire ; lève une erreur lisible si elle manque. */
export function exigerEnv(nom: NomEnv): string {
  const valeur = lireEnv(nom);
  if (!valeur) throw new Error(`Variable d'environnement ${nom} manquante : voir .env.example.`);
  return valeur;
}

/** Vrai si Supabase est configuré (URL et clé publique). */
export function supabaseConfigure(): boolean {
  return !!lireEnv("NEXT_PUBLIC_SUPABASE_URL") && !!lireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

/** Adresse publique de l'app, sans barre oblique finale. */
export function urlApp(): string {
  return exigerEnv("APP_URL").replace(/\/+$/, "");
}
