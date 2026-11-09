// Configuration des tests unitaires de l'app web : seulement les parties pures (aucun appel réseau).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@/": fileURLToPath(new URL("./", import.meta.url)),
      // « server-only » lève une erreur hors de React Server Components : neutralisé pour les tests.
      "server-only": fileURLToPath(new URL("./tests/server-only-vide.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
