// Schémas Zod de toutes les entrées : formulaires des Server Actions et paramètres d'URL.
// Module pur (sans accès réseau), testé dans tests/schemas.test.ts.
import { DUREES_AUTORISEES, DUREE_PLAN, FOURNISSEURS, GENRES_ELEMENT, LANGUES, schemaEffet, schemaLangue, schemaSousTitres, schemaTransition, schemaTypePlan, VOIX_GROK } from "@studio-video-ia/core";
import { z } from "zod";
import { fuseauValide, schemaSaisieLocale } from "./dates";

/** Convertit un FormData en objet simple. Les clés listées dans `multiples` deviennent des tableaux. */
export function formulaire(fd: FormData, multiples: readonly string[] = []): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of multiples) o[k] = [];
  for (const [cle, valeur] of fd.entries()) {
    // Les champs internes de Next ($ACTION_…) et les fichiers ne sont pas des données du formulaire.
    if (cle.startsWith("$ACTION") || typeof valeur !== "string") continue;
    if (multiples.includes(cle)) (o[cle] as string[]).push(valeur);
    else o[cle] = valeur;
  }
  return o;
}

/** Premier message d'erreur lisible d'une validation ratée. */
export function premiereErreur(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Données invalides.";
}

/** Identifiant de ligne. */
export const id = z.string().uuid("Identifiant invalide.");
/** Case à cocher HTML : présente (« on ») = vrai, absente = faux. */
export const caseACocher = z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean());
/** Texte libre nettoyé, de longueur bornée. */
const texte = (max: number) => z.string().trim().max(max, `${max} caractères maximum.`);
/** Identifiant facultatif : une chaîne vide devient null. */
const idOuNul = z.preprocess((v) => (v === "" || v === undefined ? null : v), id.nullable());

/** Styles visuels proposés à la création d'une série. */
export const STYLES_VISUELS = ["Cinématique", "3D cartoon", "Anime", "Réaliste", "Aquarelle"] as const;

// ---------- Connexion ----------
export const schemaConnexion = z.object({
  email: z.string().trim().email("Adresse e-mail invalide."),
  mot_de_passe: z.string().min(1, "Mot de passe manquant.").max(200),
  suite: z.string().optional(),
});
export const schemaInscription = z
  .object({
    email: z.string().trim().email("Adresse e-mail invalide."),
    mot_de_passe: z.string().min(10, "Mot de passe trop court (10 caractères minimum).").max(200),
    confirmation: z.string(),
    suite: z.string().optional(),
  })
  .refine((d) => d.mot_de_passe === d.confirmation, { message: "Les deux mots de passe ne sont pas identiques.", path: ["confirmation"] });

/** Chemin de retour après connexion : uniquement un chemin interne (évite une redirection ouverte). */
export function cheminSur(suite: string | undefined | null): string {
  if (!suite || !suite.startsWith("/") || suite.startsWith("//") || suite.includes("\\")) return "/";
  return suite;
}

// ---------- Espaces et réseaux ----------
export const schemaChoixEspace = z.object({ espace: z.union([z.literal("tous"), id]) });
export const schemaNouvelEspace = z.object({ nom: texte(80).min(1, "Donne un nom au compte.") });
export const schemaModifEspace = z.object({
  id,
  nom: texte(80).min(1, "Donne un nom au compte."),
  couleur: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Couleur invalide."),
  fuseau: z.string().refine(fuseauValide, "Fuseau horaire inconnu."),
  plafond_mensuel: z.coerce.number().min(0, "Le plafond ne peut pas être négatif.").max(100_000),
});
export const schemaPlafond = z.object({ id, plafond_mensuel: z.coerce.number().min(0).max(100_000) });
export const schemaModifReseau = z.object({ id, langue: schemaLangue });
export const schemaIdSeul = z.object({ id });
export const schemaAudit = z.object({ id, valide: caseACocher });

// ---------- Clés API ----------
/** Clé simple (OpenAI, xAI, ElevenLabs). */
const cleSimple = z.object({
  fournisseur: z.enum(["openai", "xai", "elevenlabs", "anthropic"]),
  valeur: z.string().trim().min(8, "Clé trop courte.").max(500, "Clé trop longue."),
});
/** Application OAuth (Google, Meta, TikTok) : identifiant et secret. */
const cleApplication = z.object({
  fournisseur: z.enum(["google", "meta", "tiktok"]),
  client_id: z.string().trim().min(4, "Identifiant d’application trop court.").max(300),
  client_secret: z.string().trim().min(4, "Secret d’application trop court.").max(500),
});
export const schemaCle = z.discriminatedUnion("fournisseur", [cleSimple, cleApplication]);
export const schemaFournisseur = z.object({ fournisseur: z.enum(FOURNISSEURS) });

