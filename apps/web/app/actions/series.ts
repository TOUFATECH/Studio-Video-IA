"use server";
// Actions des séries : création, saisons, épisodes, suite, bible, personnages, mémoire, rythme, hashtags, programmation.
import { BORNES_DUREE, MAX_HASHTAGS, RESEAUX, normaliserHashtags, type Episode, type Langue, type Serie } from "@studio-video-ia/core";
import { redirect } from "next/navigation";
import { executer } from "@/lib/action";
import { espaceAMoi, personnageAMoi, saisonAMoi, serieAMoi } from "@/lib/appartenance";
import { ordreLecture } from "@/lib/episodes";
import { ErreurUtilisateur } from "@/lib/erreurs";
import { ligne, ligneEpisode, ligneMemoire, lignePlan, ligneSaison, lignes } from "@/lib/lignes";
import { lignesPublications, planProgrammation } from "@/lib/programmation-serie";
import { chargerReglages } from "@/lib/reglages";
import {
  formulaire,
  id as schemaId,
  premiereErreur,
  schemaBible,
  schemaFait,
  schemaIdSeul,
  schemaNouvelleSerie,
  schemaPersonnage,
  schemaRythmeFormulaire,
  schemaSaisonSeule,
  schemaSerieSeule,
} from "@/lib/schemas";
import { utilisateur } from "@/lib/session";
import { exigerMiseEnFile } from "@/lib/taches";
import { z } from "zod";

/** Valide un formulaire ou lève une erreur affichable. */
function valider<S extends z.ZodTypeAny>(schema: S, fd: FormData, multiples: readonly string[] = []): z.infer<S> {
  const r = schema.safeParse(formulaire(fd, multiples));
  if (!r.success) throw new ErreurUtilisateur(premiereErreur(r.error));
  return r.data;
}

/** Lève une erreur affichable si une écriture Supabase a échoué. */
function verifier(erreur: { message: string } | null, quoi: string): void {
  if (erreur) throw new Error(`${quoi} : ${erreur.message}`);
}

/** Sous-titres par défaut d'un nouvel épisode, selon la préférence de l'utilisateur. */
async function sousTitresParDefaut(langue: Langue): Promise<Record<string, string>> {
  const { preferences } = await chargerReglages();
  return { [langue]: preferences.sous_titres };
}

/** Crée une saison avec son opening, son ending et un premier épisode. Renvoie l'id de l'épisode 1. */
async function creerSaison(serie: Serie, numero: number): Promise<string> {
  const { supabase } = await utilisateur();
  const { preferences } = await chargerReglages();
  const { data: s, error } = await supabase.from("saisons").insert({ serie_id: serie.id, numero }).select("*").single();
  verifier(error, "Création de la saison");
  const saison = ligne(ligneSaison, s);
  if (!saison) throw new Error("Saison créée mais illisible.");
  const commun = { serie_id: serie.id, saison_id: saison.id, langue: serie.langue, langues: [serie.langue], sous_titres: await sousTitresParDefaut(serie.langue), prises: preferences.prises };
  const { data: eps, error: e2 } = await supabase
    .from("episodes")
    .insert([
      { ...commun, genre: "episode", numero: 1, titre: "Épisode 1", format: "court", duree_cible: BORNES_DUREE.court.defaut },
      { ...commun, genre: "opening", numero: 0, titre: "Opening", idee: `Générique d’ouverture de la saison ${numero}.`, format: "court", duree_cible: BORNES_DUREE.generique.defaut },
      { ...commun, genre: "ending", numero: 0, titre: "Ending", idee: `Générique de fin de la saison ${numero}.`, format: "court", duree_cible: BORNES_DUREE.generique.defaut },
    ])
    .select("*");
  verifier(e2, "Création des épisodes");
  const liste = lignes(ligneEpisode, eps, "episodes");
  const opening = liste.find((e) => e.genre === "opening");
  const ending = liste.find((e) => e.genre === "ending");
  await supabase.from("saisons").update({ opening_id: opening?.id ?? null, ending_id: ending?.id ?? null }).eq("id", saison.id);
  return liste.find((e) => e.genre === "episode")?.id ?? "";
}

