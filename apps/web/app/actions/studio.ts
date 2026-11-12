"use server";
// Actions du cahier des charges « Studio Séries IA » : arc de saison, story, scènes, storyboard détaillé, versions,
// retouches, commentaires, refaire une scène ou un épisode, validations et coût estimé avant lancement.
// Toute écriture vérifie d'abord l'appartenance (lib/appartenance) ; tâches et fichiers passent par le serveur.
import { randomUUID } from "node:crypto";
import { controleDuree, dureesParPlan, indexerFichiers, type Plan } from "@studio-video-ia/core";
import { z } from "zod";
import { executer } from "@/lib/action";
import { episodeAMoi, planAMoi, saisonAMoi } from "@/lib/appartenance";
import { ErreurUtilisateur } from "@/lib/erreurs";
import { plansEtPersonnages, verifierCoutLancement } from "@/lib/cout";
import { invaliderClips, supprimerRendus } from "@/lib/invalidation";
import { ligne, ligneElement, ligneFichier, lignePersonnage, lignePlan, ligneScene, lignes } from "@/lib/lignes";
import {
  formulaire,
  premiereErreur,
  schemaArc,
  schemaCommentaire,
  schemaCommentaireSeul,
  schemaMarqueMontage,
  schemaPlanDetaille,
  schemaRefaire,
  schemaRefaireLot,
  schemaRetouche,
  schemaSaisonFormulaire,
  schemaScene,
  schemaSceneSeule,
  schemaStory,
  schemaValidationEtape,
  schemaVersion,
  id as schemaId,
} from "@/lib/schemas";
import { utilisateur } from "@/lib/session";
import { clientAdmin } from "@/lib/bdd";
import { exigerMiseEnFile } from "@/lib/taches";

/** Valide un formulaire ou lève une erreur affichable. */
function valider<S extends z.ZodTypeAny>(schema: S, fd: FormData, multiples: readonly string[] = []): z.infer<S> {
  const r = schema.safeParse(formulaire(fd, multiples));
  if (!r.success) throw new ErreurUtilisateur(premiereErreur(r.error));
  return r.data;
}

/** Lève une erreur si une écriture en base a échoué. */
function verifier(erreur: { message: string } | null, quoi: string): void {
  if (erreur) throw new Error(`${quoi} : ${erreur.message}`);
}

// ---------------------------------------------------------------- Saison et arc

/** « Écrire l'arc avec l'IA » : découpage de la saison en N épisodes (titre, résumé, accroche). */
export async function ecrireArc(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaArc, fd);
    const { saison, serie } = await saisonAMoi(d.saison_id);
    const { db } = await utilisateur();
    verifier((await db.from("saisons").update({ nombre_episodes: d.nombre, ...(d.idee ? { arc: d.idee } : {}) }).eq("id", saison.id)).error, "Saison");
    await exigerMiseEnFile({ espace_id: serie.espace_id, type: "scenario", donnees: { mode: "arc", saison_id: saison.id, idee: d.idee, nombre: d.nombre }, priorite: 1 });
    return { message: `Arc en file : ${d.nombre} épisodes vont être proposés. Les épisodes déjà écrits ne bougent pas.` };
  });
}

/** Titre, arc et nombre d'épisodes d'une saison, saisis à la main. */
export async function modifierSaison(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaSaisonFormulaire, fd);
    const { saison } = await saisonAMoi(d.saison_id);
    const { db } = await utilisateur();
    verifier((await db.from("saisons").update({ titre: d.titre, arc: d.arc, nombre_episodes: d.nombre_episodes }).eq("id", saison.id)).error, "Saison");
    return { message: "Saison enregistrée." };
  });
}

// ---------------------------------------------------------------- Story et validations

/** Story de l'épisode : accroche, déroulé, fin vers la suite, rappel de l'épisode précédent. */
export async function modifierStory(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaStory, fd);
    const { episode } = await episodeAMoi(d.episode_id);
    const { db } = await utilisateur();
    verifier((await db.from("episodes").update({ accroche: d.accroche, deroule: d.deroule, fin_suite: d.fin_suite, rappel: d.rappel }).eq("id", episode.id)).error, "Story");
    if (d.rappel !== episode.rappel) await supprimerRendus(episode.id);
    return { message: "Story enregistrée." };
  });
}

