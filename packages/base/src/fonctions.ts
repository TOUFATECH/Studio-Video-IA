// Fonctions de la base appelées par `client.rpc(nom)` : dépense du mois, prise d'une tâche par un worker,
// libération des tâches abandonnées. Même comportement en SQLite et en PostgreSQL.
import { ErreurSql, type Moteur } from "./moteur";
import { ligneJs, versBase, type Fonction, type Role } from "./requete";

/** Début du mois en cours (UTC), en ISO 8601. */
export function debutDuMois(maintenant = new Date()): string {
  return new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), 1)).toISOString();
}

/** Lève une erreur si l'appel ne vient pas du serveur ou du worker. */
function exigerAdmin(role: Role, nom: string): void {
  if (role.genre !== "admin") throw new ErreurSql(`permission denied for function ${nom}`, "42501");
}

/** Lit une chaîne dans les arguments. */
function texte(args: Record<string, unknown>, cle: string): string {
  const v = args[cle];
  if (typeof v !== "string" || !v) throw new ErreurSql(`argument « ${cle} » manquant`, "22023");
  return v;
}

/** Dépense du mois d'un espace (journal des dépenses). Un utilisateur ne voit que ses espaces (0 sinon). */
const depenseDuMois: Fonction = async (m, role, args) => {
  const espace = texte(args, "e");
  const valeurs: unknown[] = [espace, debutDuMois()];
  let condition = "";
  if (role.genre === "utilisateur") {
    condition = " and espace_id in (select id from espaces where proprietaire = ?)";
    valeurs.push(role.id);
  }
  const [l] = await m.lire(`select coalesce(sum(montant), 0) as total from depenses where espace_id = ? and cree_le >= ?${condition}`, valeurs);
  return Number(l?.total ?? 0);
};

/**
 * Prend la tâche suivante (priorité puis ancienneté) et la verrouille pour ce worker.
 * PostgreSQL : FOR UPDATE SKIP LOCKED ; SQLite : la transaction prend le verrou d'écriture du fichier.
 */
const prendreTache: Fonction = async (moteur, role, args) => {
  exigerAdmin(role, "prendre_tache");
  const worker = texte(args, "p_worker");
  const types = Array.isArray(args.p_types) ? (args.p_types as unknown[]).filter((t): t is string => typeof t === "string") : null;
  return moteur.transaction(async (m: Moteur) => {
    const maintenant = new Date().toISOString();
    const filtreTypes = types?.length ? ` and type in (${types.map(() => "?").join(", ")})` : "";
    const verrou = m.dialecte === "postgres" ? " for update skip locked" : "";
    const [choisie] = await m.lire(
      `select id from taches where statut = 'en_file' and executer_apres <= ?${filtreTypes} order by priorite desc, cree_le limit 1${verrou}`,
      [versBase("horodatage", maintenant, m.dialecte), ...(types ?? [])],
    );
    if (!choisie) return [];
    const lignes = await m.lire(
      `update taches set statut = 'en_cours', verrouille_par = ?, verrouille_le = ?, essais = essais + 1, modifie_le = ? where id = ? and statut = 'en_file' returning *`,
      [worker, maintenant, maintenant, choisie.id],
    );
    return lignes.map((l) => ligneJs("taches", l));
  });
};

/** Message des tâches abandonnées trop souvent. */
const MESSAGE_ABANDON = "Abandonnée après 3 essais : le worker s'est arrêté pendant cette tâche. Relance-la à la main si besoin.";

/**
 * Tâches d'un worker arrêté en plein travail (verrou de plus de 30 min) : remises en file,
 * ou en échec après 3 essais. Renvoie le nombre de tâches remises en file.
 */
const libererTachesBloquees: Fonction = async (moteur, role) => {
  exigerAdmin(role, "liberer_taches_bloquees");
  const limite = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const maintenant = new Date().toISOString();
  return moteur.transaction(async (m) => {
    await m.executer(
      `update taches set statut = 'echec', erreur = ?, verrouille_par = null, verrouille_le = null, modifie_le = ? where statut = 'en_cours' and verrouille_le < ? and essais >= 3`,
      [MESSAGE_ABANDON, maintenant, limite],
    );
    return m.executer(
      `update taches set statut = 'en_file', verrouille_par = null, verrouille_le = null, modifie_le = ? where statut = 'en_cours' and verrouille_le < ? and essais < 3`,
      [maintenant, limite],
    );
  });
};

/** Fonctions disponibles par `rpc`. */
export const FONCTIONS: Record<string, Fonction> = {
  depense_du_mois: depenseDuMois,
  prendre_tache: prendreTache,
  liberer_taches_bloquees: libererTachesBloquees,
};
