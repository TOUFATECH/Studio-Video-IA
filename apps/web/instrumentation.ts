// Point d'entrée de démarrage de Next : le code serveur (base de données) n'est chargé que dans Node,
// jamais dans le runtime « edge » du middleware.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
