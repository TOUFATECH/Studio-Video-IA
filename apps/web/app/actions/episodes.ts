"use server";
// Actions d'un épisode : scénario, plans, storyboard, clips, montage, publication. Toute écriture vérifie
// d'abord l'appartenance (lib/appartenance) ; tâches et fichiers passent par le serveur (client serveur).
import {
  BORNES_DUREE,
  LANGUES,
  controleDuree,
  dureesParPlan,
  indexerFichiers,
  livrablePour,
  verifierDureePublication,
  normaliserHashtags,
  prochainCreneau,
  schemaReseau,
  type Episode,
  type Langue,
  type Plan,
} from "@studio-video-ia/core";
import { z } from "zod";
import { executer } from "@/lib/action";
import { COLONNES_RESEAU, episodeAMoi, planAMoi, publicationAMoi } from "@/lib/appartenance";
import { instantDepuisSaisie } from "@/lib/dates";
import { ErreurUtilisateur } from "@/lib/erreurs";
import { cheminsDuPlan, invaliderClips, invaliderPlans, supprimerRendus } from "@/lib/invalidation";
import { verifierCoutLancement } from "@/lib/cout";
import { ligne, ligneEspace, ligneFichier, lignePlan, lignePublication, ligneReseau, lignes } from "@/lib/lignes";
import { supprimerObjets } from "@/lib/medias";
import { chargerReglages } from "@/lib/reglages";
import {
  caseACocher,
  formulaire,
  id as schemaId,
  premiereErreur,
  schemaDemandeModification,
  schemaEpisodeFormulaire,
  schemaEcrireScenario,
  schemaEpisodeSeul,
  schemaLangues,
  schemaMiniature,
  schemaMontage,
  schemaPlanFormulaire,
  schemaPlans,
  schemaPlanSeul,
  schemaPrise,
  schemaPrises,
  schemaPublicationSeule,
  schemaPublier,
  schemaSousTitresFormulaire,
  schemaTitre,
  schemaValidation,
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

/** Plans d'un épisode (règles d’accès). */
async function plansDe(episodeId: string): Promise<Plan[]> {
  const { db } = await utilisateur();
  return lignes(lignePlan, (await db.from("plans").select("*").eq("episode_id", episodeId).order("position")).data, "plans");
}

/** Fichiers prêts d'un épisode (règles d’accès). */
async function fichiersDe(episodeId: string) {
  const { db } = await utilisateur();
  return lignes(ligneFichier, (await db.from("fichiers").select("*").eq("episode_id", episodeId)).data, "fichiers");
}

/**
 * Les publications programmées de ces langues attendront le nouveau rendu.
 * Cas particulier : une vidéo déjà envoyée sur YouTube (programmée chez YouTube) contient l'ANCIEN montage ;
 * l'app ne peut pas la supprimer (autorisation non demandée), donc la publication passe en échec avec la marche à suivre.
 */
async function remettreEnAttente(episodeId: string, langues?: readonly Langue[]): Promise<void> {
  const { db } = await utilisateur();
  let q = db.from("publications").update({ statut: "attend_rendu" }).eq("episode_id", episodeId).eq("statut", "programmee").is("id_externe", null);
  if (langues) q = q.in("langue", [...langues]);
  await q;
  let deja = db
    .from("publications")
    .update({ statut: "echec", id_externe: null, url: null, erreur: MESSAGE_YOUTUBE_PERIME })
    .eq("episode_id", episodeId)
    .eq("statut", "programmee")
    .not("id_externe", "is", null);
  if (langues) deja = deja.in("langue", [...langues]);
  await deja;
}

/** Message affiché quand une vidéo déjà programmée sur YouTube ne correspond plus au montage. */
const MESSAGE_YOUTUBE_PERIME =
  "Le montage a changé après l’envoi sur YouTube : supprime l’ancienne vidéo (ou passe-la en privé sans date) dans YouTube Studio, puis clique Réessayer pour envoyer le nouveau montage.";

/** Dans un clip, chaque plan couvre un passage précis de la chanson : on n'en ajoute ni n'en retire à la main. */
const MESSAGE_PLANS_CLIP = "Dans un clip, les plans suivent la chanson : change l’extrait ou le tempo puis « Redécouper » pour en avoir plus ou moins.";

/** Bornes de durée selon le genre et le format. */
function bornes(ep: Pick<Episode, "genre">, format: Episode["format"]) {
  return ep.genre !== "episode" ? BORNES_DUREE.generique : BORNES_DUREE[format];
}

// ---------------------------------------------------------------- Scénario

/** Enregistre titre, idée, format, durée cible, langue d'origine et enchaînement. */
export async function modifierEpisode(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaEpisodeFormulaire, fd);
    const { episode } = await episodeAMoi(d.id);
    if (episode.genre === "clip") throw new ErreurUtilisateur("Les réglages d’un clip se changent dans l’étape « Son et paroles ».");
    // Un générique reste court ; la durée est ramenée dans les bornes du format.
    const format = episode.genre === "episode" ? d.format : "court";
    const b = bornes(episode, format);
    const duree = format !== episode.format ? b.defaut : Math.min(b.max, Math.max(b.min, d.duree_cible));
    // La langue d'origine fait toujours partie des versions (contrainte de la base).
    const langues = [d.langue, ...episode.langues.filter((l) => l !== d.langue)];
    const { db } = await utilisateur();
    verifier(
      (await db.from("episodes").update({ titre: d.titre, idee: d.idee, format, duree_cible: duree, langue: d.langue, langues, enchainer: d.enchainer }).eq("id", episode.id)).error,
      "Enregistrement de l’épisode",
    );
    // Une nouvelle durée change la longueur de certains clips : seuls ces clips sont à refaire.
    const plans = await plansDe(episode.id);
    const avant = dureesParPlan(plans, episode.duree_cible, episode.format);
    const apres = dureesParPlan(plans, duree, format);
    const changes = plans.filter((p) => avant.get(p.id) !== apres.get(p.id)).map((p) => p.id);
    if (changes.length) {
      await invaliderClips(episode.id, changes, null);
      await db.from("plans").update({ modifie: true }).in("id", changes);
    }
    if (changes.length || d.langue !== episode.langue || d.enchainer !== episode.enchainer) {
      await supprimerRendus(episode.id);
      await remettreEnAttente(episode.id);
    }
    return { message: changes.length ? `Épisode enregistré. ${changes.length} clip${changes.length > 1 ? "s changent" : " change"} de durée : à regénérer.` : "Épisode enregistré." };
  });
}

