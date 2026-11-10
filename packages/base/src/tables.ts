// Description des tables : colonnes autorisées et leur nature (pour convertir les valeurs entre JavaScript,
// SQLite et PostgreSQL), clés primaires, et règles d'accès d'un utilisateur (l'équivalent des règles RLS).
// Une colonne absente d'ici est refusée : aucun nom de colonne venu de l'extérieur n'arrive dans le SQL.

/** Nature d'une colonne. */
export type Nature = "texte" | "nombre" | "entier" | "booleen" | "json" | "tableau" | "horodatage" | "date";

/** Description d'une table. */
export type Table = {
  /** Colonnes et leur nature. */
  colonnes: Readonly<Record<string, Nature>>;
  /** Clé primaire (sert à relire les lignes écrites). */
  cle: readonly string[];
  /** Colonne `id` générée par l'application si absente à l'insertion. */
  idAuto: boolean;
};

const T = "texte" as const;
const N = "nombre" as const;
const E = "entier" as const;
const B = "booleen" as const;
const J = "json" as const;
const H = "horodatage" as const;

/** Toutes les tables connues de l'application. */
export const TABLES = {
  utilisateurs: { colonnes: { id: T, email: T, mot_de_passe: T, cree_le: H }, cle: ["id"], idAuto: true },
  sessions: { colonnes: { id: T, utilisateur_id: T, expire_le: H, cree_le: H }, cle: ["id"], idAuto: false },
  espaces: { colonnes: { id: T, proprietaire: T, nom: T, couleur: T, plafond_mensuel: N, fuseau: T, cree_le: H }, cle: ["id"], idAuto: true },
  reglages: { colonnes: { proprietaire: T, tarifs: J, preferences: J, modifie_le: H }, cle: ["proprietaire"], idAuto: false },
  cles_api: { colonnes: { proprietaire: T, fournisseur: T, valeur_chiffree: T, apercu: T, modifie_le: H }, cle: ["proprietaire", "fournisseur"], idAuto: false },
  reseaux_connectes: {
    colonnes: {
      id: T, espace_id: T, reseau: T, nom_compte: T, langue: T, id_externe: T, jeton_acces_chiffre: T, jeton_renouvellement_chiffre: T,
      jeton_expire_le: H, statut: T, audit_tiktok_valide: B, infos: J, cree_le: H,
    },
    cle: ["id"],
    idAuto: true,
  },
  series: {
    colonnes: { id: T, espace_id: T, nom: T, style_visuel: T, langue: T, univers: T, fil_rouge: T, rythme: J, hashtags: J, genre: T, cree_le: H },
    cle: ["id"],
    idAuto: true,
  },
  personnages: {
    colonnes: { id: T, serie_id: T, nom: T, description: T, source_voix: T, voix_id: T, accord_clone: B, fiche_chemin: T, fiche_statut: T, position: E },
    cle: ["id"],
    idAuto: true,
  },
  saisons: { colonnes: { id: T, serie_id: T, numero: E, opening_id: T, ending_id: T }, cle: ["id"], idAuto: true },
  episodes: {
    colonnes: {
      id: T, serie_id: T, saison_id: T, genre: T, numero: E, titre: T, idee: T, format: T, duree_cible: E, langue: T, langues: "tableau",
      sous_titres: J, prises: E, enchainer: B, musique: B, bruitages: B, chapitres: J, titres_traduits: J, choix_titres: J, miniature: J,
      memoire_faite: B, hashtags: J, style_visuel: T, paroles: T, paroles_alignees: J, paroles_traduites: J, bpm: N, extrait_debut: N,
      extrait_fin: N, musique_style: T, instrumental: B, fournisseur_texte: T, cree_le: H,
    },
    cle: ["id"],
    idAuto: true,
  },
  plans: {
    colonnes: {
      id: T, episode_id: T, position: E, section: T, type: T, texte: T, personnage_id: T, replique: T, repliques_traduites: J, duree_fixee: E,
      valide: B, modifie: B, prise_choisie: T, debut: N, fin: N,
    },
    cle: ["id"],
    idAuto: true,
  },
  fichiers: {
    colonnes: {
      id: T, espace_id: T, episode_id: T, plan_id: T, personnage_id: T, genre: T, langue: T, prise: T, chemin: T, duree_s: N,
      secondes_generation: N, cout: N, statut: T, erreur: T, essais: E, cree_le: H,
    },
    cle: ["id"],
    idAuto: true,
  },
  publications: {
    colonnes: {
      id: T, episode_id: T, reseau_connecte_id: T, langue: T, livrable: T, programmee_le: H, statut: T, id_externe: T, url: T, erreur: T,
      progression: E, stats: J, stats_le: H, publiee_le: H, cree_le: H,
    },
    cle: ["id"],
    idAuto: true,
  },
  taches: {
    colonnes: {
      id: T, espace_id: T, episode_id: T, publication_id: T, type: T, statut: T, priorite: E, donnees: J, progression: J, erreur: T, essais: E,
      executer_apres: H, verrouille_par: T, verrouille_le: H, cree_le: H, modifie_le: H,
    },
    cle: ["id"],
    idAuto: true,
  },
  memoire: { colonnes: { id: T, serie_id: T, episode_id: T, genre: T, texte: T, ouvert: B, cree_le: H }, cle: ["id"], idAuto: true },
  workers_etat: { colonnes: { nom: T, vu_le: H, version_ffmpeg: T, infos: J }, cle: ["nom"], idAuto: false },
  depenses: { colonnes: { id: T, espace_id: T, fichier_id: T, genre: T, montant: N, cree_le: H }, cle: ["id"], idAuto: true },
  videos_reseau: {
    colonnes: {
      id: T, reseau_connecte_id: T, id_externe: T, publication_id: T, titre: T, url: T, miniature_url: T, publiee_le: H, duree_s: N, vues: E,
      jaime: E, commentaires: E, partages: E, revenu_estime: N, devise: T, maj_le: H,
    },
    cle: ["id"],
    idAuto: true,
  },
  stats_comptes: {
    colonnes: { id: T, reseau_connecte_id: T, jour: "date", abonnes: E, abonnements: E, jaime_total: E, videos: E, vues_total: E, revenu_estime: N, devise: T },
    cle: ["id"],
    idAuto: true,
  },
  revenus: {
    colonnes: { id: T, reseau_connecte_id: T, mois: "date", montant: N, devise: T, source: T, note: T, cree_le: H },
    cle: ["id"],
    idAuto: true,
  },
} as const satisfies Record<string, Table>;

