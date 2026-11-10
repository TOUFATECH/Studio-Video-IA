"use server";
// Actions de l'espace Clips : création d'un clip, son et paroles, réglages (format, extrait, tempo, sous-titres),
// lancement des tâches paroles / musique / synchronisation / découpage. Appartenance vérifiée avant toute écriture.
import { DUREE_MAX_CLIP, type Episode, type Langue, type Serie } from "@studio-video-ia/core";
import { redirect } from "next/navigation";
import { z } from "zod";
import { executer } from "@/lib/action";
import { episodeAMoi, espaceAMoi, serieAMoi } from "@/lib/appartenance";
import { ErreurUtilisateur } from "@/lib/erreurs";
import { supprimerRendus } from "@/lib/invalidation";
import { ligne, ligneSerie } from "@/lib/lignes";
import { chargerReglages } from "@/lib/reglages";
import { formulaire, premiereErreur, schemaEpisodeSeul, schemaEspaceClips, schemaMusique, schemaNouveauClip, schemaReglagesClip, schemaSonParoles } from "@/lib/schemas";
import { utilisateur } from "@/lib/session";
import { exigerMiseEnFile } from "@/lib/taches";

/** Valide un formulaire ou lève une erreur affichable. */
function valider<S extends z.ZodTypeAny>(schema: S, fd: FormData): z.infer<S> {
  const r = schema.safeParse(formulaire(fd));
  if (!r.success) throw new ErreurUtilisateur(premiereErreur(r.error));
  return r.data;
}

/** Lève une erreur si une écriture en base a échoué. */
function verifier(erreur: { message: string } | null, quoi: string): void {
  if (erreur) throw new Error(`${quoi} : ${erreur.message}`);
}

/** Clip de l'utilisateur (refus si l'épisode n'est pas un clip). */
async function clipAMoi(id: string): Promise<{ episode: Episode; serie: Serie }> {
  const r = await episodeAMoi(id);
  if (r.episode.genre !== "clip") throw new ErreurUtilisateur("Ce n’est pas un clip.");
  return r;
}

/**
 * Espace Clips d'un compte : la série « clips » (une par compte), créée à la première demande avec sa saison.
 * Son nom sert de nom d'artiste dans les titres (« Nom — Titre »).
 */
export async function espaceClips(espaceId: string): Promise<{ serie: Serie; saisonId: string }> {
  const espace = await espaceAMoi(espaceId);
  const { db } = await utilisateur();
  let serie = ligne(ligneSerie, (await db.from("series").select("*").eq("espace_id", espace.id).eq("genre", "clips").maybeSingle()).data);
  if (!serie) {
    const { data, error } = await db
      .from("series")
      .insert({ espace_id: espace.id, nom: espace.nom, genre: "clips", style_visuel: "Clip musical cinématique, lumières travaillées", univers: "", fil_rouge: "" })
      .select("*")
      .single();
    // 23505 : créée au même instant par un autre onglet ; on relit simplement.
    if (error && error.code !== "23505") throw new Error(`Création de l’espace Clips : ${error.message}`);
    serie = ligne(ligneSerie, data) ?? ligne(ligneSerie, (await db.from("series").select("*").eq("espace_id", espace.id).eq("genre", "clips").maybeSingle()).data);
    if (!serie) throw new Error("Espace Clips créé mais illisible.");
  }
  const { data: saison } = await db.from("saisons").select("id").eq("serie_id", serie.id).order("numero").limit(1).maybeSingle();
  if (saison && typeof saison.id === "string") return { serie, saisonId: saison.id };
  const { data: nouvelle, error: e2 } = await db.from("saisons").insert({ serie_id: serie.id, numero: 1 }).select("id").single();
  verifier(e2, "Création de la saison des clips");
  return { serie, saisonId: String(z.object({ id: z.string() }).parse(nouvelle).id) };
}

