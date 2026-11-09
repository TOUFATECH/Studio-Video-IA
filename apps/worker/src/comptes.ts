// Comptes de réseaux connectés : déchiffrement des jetons, renouvellement avant expiration, compte marqué « expiré ».
import type { ReseauConnecte } from "@feuilleton/core";
import { chiffrer } from "@feuilleton/core/chiffrement";
import { doitRenouveler, estErreurJeton, renouvelerJeton, type Fetch } from "@feuilleton/integrations";
import { dechiffrerValeur, exigerApp, type ClesProprietaire } from "./cles";
import { journal } from "./journal";
import { ecrire, ligne, type Base } from "./supabase";

/** Un compte connecté avec ses jetons chiffrés (lisibles seulement côté serveur). */
export type CompteReseau = ReseauConnecte & { jeton_acces_chiffre: string | null; jeton_renouvellement_chiffre: string | null };

/** Message affiché quand il faut reconnecter un compte. */
export const MESSAGE_RECONNEXION = "Reconnecte le compte dans Réglages → Réseaux : son autorisation a expiré ou a été retirée.";

/** Le jeton d'un compte n'est plus valable : l'utilisateur doit reconnecter le compte. */
export class ErreurReconnexion extends Error {
  /** Crée l'erreur avec le message affiché dans l'interface. */
  constructor(detail?: string) {
    super(detail ? `${MESSAGE_RECONNEXION} (${detail})` : MESSAGE_RECONNEXION);
    this.name = "ErreurReconnexion";
  }
}

/** Charge un compte connecté avec ses jetons chiffrés. */
export async function chargerCompte(db: Base, id: string): Promise<CompteReseau> {
  return ligne<CompteReseau>(db.from("reseaux_connectes").select("*").eq("id", id).limit(1), "compte connecté");
}

/** Marque un compte comme expiré (l'interface propose alors de le reconnecter). */
export async function marquerExpire(db: Base, compteId: string): Promise<void> {
  await ecrire(db.from("reseaux_connectes").update({ statut: "expire" }).eq("id", compteId), "compte expiré");
}

/**
 * Jeton d'accès utilisable pour un compte : déchiffré, renouvelé s'il expire bientôt (et réenregistré chiffré).
 * Si le renouvellement est refusé, le compte passe en « expire » et une ErreurReconnexion est levée.
 */
export async function jetonValide(p: { db: Base; cleMaitre: Buffer; cles: ClesProprietaire; compte: CompteReseau; f?: Fetch; maintenant?: Date }): Promise<string> {
  const { db, cleMaitre, compte } = p;
  if (compte.statut !== "connecte") throw new ErreurReconnexion(`compte ${compte.statut === "expire" ? "expiré" : "déconnecté"}`);
  if (!compte.jeton_acces_chiffre) throw new ErreurReconnexion("jeton absent");
  const acces = dechiffrerValeur(compte.jeton_acces_chiffre, cleMaitre, `le jeton ${compte.reseau}`);
  const renouvellement = compte.jeton_renouvellement_chiffre ? dechiffrerValeur(compte.jeton_renouvellement_chiffre, cleMaitre, `le jeton de renouvellement ${compte.reseau}`) : null;
  const expireLe = compte.jeton_expire_le ? new Date(compte.jeton_expire_le) : null;
  if (!doitRenouveler(compte.reseau, expireLe, p.maintenant ?? new Date())) return acces;
  try {
    const neuf = await renouvelerJeton(compte.reseau, exigerApp(p.cles, compte.reseau), { acces, renouvellement }, p.f ?? fetch);
    await ecrire(
      db
        .from("reseaux_connectes")
        .update({
          jeton_acces_chiffre: chiffrer(neuf.acces, cleMaitre),
          jeton_renouvellement_chiffre: neuf.renouvellement ? chiffrer(neuf.renouvellement, cleMaitre) : compte.jeton_renouvellement_chiffre,
          jeton_expire_le: neuf.expireLe?.toISOString() ?? null,
        })
        .eq("id", compte.id),
      "jeton renouvelé",
    );
    journal("info", `jeton ${compte.reseau} renouvelé pour « ${compte.nom_compte} »`);
    return neuf.acces;
  } catch (e) {
    const expire = expireLe !== null && expireLe.getTime() <= Date.now();
    // Un refus du réseau, ou un jeton déjà expiré qu'on n'arrive pas à renouveler : il faut reconnecter.
    if (estErreurJeton(e) || (expire && e instanceof Error && /400|401/.test(e.message))) {
      await marquerExpire(db, compte.id);
      throw new ErreurReconnexion(e instanceof Error ? e.message : undefined);
    }
    // Jeton encore valable un moment (Instagram : 7 jours de marge) : on continue avec l'ancien.
    if (!expire) {
      journal("attention", `renouvellement du jeton ${compte.reseau} impossible pour l'instant : ${e instanceof Error ? e.message : String(e)}`);
      return acces;
    }
    throw e;
  }
}