/** Valide (ou remet en brouillon) le scénario : bloqué au-delà de 90 s pour un épisode vertical. */
export async function validerScenario(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaValidationEtape, fd);
    const { episode } = await episodeAMoi(d.episode_id);
    const { plans } = await plansEtPersonnages(episode);
    if (d.valide) {
      if (!plans.length) throw new ErreurUtilisateur("Écris d’abord le scénario.");
      if (episode.format === "court" && episode.genre === "episode") {
        const total = [...dureesParPlan(plans, episode.duree_cible, episode.format).values()].reduce((a, b) => a + b, 0);
        const c = controleDuree(total);
        if (c.niveau === "bloque") throw new ErreurUtilisateur(c.message ?? "Épisode trop long.");
      }
    }
    const { db } = await utilisateur();
    verifier((await db.from("episodes").update({ scenario_valide: d.valide }).eq("id", episode.id)).error, "Validation du scénario");
    return { message: d.valide ? "Scénario validé : tu peux générer les images." : "Scénario repassé en brouillon." };
  });
}

/** Valide la vidéo finale : rien n'est publié sans cet accord, sauf publication automatique de la série. */
export async function validerVideo(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaValidationEtape, fd);
    const { episode } = await episodeAMoi(d.episode_id);
    const { db } = await utilisateur();
    if (d.valide) {
      const { data } = await db.from("fichiers").select("id").eq("episode_id", episode.id).eq("genre", "rendu").eq("statut", "pret").limit(1);
      if (!data?.length) throw new ErreurUtilisateur("Lance d’abord le rendu : il n’y a pas encore de vidéo à valider.");
    }
    verifier((await db.from("episodes").update({ video_validee: d.valide }).eq("id", episode.id)).error, "Validation de la vidéo");
    return { message: d.valide ? "Vidéo validée." : "Validation retirée." };
  });
}

/** Logo en incrustation et carte de fin. */
export async function modifierMarqueMontage(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaMarqueMontage, fd);
    const { episode } = await episodeAMoi(d.episode_id);
    if (d.logo === episode.logo && d.carte_fin === episode.carte_fin) return { message: "Rien n’a changé.", ton: "info" };
    const { db } = await utilisateur();
    verifier((await db.from("episodes").update({ logo: d.logo, carte_fin: d.carte_fin }).eq("id", episode.id)).error, "Marque");
    await supprimerRendus(episode.id);
    return { message: "Enregistré. Relance le rendu." };
  });
}

// ---------------------------------------------------------------- Scènes

/** Ajoute une scène à la fin de l'épisode. */
export async function ajouterScene(fd: FormData): Promise<void> {
  await executer(async () => {
    const { episode_id } = valider(z.object({ episode_id: schemaId }), fd);
    const { episode } = await episodeAMoi(episode_id);
    const { db } = await utilisateur();
    const scenes = lignes(ligneScene, (await db.from("scenes").select("*").eq("episode_id", episode.id)).data, "scenes");
    const position = Math.max(-1, ...scenes.map((s) => s.position)) + 1;
    verifier((await db.from("scenes").insert({ episode_id: episode.id, position, titre: `Scène ${position + 1}` })).error, "Ajout de la scène");
    return { message: "Scène ajoutée." };
  });
}

/** Modifie une scène (lieu, moment, résumé, personnages présents). */
export async function modifierScene(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaScene, fd, ["personnages"]);
    const { db } = await utilisateur();
    const scene = ligne(ligneScene, (await db.from("scenes").select("*").eq("id", d.id).maybeSingle()).data);
    if (!scene) throw new ErreurUtilisateur("Scène introuvable.");
    await episodeAMoi(scene.episode_id);
    verifier((await db.from("scenes").update({ titre: d.titre, lieu_id: d.lieu_id, moment: d.moment, resume: d.resume, personnages: d.personnages }).eq("id", scene.id)).error, "Scène");
    return { message: "Scène enregistrée." };
  });
}

/** Supprime une scène (ses plans restent, sans scène). */
export async function supprimerScene(fd: FormData): Promise<void> {
  await executer(async () => {
    const { scene_id } = valider(schemaSceneSeule, fd);
    const { db } = await utilisateur();
    const scene = ligne(ligneScene, (await db.from("scenes").select("*").eq("id", scene_id).maybeSingle()).data);
    if (!scene) throw new ErreurUtilisateur("Scène introuvable.");
    await episodeAMoi(scene.episode_id);
    verifier((await db.from("scenes").delete().eq("id", scene.id)).error, "Suppression de la scène");
    return { message: "Scène supprimée. Ses plans sont gardés." };
  });
}

// ---------------------------------------------------------------- Storyboard détaillé

/**
 * Champs détaillés d'un plan. Ce qui change l'image (décor, personnages, cadrage…) la remet à valider ;
 * ce qui ne touche que le montage (effet, transition, texte à l'écran) efface seulement les rendus.
 */