/** Nom d'une table connue. */
export type NomTable = keyof typeof TABLES;

/** Vrai si le nom désigne une table connue. */
export function estTable(nom: string): nom is NomTable {
  return Object.prototype.hasOwnProperty.call(TABLES, nom);
}

// ---------------------------------------------------------------------------------------------
// Règles d'accès d'un utilisateur connecté (l'équivalent des règles RLS de PostgreSQL)
// ---------------------------------------------------------------------------------------------

/** Opérations possibles sur une table. */
export type Operation = "lecture" | "ajout" | "modification" | "suppression";

/**
 * Règle d'une table pour un utilisateur : condition SQL que chaque ligne doit vérifier (avec `:u` = id de l'utilisateur,
 * et les colonnes de la table préfixées par `t.`), opérations permises, et colonnes lisibles ou modifiables.
 */
export type Regle = {
  condition: string;
  operations: readonly Operation[];
  /** Colonnes lisibles (toutes si absent). Les valeurs chiffrées n'en font jamais partie. */
  lecture?: readonly string[];
  /** Colonnes modifiables (toutes si absent). */
  modification?: readonly string[];
  /** Condition supplémentaire pour écrire (ex. revenus manuels seulement). */
  ecriture?: string;
  /** Colonne remplie d'office avec l'id de l'utilisateur à l'ajout. */
  proprietaire?: string;
};

const MES_ESPACES = `(select id from espaces where proprietaire = :u)`;
const MES_SERIES = `(select s.id from series s join espaces e on e.id = s.espace_id where e.proprietaire = :u)`;
const MES_EPISODES = `(select x.id from episodes x join series s on s.id = x.serie_id join espaces e on e.id = s.espace_id where e.proprietaire = :u)`;
const MES_RESEAUX = `(select r.id from reseaux_connectes r join espaces e on e.id = r.espace_id where e.proprietaire = :u)`;
const TOUT: readonly Operation[] = ["lecture", "ajout", "modification", "suppression"];

/** Règles par table ; une table absente est inaccessible à l'utilisateur (comptes, sessions). */
export const REGLES: Partial<Record<NomTable, Regle>> = {
  espaces: { condition: "t.proprietaire = :u", operations: TOUT, proprietaire: "proprietaire" },
  reglages: { condition: "t.proprietaire = :u", operations: TOUT, proprietaire: "proprietaire" },
  // Les clés s'écrivent par le serveur (chiffrées) ; l'utilisateur ne lit que leur aperçu.
  cles_api: { condition: "t.proprietaire = :u", operations: ["lecture"], lecture: ["proprietaire", "fournisseur", "apercu", "modifie_le"] },
  reseaux_connectes: {
    condition: `t.espace_id in ${MES_ESPACES}`,
    operations: ["lecture", "modification", "suppression"],
    lecture: ["id", "espace_id", "reseau", "nom_compte", "langue", "id_externe", "jeton_expire_le", "statut", "audit_tiktok_valide", "infos", "cree_le"],
    modification: ["nom_compte", "langue", "statut"],
  },
  series: { condition: `t.espace_id in ${MES_ESPACES}`, operations: TOUT },
  personnages: { condition: `t.serie_id in ${MES_SERIES}`, operations: TOUT },
  saisons: { condition: `t.serie_id in ${MES_SERIES}`, operations: TOUT },
  episodes: { condition: `t.serie_id in ${MES_SERIES}`, operations: TOUT },
  plans: { condition: `t.episode_id in ${MES_EPISODES}`, operations: TOUT },
  memoire: { condition: `t.serie_id in ${MES_SERIES}`, operations: TOUT },
  publications: { condition: `t.episode_id in ${MES_EPISODES} and t.reseau_connecte_id in ${MES_RESEAUX}`, operations: TOUT },
  // Fichiers, tâches et dépenses s'écrivent par le serveur ou le worker après vérification.
  fichiers: { condition: `t.espace_id in ${MES_ESPACES}`, operations: ["lecture"] },
  taches: { condition: `t.espace_id in ${MES_ESPACES}`, operations: ["lecture"] },
  depenses: { condition: `t.espace_id in ${MES_ESPACES}`, operations: ["lecture"] },
  videos_reseau: { condition: `t.reseau_connecte_id in ${MES_RESEAUX}`, operations: ["lecture"] },
  stats_comptes: { condition: `t.reseau_connecte_id in ${MES_RESEAUX}`, operations: ["lecture"] },
  // Revenus : lecture de tout, saisie des seuls revenus manuels (ceux de l'API viennent du worker).
  revenus: { condition: `t.reseau_connecte_id in ${MES_RESEAUX}`, operations: TOUT, ecriture: "t.source = 'manuel'" },
  workers_etat: { condition: "1 = 1", operations: ["lecture"] },
};
