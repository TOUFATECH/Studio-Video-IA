// Configuration Next.js de l'app web Studio Vidéo IA.
// Les paquets du monorepo sont livrés en TypeScript : Next les transpile lui-même.
import type { NextConfig } from "next";

/** Réglages de Next : transpilation des paquets internes, en-têtes de sécurité. */
const config: NextConfig = {
  transpilePackages: ["@studio-video-ia/core", "@studio-video-ia/integrations"],
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