export async function modifierPlanDetaille(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaPlanDetaille, fd, ["personnages", "variantes"]);
    const { plan, episode, serie } = await planAMoi(d.id);
    const { db } = await utilisateur();
    // Scène, décor, activité, personnages et variantes doivent venir de la même série / du même compte.
    if (d.scene_id) {
      const sc = ligne(ligneScene, (await db.from("scenes").select("*").eq("id", d.scene_id).maybeSingle()).data);
      if (!sc || sc.episode_id !== episode.id) throw new ErreurUtilisateur("Scène introuvable dans cet épisode.");
    }
    const ids = [d.decor_id, d.activite_id, ...d.variantes].filter((x): x is string => !!x);
    if (ids.length) {
      const els = lignes(ligneElement, (await db.from("elements").select("*").in("id", ids)).data, "elements");
      if (els.length !== new Set(ids).size || els.some((e) => e.espace_id !== serie.espace_id || (e.serie_id !== null && e.serie_id !== serie.id))) {
        throw new ErreurUtilisateur("Élément de bibliothèque introuvable pour cette série.");
      }
    }
    if (d.personnages.length) {
      const persos = lignes(lignePersonnage, (await db.from("personnages").select("*").eq("serie_id", serie.id).in("id", d.personnages)).data, "personnages");
      if (persos.length !== new Set(d.personnages).size) throw new ErreurUtilisateur("Personnage introuvable dans cette série.");
    }
    const visuel =
      d.decor_id !== plan.decor_id ||
      d.activite_id !== plan.activite_id ||
      d.cadrage !== plan.cadrage ||
      d.mouvement !== plan.mouvement ||
      JSON.stringify([...d.personnages].sort()) !== JSON.stringify([...plan.personnages].sort()) ||
      JSON.stringify([...d.variantes].sort()) !== JSON.stringify([...plan.variantes].sort());
    verifier(
      (
        await db
          .from("plans")
          .update({
            scene_id: d.scene_id,
            duree: d.duree,
            decor_id: d.decor_id,
            activite_id: d.activite_id,
            personnages: d.personnages,
            variantes: d.variantes,
            cadrage: d.cadrage,
            mouvement: d.mouvement,
            transition: d.transition,
            effet: d.effet,
            texte_ecran: d.texte_ecran,
            son: d.son,
            ...(visuel ? { modifie: true, valide: false } : {}),
          })
          .eq("id", plan.id)
      ).error,
      "Plan",
    );
    // Un plan rallongé au-delà de son clip doit être réanimé ; les versions d'images sont gardées.
    const clips = lignes(ligneFichier, (await db.from("fichiers").select("*").eq("plan_id", plan.id).eq("genre", "clip").eq("statut", "pret")).data, "fichiers");
    const genere = Math.max(0, ...clips.map((c) => c.duree_s ?? 0));
    if (d.duree !== null && clips.length && d.duree > genere + 0.05) await invaliderClips(episode.id, [plan.id], null);
    await supprimerRendus(episode.id);
    return { message: visuel ? "Plan enregistré. Son image est à refaire ou à revalider." : "Plan enregistré." };
  });
}

// ---------------------------------------------------------------- Commentaires

/** Commentaire sur un plan (« trop sombre ») : repris à la prochaine génération de son image. */
export async function commenterPlan(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaCommentaire, fd);
    const { plan } = await planAMoi(d.plan_id);
    const { db } = await utilisateur();
    const commentaires = [...plan.commentaires, { id: randomUUID().slice(0, 8), texte: d.texte, le: new Date().toISOString(), pris: false }].slice(-30);
    verifier((await db.from("plans").update({ commentaires }).eq("id", plan.id)).error, "Commentaire");
    return { message: "Commentaire ajouté : il sera pris en compte à la prochaine image." };
  });
}

/** Retire un commentaire. */
export async function retirerCommentaire(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaCommentaireSeul, fd);
    const { plan } = await planAMoi(d.plan_id);
    const { db } = await utilisateur();
    verifier((await db.from("plans").update({ commentaires: plan.commentaires.filter((c) => c.id !== d.commentaire_id) }).eq("id", plan.id)).error, "Commentaire");
  });
}

// ---------------------------------------------------------------- Refaire, retoucher, versions

/** « Refaire » l'image d'un plan, avec la même consigne ou une consigne corrigée, en 1 à 4 propositions. Les versions sont gardées. */
export async function refaireImage(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaRefaire, fd);
    const { plan, episode, serie } = await planAMoi(d.plan_id);
    const cout = await verifierCoutLancement({ episode, plans: [plan], genre: "image", propositions: d.propositions, confirmer: d.confirmer });
    const { db } = await utilisateur();
    await db.from("plans").update({ valide: false }).eq("id", plan.id);
    await exigerMiseEnFile({
      espace_id: serie.espace_id,
      episode_id: episode.id,
      type: "storyboard",
      donnees: { plan_ids: [plan.id], ...(d.consigne ? { consigne: d.consigne } : {}), ...(d.propositions ? { propositions: d.propositions } : {}) },
    });
    return { message: `Nouvelle image en file (environ ${cout}). L’ancienne reste dans les versions.` };
  });
}