/** Crée un clip et ouvre son étape « Son et paroles ». */
export async function creerClip(fd: FormData): Promise<void> {
  const id = await executer<string>(async () => {
    const d = valider(schemaNouveauClip, fd);
    const { serie, saisonId } = await espaceClips(d.espace_id);
    const { db } = await utilisateur();
    const { preferences } = await chargerReglages();
    const { data: derniers } = await db.from("episodes").select("numero").eq("serie_id", serie.id).eq("genre", "clip").order("numero", { ascending: false }).limit(1);
    const numero = (z.array(z.object({ numero: z.coerce.number() })).catch([]).parse(derniers)[0]?.numero ?? 0) + 1;
    const { data, error } = await db
      .from("episodes")
      .insert({
        serie_id: serie.id,
        saison_id: saisonId,
        genre: "clip",
        numero,
        titre: d.titre,
        format: d.format,
        duree_cible: Math.min(DUREE_MAX_CLIP[d.format], 90),
        langue: d.langue,
        langues: [d.langue],
        // Par défaut, les paroles s'affichent en sous-titres dans la langue de la chanson.
        sous_titres: { [d.langue]: d.langue },
        prises: preferences.prises,
        musique: false,
        bruitages: false,
        enchainer: true,
      })
      .select("id")
      .single();
    verifier(error, "Création du clip");
    return { message: d.source === "generer" ? "Clip créé. Écris (ou demande) les paroles, puis génère la musique." : "Clip créé. Colle les paroles et importe ta chanson.", valeur: String(z.object({ id: z.string() }).parse(data).id) };
  });
  if (id) redirect(`/clips/${id}?etape=son`);
}

/** Paroles, style musical, langue, instrumental et IA choisie. Changer les paroles oblige à resynchroniser. */
export async function enregistrerSonParoles(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaSonParoles, fd);
    const { episode } = await clipAMoi(d.id);
    const parolesChangees = d.paroles !== episode.paroles.trim() || d.instrumental !== episode.instrumental || d.langue !== episode.langue;
    // La langue de la chanson est la seule version du clip ; le choix de sous-titres la suit.
    const ancien = episode.sous_titres[episode.langue] ?? "aucun";
    const sousTitres: Partial<Record<Langue, string>> = { [d.langue]: ancien === episode.langue ? d.langue : ancien };
    const maj: Record<string, unknown> = {
      paroles: d.paroles,
      musique_style: d.musique_style,
      instrumental: d.instrumental,
      langue: d.langue,
      langues: [d.langue],
      sous_titres: sousTitres,
      fournisseur_texte: d.fournisseur_texte,
    };
    if (parolesChangees) {
      maj.paroles_alignees = null;
      maj.paroles_traduites = {};
    }
    const { db } = await utilisateur();
    verifier((await db.from("episodes").update(maj).eq("id", episode.id)).error, "Enregistrement des paroles");
    if (d.langue !== episode.langue) await supprimerRendus(episode.id);
    return { message: parolesChangees ? "Enregistré. Relance la synchronisation pour placer les nouvelles paroles dans la chanson." : "Enregistré." };
  });
}

/** Titre, idée, style visuel, format, extrait, tempo et sous-titres. Un changement de découpage demande de redécouper. */
export async function enregistrerReglagesClip(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaReglagesClip, fd);
    const { episode } = await clipAMoi(d.id);
    const max = DUREE_MAX_CLIP[d.format];
    if (d.extrait_fin !== null && d.extrait_fin - d.extrait_debut > max + 0.5) {
      throw new ErreurUtilisateur(`Extrait trop long pour ce format : ${Math.floor(max / 60)}:${String(max % 60).padStart(2, "0")} maximum.`);
    }
    const decoupageChange =
      d.format !== episode.format || d.extrait_debut !== episode.extrait_debut || d.extrait_fin !== episode.extrait_fin || d.bpm !== episode.bpm;
    const sousTitresChanges = d.sous_titres !== (episode.sous_titres[episode.langue] ?? "aucun");
    const { db } = await utilisateur();
    verifier(
      (
        await db
          .from("episodes")
          .update({
            titre: d.titre,
            idee: d.idee,
            style_visuel: d.style_visuel,
            format: d.format,
            extrait_debut: d.extrait_debut,
            extrait_fin: d.extrait_fin,
            bpm: d.bpm,
            sous_titres: { [episode.langue]: d.sous_titres },
          })
          .eq("id", episode.id)
      ).error,
      "Enregistrement du clip",
    );
    const { count } = await db.from("plans").select("id", { count: "exact", head: true }).eq("episode_id", episode.id);
    if (sousTitresChanges || (decoupageChange && (count ?? 0) > 0)) await supprimerRendus(episode.id);
    if (decoupageChange && (count ?? 0) > 0) return { message: "Enregistré. Clique « Redécouper » pour caler les plans sur ces nouveaux réglages.", ton: "info" };
    return { message: sousTitresChanges ? "Enregistré. Relance le rendu pour les nouveaux sous-titres." : "Enregistré." };
  });
}