/** « Écrire avec l'IA » : met en file l'écriture du scénario (bible, mémoire et épisode précédent pris en compte). */
export async function ecrireScenario(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaEcrireScenario, fd);
    const { episode, serie } = await episodeAMoi(d.episode_id);
    // L'IA choisie (ChatGPT ou Claude) est gardée sur l'épisode : elle sert aussi aux modifications demandées ensuite.
    if (d.fournisseur_texte !== episode.fournisseur_texte) {
      const { db } = await utilisateur();
      verifier((await db.from("episodes").update({ fournisseur_texte: d.fournisseur_texte }).eq("id", episode.id)).error, "Épisode");
    }
    await exigerMiseEnFile({ espace_id: serie.espace_id, episode_id: episode.id, type: "scenario", donnees: { mode: "ecrire" }, priorite: 1 });
    return { message: "Écriture en file. Les plans apparaîtront ici." };
  });
}

/** « Demander une modification » pour tout l'épisode ou certains plans. */
export async function demanderModification(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaDemandeModification, fd, ["plan_ids"]);
    const { episode, serie } = await episodeAMoi(d.episode_id);
    const plans = await plansDe(episode.id);
    if (!plans.length) throw new ErreurUtilisateur("Écris d’abord le scénario.");
    const ids = d.plan_ids.filter((x) => plans.some((p) => p.id === x));
    await exigerMiseEnFile({
      espace_id: serie.espace_id,
      episode_id: episode.id,
      type: "scenario",
      donnees: ids.length ? { mode: "modification", demande: d.demande, plan_ids: ids } : { mode: "modification", demande: d.demande },
      priorite: 1,
    });
    return { message: "Modification demandée. Seuls les plans touchés repasseront en génération." };
  });
}

/** Ajoute un plan à la fin (ou à la fin d'un chapitre). */
export async function ajouterPlan(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(z.object({ episode_id: schemaId, section: z.string().max(40).optional() }), fd);
    const { episode } = await episodeAMoi(d.episode_id);
    if (episode.genre === "clip") throw new ErreurUtilisateur(MESSAGE_PLANS_CLIP);
    const plans = await plansDe(episode.id);
    const { db } = await utilisateur();
    const position = Math.max(-1, ...plans.map((p) => p.position)) + 1;
    verifier((await db.from("plans").insert({ episode_id: episode.id, position, section: d.section || "principal", type: "action", texte: "Nouveau plan", modifie: true })).error, "Ajout du plan");
    await supprimerRendus(episode.id);
    await remettreEnAttente(episode.id);
    return { message: "Plan ajouté. Décris ce qu’on voit." };
  });
}

