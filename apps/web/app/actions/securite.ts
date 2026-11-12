"use server";
// Double authentification du compte : préparation (secret chiffré), activation par un premier code, désactivation.
import { enregistrerTotp, genererSecretTotp, lireTotp, verifierTotp } from "@studio-video-ia/base";
import { chiffrer, dechiffrer } from "@studio-video-ia/core/chiffrement";
import { executer } from "@/lib/action";
import { base } from "@/lib/bdd";
import { cleMaitre } from "@/lib/cles";
import { ErreurUtilisateur } from "@/lib/erreurs";
import { formulaire, premiereErreur, schemaCodeTotp } from "@/lib/schemas";
import { utilisateur } from "@/lib/session";

/** Code saisi, validé, ou erreur affichable. */
function code(fd: FormData): string {
  const r = schemaCodeTotp.safeParse(formulaire(fd));
  if (!r.success) throw new ErreurUtilisateur(premiereErreur(r.error));
  return r.data.code;
}

/** Crée un nouveau secret (pas encore actif) : il s'affiche en QR code pour l'appli d'authentification. */
export async function preparerDeuxFacteurs(): Promise<void> {
  await executer(async () => {
    const { user } = await utilisateur();
    const { moteur } = await base();
    if ((await lireTotp(moteur, user.id)).actif) throw new ErreurUtilisateur("La double authentification est déjà active.");
    await enregistrerTotp(moteur, user.id, chiffrer(genererSecretTotp(), cleMaitre()), false);
    return { message: "Scanne le QR code avec ton appli, puis tape le code affiché." };
  });
}

/** Active la double authentification après un premier code correct. */
export async function activerDeuxFacteurs(fd: FormData): Promise<void> {
  await executer(async () => {
    const saisi = code(fd);
    const { user } = await utilisateur();
    const { moteur } = await base();
    const etat = await lireTotp(moteur, user.id);
    if (!etat.chiffre) throw new ErreurUtilisateur("Prépare d’abord la double authentification.");
    if (!verifierTotp(dechiffrer(etat.chiffre, cleMaitre()), saisi)) throw new ErreurUtilisateur("Code incorrect. Vérifie l’heure de ton téléphone.");
    await enregistrerTotp(moteur, user.id, etat.chiffre, true);
    return { message: "Double authentification activée : le code sera demandé à chaque connexion." };
  });
}

/** Désactive la double authentification (code actuel exigé). */
export async function desactiverDeuxFacteurs(fd: FormData): Promise<void> {
  await executer(async () => {
    const saisi = code(fd);
    const { user } = await utilisateur();
    const { moteur } = await base();
    const etat = await lireTotp(moteur, user.id);
    if (!etat.actif || !etat.chiffre) throw new ErreurUtilisateur("La double authentification n’est pas active.");
    if (!verifierTotp(dechiffrer(etat.chiffre, cleMaitre()), saisi)) throw new ErreurUtilisateur("Code incorrect.");
    await enregistrerTotp(moteur, user.id, null, false);
    return { message: "Double authentification désactivée.", ton: "info" };
  });
}
