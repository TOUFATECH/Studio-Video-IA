// `npm run mot-de-passe -- <email> <nouveau mot de passe> [--sans-2fa]` : remet un mot de passe oublié (sur la machine
// du studio). Ferme toutes les sessions du compte. `--sans-2fa` désactive aussi la double authentification (téléphone perdu).
// Sans compte à cette adresse, rien n'est modifié.
import { changerMotDePasse, configBase, enregistrerTotp, ouvrirBase } from "./index";

/** Change le mot de passe demandé. */
async function principal(): Promise<void> {
  const args = process.argv.slice(2);
  const sans2fa = args.includes("--sans-2fa");
  const [email, nouveau] = args.filter((a) => a !== "--sans-2fa");
  if (!email || !nouveau) {
    console.error("Usage : npm run mot-de-passe -- <email> <nouveau mot de passe (10 caractères minimum)> [--sans-2fa]");
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
    if (sans2fa) await enregistrerTotp(base.moteur, String(u.id), null, false);
    console.log(`Mot de passe de ${email} changé${sans2fa ? ", double authentification désactivée" : ""} ; ses sessions ouvertes sont fermées.`);
  } finally {
    await base.fermer();
  }
}

principal().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
