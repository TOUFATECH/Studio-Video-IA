// `npm run mot-de-passe -- <email> <nouveau mot de passe>` : remet un mot de passe oublié (sur la machine du studio).
// Ferme toutes les sessions du compte. Sans compte à cette adresse, rien n'est modifié.
import { changerMotDePasse, configBase, ouvrirBase } from "./index";

/** Change le mot de passe demandé. */
async function principal(): Promise<void> {
  const [email, nouveau] = process.argv.slice(2);
  if (!email || !nouveau) {
    console.error("Usage : npm run mot-de-passe -- <email> <nouveau mot de passe (10 caractères minimum)>");
    process.exit(2);
  }
  const base = await ouvrirBase(configBase());
  try {
    const [u] = await base.moteur.lire(`select id from utilisateurs where lower(email) = ?`, [email.trim().toLowerCase()]);
    if (!u) {
      console.error(`Aucun compte avec l'adresse ${email}.`);
      process.exitCode = 1;
      return;
    }
    await changerMotDePasse(base.moteur, String(u.id), nouveau);
    console.log(`Mot de passe de ${email} changé ; ses sessions ouvertes sont fermées.`);
  } finally {
    await base.fermer();
  }
}

principal().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