/** Crée une série (saison 1, opening, ending, épisode 1, personnages « Héros » et « Narrateur ») puis ouvre sa bible. */
export async function creerSerie(fd: FormData): Promise<void> {
  const serieId = await executer<string>(async () => {
    const d = valider(schemaNouvelleSerie, fd);
    await espaceAMoi(d.espace_id);
    const { supabase } = await utilisateur();
    // Le rythme coche d'office les comptes connectés de l'espace qui parlent la langue de la série.
    const { data: comptes } = await supabase.from("reseaux_connectes").select("id, langue, statut").eq("espace_id", d.espace_id);
    const reseaux = z
      .array(z.object({ id: z.string(), langue: z.string(), statut: z.string() }))
      .catch([])
      .parse(comptes)
      .filter((c) => c.langue === d.langue && c.statut === "connecte")
      .map((c) => c.id);
    const { data, error } = await supabase
      .from("series")
      .insert({ espace_id: d.espace_id, nom: d.nom, style_visuel: d.style_visuel, langue: d.langue, rythme: { tous_les_jours: 2, heure: "18:00", reseaux, auto: false } })
      .select("*")
      .single();
    verifier(error, "Création de la série");
    const serie = await serieAMoi(String(z.object({ id: z.string() }).parse(data).id));
    await creerSaison(serie, 1);
    const { error: e3 } = await supabase.from("personnages").insert([
      { serie_id: serie.id, nom: "Héros", description: "", position: 0 },
      { serie_id: serie.id, nom: "Narrateur", description: "Voix off", position: 1 },
    ]);
    verifier(e3, "Création des personnages");
    return { message: `Série « ${serie.nom} » créée. Remplis sa bible avant d’écrire.`, valeur: serie.id };
  });
  if (serieId) redirect(`/series/${serieId}?onglet=bible`);
}

/** Ajoute un épisode à la fin d'une saison et l'ouvre. */
export async function ajouterEpisode(fd: FormData): Promise<void> {
  const episodeId = await executer<string>(async () => {
    const { saison_id } = valider(schemaSaisonSeule, fd);
    const { saison, serie } = await saisonAMoi(saison_id);
    const { supabase } = await utilisateur();
    const { preferences } = await chargerReglages();
    const eps = lignes(ligneEpisode, (await supabase.from("episodes").select("*").eq("saison_id", saison.id).eq("genre", "episode").order("numero")).data, "episodes");
    const dernier = eps.at(-1);
    const numero = (dernier?.numero ?? 0) + 1;
    const { data, error } = await supabase
      .from("episodes")
      .insert({
        serie_id: serie.id,
        saison_id: saison.id,
        genre: "episode",
        numero,
        titre: `Épisode ${numero}`,
        langue: dernier?.langue ?? serie.langue,
        langues: dernier?.langues ?? [serie.langue],
        sous_titres: dernier?.sous_titres ?? (await sousTitresParDefaut(serie.langue)),
        prises: preferences.prises,
        format: dernier?.format ?? "court",
        duree_cible: dernier?.duree_cible ?? BORNES_DUREE.court.defaut,
      })
      .select("id")
      .single();
    verifier(error, "Création de l’épisode");
    return { message: `Épisode ${numero} ajouté.`, valeur: String(z.object({ id: z.string() }).parse(data).id) };
  });
  if (episodeId) redirect(`/episodes/${episodeId}?etape=scenario`);
}

