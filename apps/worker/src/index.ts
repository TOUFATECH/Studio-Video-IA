// Point d'entrée du worker : configuration, connexion Supabase, démarrage de la file, arrêt propre sur SIGINT / SIGTERM.
import { mkdir } from "node:fs/promises";
import { lireCleMaitre } from "@studio-video-ia/core/chiffrement";
import { chargerFichierEnv, ErreurConfig, lireConfig } from "./config";
import { FileDeTaches } from "./file";
import { journal, messageErreur } from "./journal";
import { Stockage } from "./stockage";
import { creerClient } from "./supabase";

/** Démarre le worker. */
async function principal(): Promise<void> {
  const env = chargerFichierEnv();
  if (env) journal("info", `variables lues dans ${env}`);
  const config = lireConfig();
  // INSTAGRAM_API_VERSION est aussi lue par le paquet d'intégrations (testerCompte) : on garde la valeur validée.
  process.env.INSTAGRAM_API_VERSION = config.versionInstagram;
  await mkdir(config.dossierTemp, { recursive: true });
  const db = creerClient(config);
  const file = new FileDeTaches({ db, config, stockage: new Stockage(db), cleMaitre: lireCleMaitre(config.cleChiffrement) });

  let arretEnCours = false;
  const arreter = (signal: string): void => {
    if (arretEnCours) {
      journal("attention", `${signal} reçu une seconde fois : arrêt immédiat`);
      process.exit(1);
    }
    arretEnCours = true;
    journal("info", `${signal} reçu`);
    void file.arreter().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => arreter("SIGINT"));
  process.on("SIGTERM", () => arreter("SIGTERM"));
  process.on("unhandledRejection", (e) => journal("erreur", `promesse rejetée non gérée : ${messageErreur(e)}`));

  await file.demarrer();
}

principal().catch((e: unknown) => {
  if (e instanceof ErreurConfig) console.error(e.message);
  else journal("erreur", `démarrage impossible : ${messageErreur(e)}`);
  process.exit(1);
});