/**
 * Modifie un plan. Conséquences : `modifie = true`, `valide = false`, suppression de son image,
 * de ses clips, de ses voix et des rendus de l'épisode.
 */
export async function modifierPlan(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaPlanFormulaire, fd);
    const { plan, episode, serie } = await planAMoi(d.id);
    const { db } = await utilisateur();
    if (d.personnage_id) {
      // Le personnage doit appartenir à la même série.
      const { data } = await db.from("personnages").select("id").eq("id", d.personnage_id).eq("serie_id", serie.id).maybeSingle();
      if (!data) throw new ErreurUtilisateur("Personnage introuvable dans cette série.");
    }
    // Dans un clip, personne ne parle (seule la chanson s'entend) ; le personnage choisi est celui qu'on voit.
    const clip = episode.genre === "clip";
    if (clip && d.type === "dialogue") throw new ErreurUtilisateur("Pas de dialogue dans un clip : choisis un autre type de plan.");
    const dialogue = d.type === "dialogue";
    const replique = dialogue ? d.replique : "";
    const maj = {
      type: d.type,
      texte: d.texte,
      personnage_id: dialogue || clip ? d.personnage_id : null,
      replique,
      // Une réplique réécrite rend ses traductions caduques.
      repliques_traduites: replique === plan.replique ? plan.repliques_traduites : {},
      duree_fixee: d.duree,
      modifie: true,
      valide: false,
    };
    verifier((await db.from("plans").update(maj).eq("id", plan.id)).error, "Enregistrement du plan");
    await invaliderPlans(episode.id, [plan.id]);
    await remettreEnAttente(episode.id);
    return { message: "Plan enregistré. Son image, ses clips et ses voix seront regénérés." };
  });
}

/** Supprime un plan (et ses fichiers des médias). */
export async function supprimerPlan(fd: FormData): Promise<void> {
  await executer(async () => {
    const { plan_id } = valider(schemaPlanSeul, fd);
    const { plan, episode } = await planAMoi(plan_id);
    if (episode.genre === "clip") throw new ErreurUtilisateur(MESSAGE_PLANS_CLIP);
    const chemins = await cheminsDuPlan(plan.id);
    const { db } = await utilisateur();
    verifier((await db.from("plans").delete().eq("id", plan.id)).error, "Suppression du plan");
    await supprimerObjets(chemins);
    await supprimerRendus(episode.id);
    await remettreEnAttente(episode.id);
    return { message: "Plan supprimé." };
  });
}

// ---------------------------------------------------------------- Storyboard

/**
 * « Générer les images » (toutes celles qui manquent) ou « Refaire » une image précise.
 * Générer valide le scénario (sauf au-delà de 90 s pour un épisode vertical) ; refaire garde les anciennes versions.
 * Au-delà du plafond par épisode, la case « Je confirme la dépense » est exigée.
 */
export async function genererImages(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaPlans.extend({ confirmer: caseACocher }), fd, ["plan_ids"]);
    const { episode, serie } = await episodeAMoi(d.episode_id);
    const plans = await plansDe(episode.id);
    if (!plans.length) throw new ErreurUtilisateur("Écris d’abord le scénario.");
    const ids = d.plan_ids.filter((x) => plans.some((p) => p.id === x));
    const fichiers = await fichiersDe(episode.id);
    const avecImage = new Set(fichiers.filter((f) => f.genre === "image" && f.statut === "pret").map((f) => f.plan_id));
    const cibles = ids.length ? plans.filter((p) => ids.includes(p.id)) : plans.filter((p) => !avecImage.has(p.id));
    if (episode.genre === "episode" && episode.format === "court") {
      const total = [...dureesParPlan(plans, episode.duree_cible, episode.format).values()].reduce((a, b) => a + b, 0);
      const c = controleDuree(total);
      if (c.niveau === "bloque") throw new ErreurUtilisateur(c.message ?? "Épisode trop long.");
    }
    const cout = await verifierCoutLancement({ episode, plans: cibles, genre: "image", confirmer: d.confirmer });
    const { db } = await utilisateur();
    if (!episode.scenario_valide) await db.from("episodes").update({ scenario_valide: true }).eq("id", episode.id);
    if (ids.length) {
      // Refaire : l'ancienne image reste dans les versions ; ses clips seront périmés dès la nouvelle image.
      await db.from("plans").update({ valide: false }).in("id", ids);
      await supprimerRendus(episode.id);
      await remettreEnAttente(episode.id);
    }
    await exigerMiseEnFile({ espace_id: serie.espace_id, episode_id: episode.id, type: "storyboard", donnees: ids.length ? { plan_ids: ids } : {} });
    return { message: ids.length ? `Nouvelle image en file (environ ${cout}).` : `Génération des images en file (environ ${cout}).` };
  });
}