/** Ajoute une saison (numéro suivant) avec opening, ending et épisode 1. */
export async function ajouterSaison(fd: FormData): Promise<void> {
  await executer(async () => {
    const { serie_id } = valider(schemaSerieSeule, fd);
    const serie = await serieAMoi(serie_id);
    const { supabase } = await utilisateur();
    const saisons = lignes(ligneSaison, (await supabase.from("saisons").select("*").eq("serie_id", serie.id)).data, "saisons");
    const numero = Math.max(0, ...saisons.map((s) => s.numero)) + 1;
    await creerSaison(serie, numero);
    return { message: `Saison ${numero} créée avec son opening, son ending et un premier épisode.` };
  });
}

/**
 * « Écrire la suite » : crée l'épisode suivant dans la dernière saison, avec une idée qui reprend
 * le dernier plan du dernier épisode écrit et le premier mystère ouvert, puis met l'écriture en file.
 */
export async function ecrireSuite(fd: FormData): Promise<void> {
  const episodeId = await executer<string>(async () => {
    const { serie_id } = valider(schemaSerieSeule, fd);
    const serie = await serieAMoi(serie_id);
    const { supabase } = await utilisateur();
    const { preferences } = await chargerReglages();
    const [saisons, episodes, memoire] = await Promise.all([
      supabase.from("saisons").select("*").eq("serie_id", serie.id).then((r) => lignes(ligneSaison, r.data, "saisons")),
      supabase.from("episodes").select("*").eq("serie_id", serie.id).then((r) => lignes(ligneEpisode, r.data, "episodes")),
      supabase.from("memoire").select("*").eq("serie_id", serie.id).eq("genre", "mystere").eq("ouvert", true).order("cree_le").then((r) => lignes(ligneMemoire, r.data, "memoire")),
    ]);
    const saison = [...saisons].sort((a, b) => a.numero - b.numero).at(-1);
    if (!saison) throw new ErreurUtilisateur("Cette série n’a pas de saison.");
    const ordre = ordreLecture(episodes, saisons);
    // Dernier épisode qui a des plans : c'est lui que la suite prolonge.
    let dernierEcrit: Episode | undefined;
    let dernierPlan = "";
    for (const ep of [...ordre].reverse()) {
      const p = ligne(lignePlan, (await supabase.from("plans").select("*").eq("episode_id", ep.id).order("position", { ascending: false }).limit(1).maybeSingle()).data);
      if (p) {
        dernierEcrit = ep;
        dernierPlan = p.texte;
        break;
      }
    }
    const reference = dernierEcrit ?? ordre.at(-1);
    const mystere = memoire[0]?.texte;
    const idee = [`Suite de « ${reference?.titre || serie.nom} ».`, dernierPlan ? `Reprend sur : ${dernierPlan}` : "", mystere ? `Piste à suivre : ${mystere}` : ""].filter(Boolean).join(" ");
    const numero = Math.max(0, ...episodes.filter((e) => e.saison_id === saison.id && e.genre === "episode").map((e) => e.numero)) + 1;
    const { data, error } = await supabase
      .from("episodes")
      .insert({
        serie_id: serie.id,
        saison_id: saison.id,
        genre: "episode",
        numero,
        titre: `Épisode ${numero}`,
        idee,
        langue: reference?.langue ?? serie.langue,
        langues: reference?.langues ?? [serie.langue],
        sous_titres: reference?.sous_titres ?? (await sousTitresParDefaut(serie.langue)),
        format: reference?.format ?? "court",
        duree_cible: reference?.duree_cible ?? BORNES_DUREE.court.defaut,
        prises: preferences.prises,
      })
      .select("id")
      .single();
    verifier(error, "Création de l’épisode");
    const nouveau = String(z.object({ id: z.string() }).parse(data).id);
    await exigerMiseEnFile({ espace_id: serie.espace_id, episode_id: nouveau, type: "scenario", priorite: 1 });
    return { message: `Épisode ${numero} créé avec la continuité de la série. L’écriture est en file.`, valeur: nouveau };
  });
  if (episodeId) redirect(`/episodes/${episodeId}?etape=scenario`);
}