/** Demande des paroles à l'IA choisie (ChatGPT ou Claude), à partir de l'idée et du style. */
export async function ecrireParoles(fd: FormData): Promise<void> {
  await executer(async () => {
    const { episode_id } = valider(schemaEpisodeSeul, fd);
    const { episode, serie } = await clipAMoi(episode_id);
    if (!episode.idee.trim() && !episode.titre.trim()) throw new ErreurUtilisateur("Donne au moins un titre ou une idée pour que l’IA écrive les paroles.");
    await exigerMiseEnFile({ espace_id: serie.espace_id, episode_id: episode.id, type: "paroles", priorite: 1 });
    return { message: "Écriture des paroles en file. Elles remplaceront le texte actuel." };
  });
}

/** Compose la musique avec ElevenLabs (puis synchronise les paroles). */
export async function genererMusique(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaMusique, fd);
    const { episode, serie } = await clipAMoi(d.episode_id);
    if (!episode.instrumental && !episode.paroles.trim()) throw new ErreurUtilisateur("Écris les paroles (ou coche « Instrumental ») puis enregistre avant de générer la musique.");
    await exigerMiseEnFile({ espace_id: serie.espace_id, episode_id: episode.id, type: "musique", donnees: { duree: d.duree, synchroniser: true }, priorite: 1 });
    return { message: "Composition de la musique en file. Les paroles seront placées dans la chanson ensuite." };
  });
}

/** Place les paroles dans la chanson (ou les reconnaît si elles manquent). */
export async function synchroniserParoles(fd: FormData): Promise<void> {
  await executer(async () => {
    const { episode_id } = valider(schemaEpisodeSeul, fd);
    const { episode, serie } = await clipAMoi(episode_id);
    const { db } = await utilisateur();
    const { count } = await db.from("fichiers").select("id", { count: "exact", head: true }).eq("episode_id", episode.id).eq("genre", "chanson").eq("statut", "pret");
    if (!count) throw new ErreurUtilisateur("Ajoute d’abord la chanson (import ou génération).");
    await exigerMiseEnFile({ espace_id: serie.espace_id, episode_id: episode.id, type: "synchro", priorite: 1 });
    return { message: "Synchronisation en file." };
  });
}

/** Découpe le clip sur la chanson et fait écrire les scènes (remplace les plans existants). */
export async function decouperClip(fd: FormData): Promise<void> {
  await executer(async () => {
    const { episode_id } = valider(schemaEpisodeSeul, fd);
    const { episode, serie } = await clipAMoi(episode_id);
    if (episode.paroles_alignees === null) throw new ErreurUtilisateur("Synchronise d’abord les paroles avec la chanson.");
    await exigerMiseEnFile({ espace_id: serie.espace_id, episode_id: episode.id, type: "scenario", donnees: { mode: "ecrire" }, priorite: 1 });
    return { message: "Découpage en file : les plans vont apparaître, calés sur la chanson." };
  });
}

/** Nom (d'artiste) et style visuel par défaut de l'espace Clips. */
export async function modifierEspaceClips(fd: FormData): Promise<void> {
  await executer(async () => {
    const d = valider(schemaEspaceClips, fd);
    const serie = await serieAMoi(d.serie_id);
    if (serie.genre !== "clips") throw new ErreurUtilisateur("Ce n’est pas un espace Clips.");
    const { db } = await utilisateur();
    verifier((await db.from("series").update({ nom: d.nom, style_visuel: d.style_visuel }).eq("id", serie.id)).error, "Espace Clips");
    return { message: "Espace Clips enregistré." };
  });
}
