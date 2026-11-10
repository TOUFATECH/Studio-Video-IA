// Configuration Next.js de l'app web Studio Vidéo IA.
// Les paquets du monorepo sont livrés en TypeScript : Next les transpile lui-même.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Un seul fichier .env à la racine du dépôt pour le site et le worker (apps/web/.env.local reste possible).
// Les variables déjà définies (Docker, système) ne sont pas remplacées.
const envRacine = resolve(process.cwd(), "../../.env");
if (existsSync(envRacine)) {
  try {
    process.loadEnvFile(envRacine);
  } catch {
    // Fichier illisible : on continue avec l'environnement actuel.
  }
}

/** Réglages de Next : transpilation des paquets internes, en-têtes de sécurité. */
const config: NextConfig = {
  transpilePackages: ["@studio-video-ia/core", "@studio-video-ia/integrations", "@studio-video-ia/base"],
  // Pilote PostgreSQL chargé par Node tel quel (base externe) ; la base locale utilise node:sqlite, intégré à Node.
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  // Pas d'ESLint dans ce lot : la vérification passe par « tsc --noEmit ».
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Les imports de fichiers passent par /api/import, pas par les Server Actions : on garde la limite basse.
    serverActions: { bodySizeLimit: "1mb" },
  },
  async headers() {
    return [
      {
        source: "/:chemin*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