/** Enregistre la bible : nom, univers, fil rouge, style, langue d'origine. */
export async function modifierBible(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaBible, fd);
    await serieAMoi(d.id);
    const { supabase } = await utilisateur();
    const { error } = await supabase.from("series").update({ nom: d.nom, univers: d.univers, fil_rouge: d.fil_rouge, style_visuel: d.style_visuel, langue: d.langue }).eq("id", d.id);
    verifier(error, "Enregistrement de la bible");
    return { message: "Bible enregistrée." };
  });
}

/** Ajoute un personnage à la bible. */
export async function ajouterPersonnage(fd: FormData): Promise<void> {
  await executer(async () => {
    const { serie_id } = valider(schemaSerieSeule, fd);
    await serieAMoi(serie_id);
    const { supabase } = await utilisateur();
    const { count } = await supabase.from("personnages").select("id", { count: "exact", head: true }).eq("serie_id", serie_id);
    const { error } = await supabase.from("personnages").insert({ serie_id, nom: "Nouveau personnage", position: count ?? 0 });
    verifier(error, "Ajout du personnage");
    return { message: "Personnage ajouté." };
  });
}

/** Modifie un personnage (nom, description, voix). Une voix clonée exige l'accord coché. */
export async function modifierPersonnage(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaPersonnage, fd);
    await personnageAMoi(d.id);
    const { supabase } = await utilisateur();
    const { error } = await supabase
      .from("personnages")
      .update({ nom: d.nom, description: d.description, source_voix: d.source_voix, voix_id: d.source_voix === "grok" ? "" : d.voix_id, accord_clone: d.accord_clone })
      .eq("id", d.id);
    verifier(error, "Enregistrement du personnage");
    return { message: `${d.nom} enregistré.` };
  });
}

/** Retire un personnage de la bible. */
export async function supprimerPersonnage(fd: FormData): Promise<void> {
  await executer(async () => {
    const { id } = valider(schemaIdSeul, fd);
    const { personnage } = await personnageAMoi(id);
    const { supabase } = await utilisateur();
    verifier((await supabase.from("personnages").delete().eq("id", id)).error, "Suppression du personnage");
    return { message: `${personnage.nom} retiré.` };
  });
}

/** Met en file la génération de la fiche de référence (face, profil, dos) d'un personnage. */
export async function genererFiche(fd: FormData): Promise<void> {
  await executer(async () => {
    const { id } = valider(schemaIdSeul, fd);
    const { personnage, serie } = await personnageAMoi(id);
    await exigerMiseEnFile({ espace_id: serie.espace_id, type: "fiche_personnage", donnees: { personnage_id: personnage.id } });
    const { supabase } = await utilisateur();
    await supabase.from("personnages").update({ fiche_statut: "en_cours" }).eq("id", personnage.id);
    return { message: `Fiche de ${personnage.nom} en file.` };
  });
}

/** Ajoute un fait à la mémoire de la série. */
export async function ajouterFait(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaFait, fd);
    await serieAMoi(d.serie_id);
    const { supabase } = await utilisateur();
    if (d.episode_id) {
      // L'épisode cité doit appartenir à la même série.
      const ep = ligne(ligneEpisode, (await supabase.from("episodes").select("*").eq("id", d.episode_id).maybeSingle()).data);
      if (!ep || ep.serie_id !== d.serie_id) throw new ErreurUtilisateur("Épisode introuvable dans cette série.");
    }
    const { error } = await supabase.from("memoire").insert({ serie_id: d.serie_id, episode_id: d.episode_id, genre: d.genre, texte: d.texte, ouvert: d.genre === "mystere" });
    verifier(error, "Ajout à la mémoire");
    return { message: "Ajouté à la mémoire." };
  });
}

/** Lit un fait de mémoire de l'utilisateur (RLS). */
async function faitAMoi(id: string) {
  const { supabase } = await utilisateur();
  const f = ligne(ligneMemoire, (await supabase.from("memoire").select("*").eq("id", id).maybeSingle()).data);
  if (!f) throw new ErreurUtilisateur("Élément introuvable.");
  return f;
}