// ---------- Budget et préférences ----------
export const schemaTarifsFormulaire = z.object({
  image: z.coerce.number().min(0).max(100),
  video_seconde: z.coerce.number().min(0).max(100),
  voix_1000_car: z.coerce.number().min(0).max(100),
  musique_minute: z.coerce.number().min(0).max(100).default(0.5),
});
export const schemaPreferencesFormulaire = z.object({
  parallele: z.coerce.number().int().min(1).max(4),
  sous_titres: z.enum(["aucun", "fr", "en"]),
  prises: z.coerce.number().pipe(z.union([z.literal(1), z.literal(2)])),
  memoire_auto: caseACocher,
  theme: z.enum(["sombre", "clair"]).default("sombre"),
  propositions: z.coerce.number().int().min(1).max(4).default(1),
  controle_qualite: caseACocher,
  plafond_episode: z.coerce.number().min(0, "Le plafond ne peut pas être négatif.").max(10000).default(20),
});

// ---------- Séries ----------
export const schemaNouvelleSerie = z.object({
  nom: texte(120).min(1, "Donne un nom à la série."),
  espace_id: id,
  style_visuel: z.enum(STYLES_VISUELS),
  langue: schemaLangue,
});
export const schemaBible = z.object({
  id,
  nom: texte(120).min(1, "Le nom ne peut pas être vide."),
  univers: texte(6000),
  fil_rouge: texte(6000),
  style_visuel: z.enum(STYLES_VISUELS),
  langue: schemaLangue,
});
export const schemaRythmeFormulaire = z.object({
  id,
  tous_les_jours: z.coerce.number().int().min(1).max(30),
  heure: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide."),
  reseaux: z.array(id),
  auto: caseACocher,
});
export const schemaSerieSeule = z.object({ serie_id: id });
export const schemaSaisonSeule = z.object({ saison_id: id });

export const schemaPersonnage = z
  .object({
    id,
    nom: texte(80).min(1, "Donne un nom au personnage."),
    description: texte(3000),
    source_voix: z.enum(["elevenlabs", "elevenlabs_clone", "grok"]),
    voix_id: texte(120),
    accord_clone: caseACocher,
  })
  .refine((p) => p.source_voix !== "elevenlabs_clone" || p.accord_clone, {
    message: "Une voix clonée demande l’accord de la personne : coche la case.",
    path: ["accord_clone"],
  });

export const schemaFait = z.object({
  serie_id: id,
  episode_id: idOuNul,
  genre: z.enum(["fait", "personnage", "lieu", "objet", "mystere"]),
  texte: texte(1000).min(3, "Écris au moins quelques mots."),
});

// ---------- Épisodes ----------
export const schemaEpisodeFormulaire = z.object({
  id,
  titre: texte(200),
  idee: texte(6000),
  format: z.enum(["court", "moyen", "long"]).default("court"),
  duree_cible: z.coerce.number().int().min(15).max(1200),
  langue: schemaLangue,
  enchainer: caseACocher,
});
export const schemaDemandeModification = z.object({
  episode_id: id,
  demande: texte(1000).min(3, "Décris la modification voulue."),
  plan_ids: z.array(id),
});

/** Durée d'un plan : « auto » ou une durée autorisée par Grok. */
const dureePlan = z
  .string()
  .refine((v) => v === "auto" || (DUREES_AUTORISEES as readonly number[]).includes(Number(v)), "Durée non autorisée.")
  .transform((v) => (v === "auto" ? null : Number(v)));

export const schemaPlanFormulaire = z.object({
  id,
  type: schemaTypePlan,
  texte: texte(3000).min(1, "Décris ce qu’on voit."),
  personnage_id: idOuNul,
  replique: texte(1000).default(""),
  duree: dureePlan,
});
export const schemaEpisodeSeul = z.object({ episode_id: id });
export const schemaPlanSeul = z.object({ plan_id: id });
export const schemaPlans = z.object({ episode_id: id, plan_ids: z.array(id) });
export const schemaValidation = z.object({ plan_id: id, valide: caseACocher });
export const schemaPrises = z.object({ episode_id: id, prises: z.coerce.number().pipe(z.union([z.literal(1), z.literal(2)])) });
export const schemaPrise = z.object({ plan_id: id, prise: z.enum(["A", "B"]) });
export const schemaLangues = z.object({ episode_id: id, langues: z.array(schemaLangue).min(1, "Garde au moins une langue.") });
export const schemaMontage = z.object({ episode_id: id, musique: caseACocher, bruitages: caseACocher });
export const schemaTitre = z.object({ episode_id: id, langue: schemaLangue, choix: z.coerce.number().int().min(0).max(2) });
export const schemaMiniature = z.object({ episode_id: id, choix: z.coerce.number().int().min(0).max(9) });

