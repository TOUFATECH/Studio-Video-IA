// Vérifications de la page Diagnostic. Chaque vérification renvoie OK ou Échec et la marche à suivre ;
// aucune valeur secrète n'est jamais renvoyée.
import "server-only";
import { NOMS_RESEAUX, schemaReseau, type Fournisseur } from "@studio-video-ia/core";
import { chiffrer, dechiffrer, lireCleMaitre } from "@studio-video-ia/core/chiffrement";
import { renouvelerJeton, testerCompte, testerElevenLabs, testerOpenAI, testerXai, type Fetch } from "@studio-video-ia/integrations";
import { z } from "zod";
import { cleMaitre, lireAppOAuth, lireCle } from "./cles";
import { lireEnv, NOMS_ENV } from "./env";
import { messageErreur } from "./erreurs";
import { clientAdmin } from "./supabase/admin";
import type { ClientSupabase } from "./supabase/serveur";

/** Une ligne du tableau de diagnostic. */
export type Verification = { groupe: string; nom: string; ok: boolean; detail: string; aFaire?: string };

/** fetch avec délai maximal : une API qui ne répond pas ne bloque pas la page. */
const fetchLimite: Fetch = (entree, options) => fetch(entree, { ...options, signal: AbortSignal.timeout(10_000) });

/** Variables d'environnement présentes (jamais leur valeur). */
export function verifierEnv(): Verification[] {
  const out: Verification[] = NOMS_ENV.map((nom) => ({
    groupe: "Configuration",
    nom,
    ok: !!lireEnv(nom),
    detail: lireEnv(nom) ? "Présente" : "Absente",
    aFaire: lireEnv(nom) ? undefined : `Ajoute ${nom} dans apps/web/.env.local (voir .env.example), puis redémarre.`,
  }));
  if (lireEnv("ENCRYPTION_KEY")) {
    try {
      lireCleMaitre(lireEnv("ENCRYPTION_KEY"));
      out.push({ groupe: "Configuration", nom: "Format de ENCRYPTION_KEY", ok: true, detail: "32 octets en base64" });
    } catch (e) {
      out.push({ groupe: "Configuration", nom: "Format de ENCRYPTION_KEY", ok: false, detail: messageErreur(e), aFaire: "Génère-la avec « openssl rand -base64 32 » (même valeur pour le web et le worker)." });
    }
  }
  return out;
}

/** Connexion à Supabase et bucket « medias ». */
export async function verifierSupabase(supabase: ClientSupabase): Promise<Verification[]> {
  const out: Verification[] = [];
  const { error } = await supabase.from("espaces").select("id", { count: "exact", head: true });
  out.push({ groupe: "Supabase", nom: "Connexion à la base", ok: !error, detail: error ? error.message : "Lecture des tables autorisée", aFaire: error ? "Vérifie l’URL, la clé publique et que les migrations SQL sont appliquées." : undefined });
  try {
    const { data, error: e } = await clientAdmin().storage.getBucket("medias");
    const ok = !e && !!data && !data.public;
    out.push({
      groupe: "Supabase",
      nom: "Bucket « medias »",
      ok,
      detail: e ? e.message : data?.public ? "Le bucket est public" : "Présent et privé",
      aFaire: ok ? undefined : "Applique supabase/migrations/0001_init.sql (il crée le bucket privé « medias »).",
    });
  } catch (e) {
    out.push({ groupe: "Supabase", nom: "Bucket « medias »", ok: false, detail: messageErreur(e), aFaire: "Vérifie SUPABASE_SERVICE_ROLE_KEY." });
  }
  return out;
}

/** Infos publiées par le worker dans workers_etat.infos. */
const schemaInfosWorker = z.object({ libass: z.union([z.boolean(), z.string()]).optional(), police: z.string().optional(), police_presente: z.boolean().nullable().optional(), version: z.string().optional() }).passthrough().catch({});