/** Valide ou invalide l'image d'un plan. */
export async function validerImage(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaValidation, fd);
    const { plan } = await planAMoi(d.plan_id);
    const { db } = await utilisateur();
    verifier((await db.from("plans").update({ valide: d.valide }).eq("id", plan.id)).error, "Validation");
  });
}

/** Valide toutes les images déjà générées. */
export async function toutValider(fd: FormData): Promise<void> {
  await executer(async () => {
    const { episode_id } = valider(schemaEpisodeSeul, fd);
    const { episode } = await episodeAMoi(episode_id);
    const prets = new Set((await fichiersDe(episode.id)).filter((f) => f.genre === "image" && f.statut === "pret" && f.plan_id).map((f) => f.plan_id ?? ""));
    if (!prets.size) throw new ErreurUtilisateur("Aucune image à valider.");
    const { db } = await utilisateur();
    verifier((await db.from("plans").update({ valide: true }).eq("episode_id", episode.id).in("id", [...prets])).error, "Validation");
    return { message: `${prets.size} image${prets.size > 1 ? "s validées" : " validée"}.` };
  });
}

/** « Valider et lancer les clips » : possible seulement quand chaque plan a une image validée. */
export async function lancerClips(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaPlans.extend({ confirmer: caseACocher }), fd, ["plan_ids"]);
    const { episode, serie } = await episodeAMoi(d.episode_id);
    const plans = await plansDe(episode.id);
    const fichiers = await fichiersDe(episode.id);
    const images = new Set(fichiers.filter((f) => f.genre === "image" && f.statut === "pret").map((f) => f.plan_id));
    if (!plans.length || plans.some((p) => !p.valide || !images.has(p.id))) throw new ErreurUtilisateur("Valide d’abord toutes les images du storyboard.");
    const ids = d.plan_ids.filter((x) => plans.some((p) => p.id === x));
    // Coût : les plans demandés, sinon ceux dont le clip manque ou est périmé.
    const index = indexerFichiers(fichiers);
    const cibles = ids.length ? plans.filter((p) => ids.includes(p.id)) : plans.filter((p) => index.get(`${p.id}:clip:A`)?.statut !== "pret");
    const cout = await verifierCoutLancement({ episode, plans: cibles, genre: "clip", confirmer: d.confirmer });
    await exigerMiseEnFile({ espace_id: serie.espace_id, episode_id: episode.id, type: "clips", donnees: ids.length ? { plan_ids: ids } : {} });
    return { message: ids.length ? `Nouvel essai en file (environ ${cout}).` : `Clips en file (environ ${cout}).` };
  });
}

// ---------------------------------------------------------------- Clips et voix

/** Une ou deux prises par plan. Revenir à une prise remet la prise A partout. */
export async function choisirPrises(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaPrises, fd);
    const { episode } = await episodeAMoi(d.episode_id);
    const { db } = await utilisateur();
    verifier((await db.from("episodes").update({ prises: d.prises }).eq("id", episode.id)).error, "Prises");
    if (d.prises === 1) {
      const plans = await plansDe(episode.id);
      if (plans.some((p) => p.prise_choisie === "B")) {
        await db.from("plans").update({ prise_choisie: "A" }).eq("episode_id", episode.id);
        await supprimerRendus(episode.id);
        await remettreEnAttente(episode.id);
      }
    }
    return { message: d.prises === 2 ? "Deux prises par plan : relance les clips pour générer les prises B." : "Une prise par plan." };
  });
}