/** Sous-titres de chaque version : champs « sous_titres_fr », « sous_titres_en »… */
export const schemaSousTitresFormulaire = z
  .object({ episode_id: id })
  .catchall(z.unknown())
  .transform((o, ctx) => {
    const choix: Partial<Record<(typeof LANGUES)[number], z.infer<typeof schemaSousTitres>>> = {};
    for (const l of LANGUES) {
      const v = o[`sous_titres_${l}`];
      if (v === undefined) continue;
      const r = schemaSousTitres.safeParse(v);
      if (!r.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choix de sous-titres invalide." });
        return z.NEVER;
      }
      choix[l] = r.data;
    }
    return { episode_id: o.episode_id, choix };
  });

export const schemaPublier = z
  .object({
    episode_id: id,
    langue: schemaLangue,
    comptes: z.array(id).min(1, "Coche au moins un compte."),
    quand: z.enum(["maintenant", "creneau", "date"]),
    date: z.string().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.quand === "date" && !schemaSaisieLocale.safeParse(p.date ?? "").success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choisis une date et une heure.", path: ["date"] });
    }
  });
export const schemaPublicationSeule = z.object({ publication_id: id });

// ---------- Diagnostic ----------
export const schemaTestComplet = z.object({ sous_titres: schemaSousTitres, espace_id: id });

// ---------- Paramètres d'URL ----------
export const schemaOngletSerie = z.enum(["episodes", "bible", "bibliotheque", "memoire", "publication"]).catch("episodes");
export const schemaEtape = z.enum(["son", "scenario", "storyboard", "clips", "montage", "publication"]);
export const schemaOngletReglages = z.enum(["comptes", "cles", "budget", "preferences", "securite"]).catch("comptes");
export const schemaPeriode = z.enum(["7", "30", "tout"]).catch("30");
export const schemaFiltreReseau = z.enum(["tous", "tiktok", "instagram", "youtube"]).catch("tous");

