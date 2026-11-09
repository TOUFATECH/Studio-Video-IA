// Schémas Zod de toutes les entrées : formulaires des Server Actions et paramètres d'URL.
// Module pur (sans accès réseau), testé dans tests/schemas.test.ts.
import { DUREES_AUTORISEES, FOURNISSEURS, LANGUES, schemaLangue, schemaSousTitres, schemaTypePlan } from "@studio-video-ia/core";
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
  mot_de_passe: z.string().min(6, "Mot de passe trop court (6 caractères minimum).").max(200),
  suite: z.string().optional(),
});
export const schemaLienMagique = z.object({ email: z.string().trim().email("Adresse e-mail invalide."), suite: z.string().optional() });

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
  fournisseur: z.enum(["openai", "xai", "elevenlabs"]),
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
});
export const schemaPreferencesFormulaire = z.object({
  parallele: z.coerce.number().int().min(1).max(4),
  sous_titres: z.enum(["aucun", "fr", "en"]),
  prises: z.coerce.number().pipe(z.union([z.literal(1), z.literal(2)])),
  memoire_auto: caseACocher,
  theme: z.enum(["sombre", "clair"]).default("sombre"),
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
export const schemaOngletSerie = z.enum(["episodes", "bible", "memoire", "publication"]).catch("episodes");
export const schemaEtape = z.enum(["scenario", "storyboard", "clips", "montage", "publication"]);
export const schemaOngletReglages = z.enum(["comptes", "cles", "budget", "preferences"]).catch("comptes");
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