/** Choisit la prise utilisée au montage pour un plan. */
export async function choisirPrise(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaPrise, fd);
    const { plan, episode } = await planAMoi(d.plan_id);
    if (plan.prise_choisie === d.prise) return;
    const { db } = await utilisateur();
    verifier((await db.from("plans").update({ prise_choisie: d.prise }).eq("id", plan.id)).error, "Choix de la prise");
    await supprimerRendus(episode.id);
    await remettreEnAttente(episode.id);
    return { message: `Prise ${d.prise} retenue.` };
  });
}

/** Pause : annule les tâches de l'épisode encore en file (celle en cours se termine). */
export async function mettreEnPause(fd: FormData): Promise<void> {
  await executer(async () => {
    const { episode_id } = valider(schemaEpisodeSeul, fd);
    const { episode } = await episodeAMoi(episode_id);
    const { data } = await (await clientAdmin()).from("taches").update({ statut: "annulee", modifie_le: new Date().toISOString() }).eq("episode_id", episode.id).eq("statut", "en_file").select("id");
    const n = data?.length ?? 0;
    return { message: n ? "Tâches en file annulées. Relance quand tu veux." : "Rien en file : la génération en cours va se terminer.", ton: n ? "succes" : "info" };
  });
}

// ---------------------------------------------------------------- Montage

/** Langues de l'épisode (la langue d'origine reste). Les rendus des langues retirées sont supprimés. */
export async function modifierLangues(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaLangues, fd, ["langues"]);
    const { episode } = await episodeAMoi(d.episode_id);
    const { preferences } = await chargerReglages();
    const voulues = new Set<Langue>([episode.langue, ...d.langues]);
    const langues = LANGUES.filter((l) => voulues.has(l));
    const retirees = episode.langues.filter((l) => !voulues.has(l));
    const sousTitres: Partial<Record<Langue, string>> = {};
    for (const l of langues) sousTitres[l] = episode.sous_titres[l] ?? preferences.sous_titres;
    const { db } = await utilisateur();
    verifier((await db.from("episodes").update({ langues, sous_titres: sousTitres }).eq("id", episode.id)).error, "Langues");
    await supprimerRendus(episode.id, retirees);
    return { message: "Langues enregistrées. Les voix des nouvelles langues seront générées au prochain lancement des clips." };
  });
}

/** Sous-titres choisis pour chaque version. Les rendus des versions changées sont supprimés. */
export async function modifierSousTitres(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaSousTitresFormulaire, fd);
    const { episode } = await episodeAMoi(d.episode_id);
    const choix = { ...episode.sous_titres };
    const changees: Langue[] = [];
    for (const l of episode.langues) {
      const v = d.choix[l];
      if (v && v !== (episode.sous_titres[l] ?? "aucun")) changees.push(l);
      if (v) choix[l] = v;
    }
    if (!changees.length) return { message: "Rien n’a changé.", ton: "info" };
    const { db } = await utilisateur();
    verifier((await db.from("episodes").update({ sous_titres: choix }).eq("id", episode.id)).error, "Sous-titres");
    await supprimerRendus(episode.id, changees);
    await remettreEnAttente(episode.id, changees);
    return { message: `Sous-titres enregistrés. Rendu à relancer pour : ${changees.map((l) => l.toUpperCase()).join(", ")}.` };
  });
}

/** Musique de fond et bruitages. */
export async function modifierMontage(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaMontage, fd);
    const { episode } = await episodeAMoi(d.episode_id);
    if (d.musique === episode.musique && d.bruitages === episode.bruitages) return { message: "Rien n’a changé.", ton: "info" };
    const { db } = await utilisateur();
    verifier((await db.from("episodes").update({ musique: d.musique, bruitages: d.bruitages }).eq("id", episode.id)).error, "Montage");
    await supprimerRendus(episode.id);
    await remettreEnAttente(episode.id);
    return { message: "Montage enregistré. Relance le rendu." };
  });
}

/** Choisit le titre d'une langue parmi les trois propositions. */
export async function choisirTitre(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaTitre, fd);
    const { episode } = await episodeAMoi(d.episode_id);
    const { db } = await utilisateur();
    verifier((await db.from("episodes").update({ choix_titres: { ...episode.choix_titres, [d.langue]: d.choix } }).eq("id", episode.id)).error, "Titre");
  });
}

/** Choisit la miniature YouTube parmi celles générées. */
export async function choisirMiniature(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaMiniature, fd);
    const { episode } = await episodeAMoi(d.episode_id);
    if (!episode.miniature || d.choix >= episode.miniature.chemins.length) throw new ErreurUtilisateur("Miniature introuvable.");
    const { db } = await utilisateur();
    verifier((await db.from("episodes").update({ miniature: { ...episode.miniature, choix: d.choix } }).eq("id", episode.id)).error, "Miniature");
  });
}