/** Workers vus récemment, version de ffmpeg, libass et police des sous-titres. */
export async function verifierWorkers(supabase: ClientSupabase): Promise<Verification[]> {
  const { data } = await supabase.from("workers_etat").select("*");
  const lignes = z.array(z.object({ nom: z.string(), vu_le: z.string(), version_ffmpeg: z.string().nullable(), infos: z.unknown() })).catch([]).parse(data);
  if (!lignes.length) return [{ groupe: "Worker", nom: "Worker en ligne", ok: false, detail: "Aucun worker ne s’est jamais signalé", aFaire: "Lance « npm run dev:worker » (ou le service) sur la machine qui génère les vidéos." }];
  return lignes.flatMap((w) => {
    const age = (Date.now() - Date.parse(w.vu_le)) / 1000;
    const infos = schemaInfosWorker.parse(w.infos);
    const libass = infos.libass === true || (typeof infos.libass === "string" && !/non|absent|false/i.test(infos.libass));
    return [
      { groupe: "Worker", nom: `${w.nom} en ligne`, ok: age < 120, detail: age < 120 ? `Vu il y a ${Math.round(age)} s` : `Dernier signe il y a ${Math.round(age / 60)} min`, aFaire: age < 120 ? undefined : "Démarre le worker : les tâches restent en file tant qu’il est éteint." },
      { groupe: "Worker", nom: `${w.nom} · ffmpeg`, ok: !!w.version_ffmpeg, detail: w.version_ffmpeg ?? "Version inconnue", aFaire: w.version_ffmpeg ? undefined : "Installe ffmpeg ou renseigne FFMPEG_PATH." },
      { groupe: "Worker", nom: `${w.nom} · libass (sous-titres)`, ok: libass, detail: libass ? "Disponible" : "Absent ou inconnu", aFaire: libass ? undefined : "Installe un ffmpeg compilé avec libass." },
      // police_presente vaut false quand le worker n'a pas trouvé la police sur sa machine (null : vérification impossible).
      { groupe: "Worker", nom: `${w.nom} · police des sous-titres`, ok: !!infos.police && infos.police_presente !== false, detail: infos.police ? `${infos.police}${infos.police_presente === false ? " (introuvable sur la machine)" : ""}` : "Inconnue", aFaire: infos.police && infos.police_presente !== false ? undefined : "Installe une police CJK (ex. Noto Sans CJK JP) et renseigne SUBTITLE_FONT." },
    ];
  });
}

/** Libellés des fournisseurs. */
const NOMS_FOURNISSEURS: Record<Fournisseur, string> = { openai: "OpenAI", xai: "xAI · Grok", elevenlabs: "ElevenLabs", google: "Google (YouTube)", meta: "Meta (Instagram)", tiktok: "TikTok" };

/** Teste chaque clé API (appel réel pour OpenAI, xAI, ElevenLabs ; présence pour les applications OAuth). */
export async function verifierCles(proprietaire: string): Promise<Verification[]> {
  const fournisseurs: Fournisseur[] = ["openai", "xai", "elevenlabs", "google", "meta", "tiktok"];
  return Promise.all(
    fournisseurs.map(async (f): Promise<Verification> => {
      const nom = NOMS_FOURNISSEURS[f];
      try {
        const valeur = await lireCle(proprietaire, f);
        if (!valeur) return { groupe: "Clés API", nom, ok: false, detail: "Absente", aFaire: "Ajoute-la dans Réglages → Clés API." };
        if (f === "openai" || f === "xai" || f === "elevenlabs") {
          const r = await (f === "openai" ? testerOpenAI : f === "xai" ? testerXai : testerElevenLabs)(valeur, fetchLimite);
          return { groupe: "Clés API", nom, ok: r.ok, detail: r.message, aFaire: r.ok ? undefined : "Vérifie la clé et le crédit du compte chez le fournisseur." };
        }
        const ok = z.object({ client_id: z.string().min(4), client_secret: z.string().min(4) }).safeParse(JSON.parse(valeur)).success;
        return { groupe: "Clés API", nom, ok, detail: ok ? "Identifiant et secret présents" : "Incomplète", aFaire: ok ? undefined : "Enregistre à nouveau l’identifiant et le secret." };
      } catch (e) {
        return { groupe: "Clés API", nom, ok: false, detail: messageErreur(e), aFaire: "Enregistre à nouveau la clé (ENCRYPTION_KEY a peut-être changé)." };
      }
    }),
  );
}