/** Marque un mystère résolu, ou le rouvre. */
export async function basculerMystere(fd: FormData): Promise<void> {
  await executer(async () => {
    const { id } = valider(schemaIdSeul, fd);
    const f = await faitAMoi(id);
    const { supabase } = await utilisateur();
    verifier((await supabase.from("memoire").update({ ouvert: !f.ouvert }).eq("id", id)).error, "Mise à jour du mystère");
    return { message: f.ouvert ? "Mystère marqué résolu." : "Mystère rouvert." };
  });
}

/** Retire un fait de la mémoire. */
export async function supprimerFait(fd: FormData): Promise<void> {
  await executer(async () => {
    const { id } = valider(schemaIdSeul, fd);
    await faitAMoi(id);
    const { supabase } = await utilisateur();
    verifier((await supabase.from("memoire").delete().eq("id", id)).error, "Suppression");
    return { message: "Retiré de la mémoire." };
  });
}

/** Enregistre le rythme de publication (seuls les comptes de l'espace de la série sont gardés). */
export async function modifierRythme(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaRythmeFormulaire, fd, ["reseaux"]);
    const serie = await serieAMoi(d.id);
    const { supabase } = await utilisateur();
    const { data } = await supabase.from("reseaux_connectes").select("id").eq("espace_id", serie.espace_id);
    const autorises = new Set(z.array(z.object({ id: z.string() })).catch([]).parse(data).map((x) => x.id));
    const rythme = { tous_les_jours: d.tous_les_jours, heure: d.heure, reseaux: d.reseaux.filter((r) => autorises.has(r)), auto: d.auto };
    verifier((await supabase.from("series").update({ rythme }).eq("id", serie.id)).error, "Enregistrement du rythme");
    return { message: "Rythme de publication enregistré." };
  });
}

/** Hashtags par défaut de la série, un champ par réseau, normalisés à l'enregistrement. */
export async function enregistrerHashtagsSerie(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(z.object({ id: schemaId, tiktok: z.string().max(3000).default(""), instagram: z.string().max(3000).default(""), youtube: z.string().max(3000).default("") }), fd);
    const serie = await serieAMoi(d.id);
    const hashtags: Record<string, string> = {};
    const coupes: string[] = [];
    for (const r of RESEAUX) {
      const propre = normaliserHashtags(d[r], r);
      if (propre) hashtags[r] = propre;
      // Signale les hashtags retirés pour respecter la limite du réseau.
      const saisis = new Set(d[r].split(/[\s,;]+/).filter(Boolean)).size;
      if (saisis > MAX_HASHTAGS[r]) coupes.push(r);
    }
    const { supabase } = await utilisateur();
    verifier((await supabase.from("series").update({ hashtags }).eq("id", serie.id)).error, "Enregistrement des hashtags");
    return coupes.length ? { message: `Hashtags enregistrés. Limite atteinte sur ${coupes.join(", ")} : les derniers ont été retirés.`, ton: "attention" } : { message: "Hashtags enregistrés." };
  });
}

/** Programme les épisodes prêts de la série aux créneaux successifs du rythme, sur les comptes du rythme. */
export async function programmerEpisodesPrets(fd: FormData): Promise<void> {
  await executer(async () => {
    const { serie_id } = valider(schemaSerieSeule, fd);
    const serie = await serieAMoi(serie_id);
    const { sorties, comptes } = await planProgrammation(serie);
    if (!comptes.length) throw new ErreurUtilisateur("Coche au moins un compte connecté dans le rythme de publication.");
    if (!sorties.length) throw new ErreurUtilisateur("Aucun épisode rendu en attente de programmation.");
    const { supabase } = await utilisateur();
    verifier((await supabase.from("publications").insert(lignesPublications(sorties))).error, "Programmation");
    return { message: `${sorties.length} épisode${sorties.length > 1 ? "s" : ""} programmé${sorties.length > 1 ? "s" : ""}.` };
  });
}