/** « Lancer le rendu » : possible quand tous les clips et voix sont prêts. */
export async function lancerRendu(fd: FormData): Promise<void> {
  await executer(async () => {
    const { episode_id } = valider(schemaEpisodeSeul, fd);
    const { episode, serie } = await episodeAMoi(episode_id);
    const plans = await plansDe(episode.id);
    const clips = new Set((await fichiersDe(episode.id)).filter((f) => f.genre === "clip" && f.statut === "pret").map((f) => `${f.plan_id}:${f.prise}`));
    if (!plans.length || plans.some((p) => !clips.has(`${p.id}:${p.prise_choisie}`))) throw new ErreurUtilisateur("Il manque des clips : termine l’étape Clips et voix.");
    await exigerMiseEnFile({ espace_id: serie.espace_id, episode_id: episode.id, type: "rendu" });
    return { message: "Rendu en file." };
  });
}

// ---------------------------------------------------------------- Publication

/**
 * Crée les publications d'une version sur les comptes cochés : « maintenant », au prochain créneau du rythme,
 * ou à une date précise lue dans le fuseau de l'espace. Sans rendu de la langue, la publication attend le rendu.
 */
export async function publier(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaPublier, fd, ["comptes"]);
    const { episode, serie } = await episodeAMoi(d.episode_id);
    if (!episode.langues.includes(d.langue)) throw new ErreurUtilisateur("Cette langue n’est pas une version de l’épisode.");
    const { db } = await utilisateur();
    const espace = ligne(ligneEspace, (await db.from("espaces").select("*").eq("id", serie.espace_id).maybeSingle()).data);
    if (!espace) throw new ErreurUtilisateur("Compte introuvable.");
    // Seuls les comptes connectés de l'espace de la série sont acceptés.
    const comptes = lignes(ligneReseau, (await db.from("reseaux_connectes").select(COLONNES_RESEAU).eq("espace_id", espace.id).in("id", d.comptes)).data, "reseaux");
    if (comptes.length !== d.comptes.length) throw new ErreurUtilisateur("Un des comptes cochés n’appartient pas à ce compte.");
    const horsLigne = comptes.filter((c) => c.statut !== "connecte");
    if (horsLigne.length) throw new ErreurUtilisateur(`Reconnecte d’abord ${horsLigne.map((c) => c.nom_compte).join(", ")} dans Réglages.`);

    const maintenant = new Date();
    let instant: Date;
    if (d.quand === "maintenant") instant = maintenant;
    else if (d.quand === "date") {
      try {
        instant = instantDepuisSaisie(d.date ?? "", espace.fuseau);
      } catch (e) {
        throw new ErreurUtilisateur(e instanceof Error ? e.message : "Date invalide.");
      }
      if (instant.getTime() < maintenant.getTime() - 5 * 60_000) throw new ErreurUtilisateur("Cette date est déjà passée.");
    } else {
      const { data } = await db.from("episodes").select("id").eq("serie_id", serie.id);
      const ids = z.array(z.object({ id: z.string() })).catch([]).parse(data).map((x) => x.id);
      const pubs = lignes(lignePublication, (await db.from("publications").select("*").in("episode_id", ids).in("statut", ["programmee", "attend_rendu"])).data, "publications");
      const futures = pubs.map((p) => Date.parse(p.programmee_le)).filter((t) => t > maintenant.getTime());
      instant = prochainCreneau(serie.rythme, futures.length ? new Date(Math.max(...futures)) : null, maintenant, espace.fuseau);
    }

    const fichiers = (await fichiersDe(episode.id)).filter((f) => f.statut === "pret");
    // Durée maximale par réseau : durée réelle du rendu, sinon la durée cible (le worker revérifie avant l'envoi).
    const tropLongs = comptes
      .map((c) => {
        const livrable = livrablePour(episode, c.reseau);
        const f = livrable === "bande_annonce" ? fichiers.find((x) => x.genre === "bande_annonce") : fichiers.find((x) => x.genre === "rendu" && x.langue === d.langue);
        const duree = f?.duree_s !== null && f?.duree_s !== undefined ? Number(f.duree_s) : livrable === "bande_annonce" ? 60 : episode.duree_cible;
        const message = verifierDureePublication({ reseau: c.reseau, livrable, format: episode.format, duree, genre: episode.genre });
        return message ? `${c.nom_compte} : ${message}` : null;
      })
      .filter((x): x is string => x !== null);
    if (tropLongs.length) throw new ErreurUtilisateur(tropLongs.join(" "));
    const lignesPub = comptes.map((c) => {
      const livrable = livrablePour(episode, c.reseau);
      // La bande annonce est un fichier à part ; le court et le film sont le rendu de la langue.
      const pret = livrable === "bande_annonce" ? fichiers.some((f) => f.genre === "bande_annonce") : fichiers.some((f) => f.genre === "rendu" && f.langue === d.langue);
      return { episode_id: episode.id, reseau_connecte_id: c.id, langue: d.langue, livrable, programmee_le: instant.toISOString(), statut: pret ? "programmee" : "attend_rendu" };
    });
    verifier((await db.from("publications").insert(lignesPub)).error, "Création des publications");
    const attente = lignesPub.filter((l) => l.statut === "attend_rendu").length;
    return { message: `${lignesPub.length} publication${lignesPub.length > 1 ? "s créées" : " créée"}${attente ? `, dont ${attente} en attente du rendu` : ""}.` };
  });
}