/** « Retoucher » : une seule modification sur l'image actuelle (décor, vêtement, geste) au lieu de tout refaire. */
export async function retoucherImage(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaRetouche, fd);
    const { plan, episode, serie } = await planAMoi(d.plan_id);
    const cout = await verifierCoutLancement({ episode, plans: [plan], genre: "image", propositions: 1, confirmer: d.confirmer });
    const { db } = await utilisateur();
    await db.from("plans").update({ valide: false }).eq("id", plan.id);
    await exigerMiseEnFile({ espace_id: serie.espace_id, episode_id: episode.id, type: "storyboard", donnees: { plan_ids: [plan.id], retouche: { consigne: d.consigne } } });
    return { message: `Retouche en file (environ ${cout}).` };
  });
}

/**
 * Revient à une version précédente d'une image ou d'un clip (ou choisit une proposition) :
 * elle devient la version retenue ; les rendus sont à refaire.
 */
export async function choisirVersion(fd: FormData): Promise<void> {
  await executer(async () => {
    const { fichier_id } = valider(schemaVersion, fd);
    const { db } = await utilisateur();
    // Lecture avec les règles d'accès : le fichier doit être à l'utilisateur.
    const f = ligne(ligneFichier, (await db.from("fichiers").select("*").eq("id", fichier_id).maybeSingle()).data);
    if (!f || !f.plan_id || !f.episode_id || !["image", "clip"].includes(f.genre) || f.statut !== "pret") throw new ErreurUtilisateur("Version introuvable.");
    const { plan, episode } = await planAMoi(f.plan_id);
    verifier((await (await clientAdmin()).from("fichiers").update({ actif_le: new Date().toISOString() }).eq("id", f.id)).error, "Choix de la version");
    // Choisir une image, c'est la valider ; ses clips plus anciens sont périmés et seront refaits.
    if (f.genre === "image") await db.from("plans").update({ valide: true }).eq("id", plan.id);
    if (f.genre === "clip" && f.prise && f.prise !== plan.prise_choisie) await db.from("plans").update({ prise_choisie: f.prise }).eq("id", plan.id);
    await supprimerRendus(episode.id);
    return { message: f.genre === "image" ? "Version retenue et validée. Relance les clips de ce plan." : "Version du clip retenue. Relance le rendu." };
  });
}

/**
 * Refaire une scène ou l'épisode entier, en un clic : seulement les plans en erreur, ou tous ; images ou clips.
 * Les versions précédentes sont gardées.
 */
export async function refaireLot(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaRefaireLot, fd);
    const { episode, serie } = await episodeAMoi(d.episode_id);
    const { db } = await utilisateur();
    const { plans } = await plansEtPersonnages(episode);
    const fichiers = lignes(ligneFichier, (await db.from("fichiers").select("*").eq("episode_id", episode.id)).data, "fichiers");
    const index = indexerFichiers(fichiers);
    const genre = d.etape === "images" ? "image" : "clip";
    const portee = plans.filter((p) => !d.scene_id || p.scene_id === d.scene_id);
    const enErreur = (p: Plan): boolean => {
      const f = genre === "image" ? index.get(`${p.id}:image`) : index.get(`${p.id}:clip:${p.prise_choisie}`);
      return !f || f.statut === "echec" || (genre === "image" && f.controle?.statut === "douteux");
    };
    const cibles = d.portee === "erreurs" ? portee.filter(enErreur) : portee;
    if (!cibles.length) return { message: d.portee === "erreurs" ? "Aucun plan en erreur ici." : "Aucun plan à refaire.", ton: "info" };
    if (genre === "clip" && cibles.some((p) => !p.valide)) throw new ErreurUtilisateur("Valide d’abord les images de ces plans.");
    const cout = await verifierCoutLancement({ episode, plans: cibles, genre, confirmer: d.confirmer });
    if (genre === "image") await db.from("plans").update({ valide: false }).in("id", cibles.map((p) => p.id));
    await exigerMiseEnFile({ espace_id: serie.espace_id, episode_id: episode.id, type: genre === "image" ? "storyboard" : "clips", donnees: { plan_ids: cibles.map((p) => p.id) } });
    return { message: `${cibles.length} plan${cibles.length > 1 ? "s" : ""} à refaire en file (environ ${cout}).` };
  });
}
