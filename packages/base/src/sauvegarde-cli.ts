// `npm run sauvegarde` : copie cohérente de la base SQLite (VACUUM INTO, possible pendant que l'app tourne),
// des médias et de la clé de chiffrement dans <dossier des données>/sauvegardes/<date>/.
// Base PostgreSQL externe : seuls les médias et la clé sont copiés ; la base se sauvegarde avec pg_dump.
import { cp, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { configBase, estPostgres, moteurSqlite } from "./index";

/** Lance la sauvegarde et affiche le dossier créé. */
async function sauvegarder(): Promise<void> {
  const c = configBase();
  const horodatage = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const cible = join(c.dossierDonnees, "sauvegardes", horodatage);
  await mkdir(cible, { recursive: true });
  if (estPostgres(c)) {
    console.log("Base PostgreSQL externe : sauvegarde-la avec « pg_dump » (voir docs/INSTALLER.md).");
  } else {
    const m = await moteurSqlite(c.url.replace(/^sqlite:/, ""));
    await m.executer(`vacuum into ?`, [join(cible, "studio.db")]);
    await m.fermer();
    console.log(`Base copiée : ${join(cible, "studio.db")}`);
  }
  const existe = async (p: string): Promise<boolean> => stat(p).then(() => true).catch(() => false);
  if (await existe(c.dossierMedias)) {
    await cp(c.dossierMedias, join(cible, "medias"), { recursive: true });
    console.log(`Médias copiés : ${join(cible, "medias")}`);
  }
  const cle = join(c.dossierDonnees, "cle-chiffrement");
  if (await existe(cle)) {
    await cp(cle, join(cible, "cle-chiffrement"));
    console.log("Clé de chiffrement copiée (sans elle, les clés API sauvegardées sont illisibles).");
  }
  console.log(`\nSauvegarde terminée : ${cible}\nPour restaurer : arrête l'application, remets ces fichiers dans ${c.dossierDonnees}, relance.`);
}

sauvegarder().catch((e: unknown) => {
  console.error(`Sauvegarde impossible : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