/** Premier texte d'un paramètre d'URL (Next peut donner un tableau). */
export function parametre(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// ---------- Statistiques et revenus ----------
export const schemaSynchro = z.object({ reseau_connecte_id: z.preprocess((v) => (v === "" ? undefined : v), id.optional()) });
export const schemaRevenu = z.object({
  id: z.preprocess((v) => (v === "" ? undefined : v), id.optional()),
  reseau_connecte_id: id,
  mois: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mois invalide (AAAA-MM)."),
  montant: z.coerce.number().min(0, "Le montant ne peut pas être négatif.").max(10_000_000),
  devise: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Devise sur 3 lettres (EUR, USD…)."),
  note: z.string().trim().max(300).default(""),
});
export const schemaOngletStats = z.enum(["ensemble", "tiktok", "instagram", "youtube"]).catch("ensemble");

// ---------- Clips musicaux ----------
/** Nombre facultatif : une saisie vide devient null. */
const nombreOuNul = z.preprocess((v) => (v === "" || v === undefined || v === null ? null : v), z.coerce.number().nullable());
/** Format d'un clip. */
const formatClip = z.enum(["court", "moyen", "long"]);

export const schemaNouveauClip = z.object({
  espace_id: id,
  titre: texte(200),
  langue: schemaLangue,
  format: formatClip.default("court"),
  source: z.enum(["importer", "generer"]).default("importer"),
});
export const schemaSonParoles = z.object({
  id,
  paroles: texte(20000),
  musique_style: texte(500),
  instrumental: caseACocher,
  langue: schemaLangue,
  fournisseur_texte: z.enum(["openai", "anthropic"]),
});
export const schemaReglagesClip = z
  .object({
    id,
    titre: texte(200),
    idee: texte(6000),
    style_visuel: texte(500),
    format: formatClip,
    extrait_debut: z.coerce.number().min(0, "Le début ne peut pas être négatif.").max(3600),
    extrait_fin: nombreOuNul,
    bpm: nombreOuNul.refine((v) => v === null || (v >= 40 && v <= 240), "Tempo entre 40 et 240 BPM (ou vide)."),
    sous_titres: schemaSousTitres,
  })
  .refine((c) => c.extrait_fin === null || c.extrait_fin > c.extrait_debut + 3, { message: "La fin de l’extrait doit venir au moins 3 s après son début.", path: ["extrait_fin"] });
export const schemaMusique = z.object({ episode_id: id, duree: z.coerce.number().int().min(10, "10 s minimum.").max(600, "10 minutes maximum.") });
export const schemaEspaceClips = z.object({ serie_id: id, nom: texte(120).min(1, "Donne un nom (le tien, ton nom d’artiste…)."), style_visuel: texte(500) });


// ---------- Cahier des charges « Studio Séries IA » ----------

/** Nombre de 1 à 30 épisodes, propositions de 1 à 4. */
const entier = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

/** Arc de saison écrit par l'IA. */
export const schemaArc = z.object({ saison_id: id, idee: texte(4000), nombre: entier(1, 30) });
/** Saison : titre, arc, nombre d'épisodes. */
export const schemaSaisonFormulaire = z.object({ saison_id: id, titre: texte(120), arc: texte(20000), nombre_episodes: z.preprocess((v) => (v === "" ? null : v), entier(1, 30).nullable()) });
/** Story d'un épisode. */
export const schemaStory = z.object({ episode_id: id, accroche: texte(500), deroule: texte(20000), fin_suite: texte(500), rappel: caseACocher });
/** Validation d'une étape par l'auteur (scénario, vidéo finale). */
export const schemaValidationEtape = z.object({ episode_id: id, valide: caseACocher });
/** Marque au montage : logo et carte de fin. */
export const schemaMarqueMontage = z.object({ episode_id: id, logo: caseACocher, carte_fin: caseACocher });

/** Durée d'un plan détaillé : vide = automatique, sinon 1 à 8 s (pas de 0,5 s). */
const dureeLibre = z.preprocess(
  (v) => (v === "" || v === "auto" || v === undefined ? null : v),
  z.coerce.number().min(DUREE_PLAN.min, `${DUREE_PLAN.min} s minimum.`).max(DUREE_PLAN.max, `${DUREE_PLAN.max} s maximum : les IA vidéo produisent des clips courts.`).nullable(),
);

/** Champs détaillés d'un plan (storyboard). */
export const schemaPlanDetaille = z.object({
  id,
  scene_id: idOuNul,
  duree: dureeLibre,
  decor_id: idOuNul,
  activite_id: idOuNul,
  personnages: z.array(id),
  variantes: z.array(id),
  cadrage: texte(200),
  mouvement: texte(500),
  transition: schemaTransition,
  effet: schemaEffet,
  texte_ecran: texte(200),
  son: texte(300),
});

/** Scène d'un épisode. */
export const schemaScene = z.object({ id, titre: texte(200), lieu_id: idOuNul, moment: texte(80), resume: texte(2000), personnages: z.array(id) });
export const schemaSceneSeule = z.object({ scene_id: id });

/** Commentaire sur un plan. */
export const schemaCommentaire = z.object({ plan_id: id, texte: texte(500).min(2, "Écris le commentaire.") });
export const schemaCommentaireSeul = z.object({ plan_id: id, commentaire_id: z.string().min(1).max(64) });

/** Refaire, retoucher, choisir une version. */
export const schemaRefaire = z.object({ plan_id: id, consigne: texte(1000).default(""), propositions: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), entier(1, 4).optional()), confirmer: caseACocher });
export const schemaRetouche = z.object({ plan_id: id, consigne: texte(1000).min(3, "Décris la retouche (« changer le t-shirt en noir »)."), confirmer: caseACocher });
export const schemaVersion = z.object({ fichier_id: id });
/** Refaire une scène ou l'épisode : seulement les plans en erreur, ou tous ; images ou clips. */
export const schemaRefaireLot = z.object({ episode_id: id, scene_id: idOuNul, portee: z.enum(["erreurs", "tous"]), etape: z.enum(["images", "clips"]), confirmer: caseACocher });

/** Élément de la bibliothèque. */
const genreElement = z.enum(Object.keys(GENRES_ELEMENT) as [keyof typeof GENRES_ELEMENT, ...(keyof typeof GENRES_ELEMENT)[]]);
export const schemaNouvelElement = z.object({ serie_id: id, genre: genreElement, nom: texte(120).min(1, "Donne un nom."), personnage_id: idOuNul });
const couleur = z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Couleur invalide.").optional());
export const schemaElement = z.object({
  id,
  nom: texte(120).min(1, "Donne un nom."),
  description: texte(4000),
  moment: texte(80),
  consigne: texte(2000),
  partage: caseACocher,
  principale: couleur,
  secondaire: couleur,
  police: texte(80).default(""),
});
export const schemaFichierSeul = z.object({ fichier_id: id });

/** Voix Grok d'un personnage. */
export const schemaVoixGrok = z.enum(Object.keys(VOIX_GROK) as [keyof typeof VOIX_GROK, ...(keyof typeof VOIX_GROK)[]]);
/** Nouveau personnage décrit en quelques mots : l'IA propose 4 visages. */
export const schemaPersonnageDecrit = z.object({ serie_id: id, nom: texte(80).min(1, "Donne un nom."), description: texte(3000).min(5, "Décris le personnage (âge, rôle, caractère, tenue).") });

/** Préférences de génération (propositions, contrôle qualité, plafond par épisode). */
export const schemaPreferencesGeneration = z.object({ propositions: entier(1, 4), controle_qualite: caseACocher, plafond_episode: z.coerce.number().min(0).max(10000) });

/** Code à 6 chiffres d'une appli d'authentification. */
export const schemaCodeTotp = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Le code fait 6 chiffres.") });
