// Lecture paresseuse des variables d'environnement : jamais au chargement du module,
// pour que « next build » passe sans fichier .env. L'accès par clé dynamique évite que Next fige la valeur au build.

/** Variables lues par l'app web (toutes facultatives : la base locale et la clé de chiffrement se créent seules). */
export const NOMS_ENV = ["APP_URL", "ENCRYPTION_KEY", "DATABASE_URL", "DONNEES_DIR", "MEDIAS_DIR", "INSCRIPTIONS"] as const;
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

/** Adresse publique de l'app, sans barre oblique finale. */
export function urlApp(): string {
  return (lireEnv("APP_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
}