/** Annule une publication qui n'est pas encore partie. */
export async function annulerPublication(fd: FormData): Promise<void> {
  await executer(async () => {
    const { publication_id } = valider(schemaPublicationSeule, fd);
    const { publication } = await publicationAMoi(publication_id);
    if (!["attend_rendu", "programmee", "echec"].includes(publication.statut)) throw new ErreurUtilisateur("Cette publication est déjà partie : supprime-la directement sur le réseau.");
    // Une vidéo déjà programmée chez YouTube sortirait quand même à l'heure : l'annulation doit se faire dans YouTube Studio.
    if (publication.id_externe && publication.statut === "programmee") throw new ErreurUtilisateur("Cette vidéo est déjà envoyée et programmée sur YouTube : supprime-la ou passe-la en privé sans date dans YouTube Studio.");
    const { db } = await utilisateur();
    verifier((await db.from("publications").update({ statut: "annulee" }).eq("id", publication.id)).error, "Annulation");
    await (await clientAdmin()).from("taches").update({ statut: "annulee" }).eq("publication_id", publication.id).eq("statut", "en_file");
    return { message: "Publication annulée." };
  });
}

/** Relance une publication en échec, tout de suite. */
export async function reessayerPublication(fd: FormData): Promise<void> {
  await executer(async () => {
    const { publication_id } = valider(schemaPublicationSeule, fd);
    const { publication, episode } = await publicationAMoi(publication_id);
    if (publication.statut !== "echec") throw new ErreurUtilisateur("Seule une publication en échec peut être relancée.");
    const fichiers = (await fichiersDe(episode.id)).filter((f) => f.statut === "pret");
    const pret = publication.livrable === "bande_annonce" ? fichiers.some((f) => f.genre === "bande_annonce") : fichiers.some((f) => f.genre === "rendu" && f.langue === publication.langue);
    const { db } = await utilisateur();
    verifier(
      // id_externe vidé : un nouvel essai renvoie la vidéo au lieu de croire l'ancien envoi valable.
      (await db.from("publications").update({ statut: pret ? "programmee" : "attend_rendu", programmee_le: new Date().toISOString(), erreur: null, progression: 0, id_externe: null, url: null }).eq("id", publication.id)).error,
      "Nouvel essai",
    );
    return { message: "Publication relancée." };
  });
}

/** Hashtags propres à l'épisode pour un réseau (vide : on reprend ceux de la série). */
export async function enregistrerHashtagsEpisode(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(z.object({ episode_id: schemaId, reseau: schemaReseau, hashtags: z.string().max(3000).default("") }), fd);
    const { episode } = await episodeAMoi(d.episode_id);
    const hashtags = { ...episode.hashtags };
    const propre = normaliserHashtags(d.hashtags, d.reseau);
    if (propre) hashtags[d.reseau] = propre;
    else delete hashtags[d.reseau];
    const { db } = await utilisateur();
    verifier((await db.from("episodes").update({ hashtags }).eq("id", episode.id)).error, "Hashtags");
    return { message: propre ? "Hashtags de l’épisode enregistrés." : "Hashtags de la série rétablis." };
  });
}
