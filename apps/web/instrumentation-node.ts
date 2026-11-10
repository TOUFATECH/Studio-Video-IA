// Démarrage du serveur Node : ouverture de la base (SQLite local ou PostgreSQL externe) et création ou mise à jour
// du schéma avant la première page. Une erreur ici s'affiche tout de suite dans le terminal.
import { adresseLisible, baseGlobale } from "@studio-video-ia/base";

try {
  const b = await baseGlobale();
  const nouvelles = b.migration.appliquees;
  console.log(`[studio] base : ${adresseLisible(b.config)} · schéma v${b.migration.version}${nouvelles.length ? ` (créé ou mis à jour : v${nouvelles.join(", v")})` : ""}`);
  console.log(`[studio] médias : ${b.depot.dossier}`);
} catch (e) {
  console.error(`[studio] base de données inaccessible : ${e instanceof Error ? e.message : String(e)}`);
}