/** Teste chaque compte connecté, après renouvellement du jeton s'il expire bientôt. */
export async function verifierComptes(proprietaire: string, espaceIds: readonly string[]): Promise<Verification[]> {
  if (!espaceIds.length) return [];
  const admin = clientAdmin();
  const { data } = await admin
    .from("reseaux_connectes")
    .select("id, reseau, nom_compte, id_externe, statut, jeton_acces_chiffre, jeton_renouvellement_chiffre, jeton_expire_le")
    .in("espace_id", [...espaceIds]);
  const comptes = z
    .array(
      z.object({
        id: z.string(),
        reseau: schemaReseau,
        nom_compte: z.string(),
        id_externe: z.string().nullable(),
        statut: z.string(),
        jeton_acces_chiffre: z.string().nullable(),
        jeton_renouvellement_chiffre: z.string().nullable(),
        jeton_expire_le: z.string().nullable(),
      }),
    )
    .catch([])
    .parse(data);
  const cle = cleMaitre();
  return Promise.all(
    comptes.map(async (c): Promise<Verification> => {
      const nom = `${NOMS_RESEAUX[c.reseau]} · ${c.nom_compte}`;
      const reconnecter = "Reconnecte le compte dans Réglages → Comptes.";
      if (c.statut !== "connecte" || !c.jeton_acces_chiffre) return { groupe: "Comptes connectés", nom, ok: false, detail: c.statut === "expire" ? "Connexion expirée" : "Déconnecté", aFaire: reconnecter };
      try {
        let acces = dechiffrer(c.jeton_acces_chiffre, cle);
        const bientot = c.jeton_expire_le && Date.parse(c.jeton_expire_le) < Date.now() + 5 * 60_000;
        if (bientot) {
          const app = await lireAppOAuth(proprietaire, c.reseau);
          const renouv = c.jeton_renouvellement_chiffre ? dechiffrer(c.jeton_renouvellement_chiffre, cle) : null;
          if (!app || !renouv) return { groupe: "Comptes connectés", nom, ok: false, detail: "Jeton expiré, renouvellement impossible", aFaire: reconnecter };
          const neuf = await renouvelerJeton(c.reseau, app, { acces, renouvellement: renouv }, fetchLimite);
          acces = neuf.acces;
          await admin
            .from("reseaux_connectes")
            .update({
              jeton_acces_chiffre: chiffrer(neuf.acces, cle),
              // Certains réseaux ne renvoient pas de nouveau jeton de renouvellement : on garde l'ancien.
              jeton_renouvellement_chiffre: neuf.renouvellement ? chiffrer(neuf.renouvellement, cle) : c.jeton_renouvellement_chiffre,
              jeton_expire_le: neuf.expireLe ? neuf.expireLe.toISOString() : null,
            })
            .eq("id", c.id);
        }
        const r = await testerCompte(c.reseau, acces, c.id_externe, fetchLimite);
        return { groupe: "Comptes connectés", nom, ok: r.ok, detail: r.message, aFaire: r.ok ? undefined : reconnecter };
      } catch (e) {
        return { groupe: "Comptes connectés", nom, ok: false, detail: messageErreur(e), aFaire: reconnecter };
      }
    }),
  );
}

/** Quotas : Instagram (100 publications par 24 h), YouTube (environ 6 envois par jour avec le quota par défaut). */
export async function verifierQuotas(supabase: ClientSupabase, espaceIds: readonly string[]): Promise<Verification[]> {
  if (!espaceIds.length) return [];
  const { data: rc } = await supabase.from("reseaux_connectes").select("id, reseau, nom_compte").in("espace_id", [...espaceIds]).in("reseau", ["instagram", "youtube"]);
  const comptes = z.array(z.object({ id: z.string(), reseau: schemaReseau, nom_compte: z.string() })).catch([]).parse(rc);
  if (!comptes.length) return [];
  const depuis = new Date(Date.now() - 86_400_000).toISOString();
  const { data } = await supabase.from("publications").select("reseau_connecte_id, publiee_le").in("reseau_connecte_id", comptes.map((c) => c.id)).gte("publiee_le", depuis);
  const pubs = z.array(z.object({ reseau_connecte_id: z.string() })).catch([]).parse(data);
  return comptes.map((c) => {
    const n = pubs.filter((p) => p.reseau_connecte_id === c.id).length;
    const max = c.reseau === "instagram" ? 100 : 6;
    return {
      groupe: "Quotas de publication",
      nom: `${NOMS_RESEAUX[c.reseau]} · ${c.nom_compte}`,
      ok: n < max,
      detail: `${n} publication${n > 1 ? "s" : ""} sur 24 h (limite ${c.reseau === "instagram" ? "100" : "≈ 6 avec le quota YouTube par défaut"})`,
      aFaire: n < max ? undefined : c.reseau === "instagram" ? "Attends 24 h : Instagram refuse au-delà de 100 publications par API." : "Demande une hausse de quota dans la console Google Cloud, ou étale les envois.",
    };
  });
}
