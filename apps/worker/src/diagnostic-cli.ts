// `npm run diagnostic` : vérifie variables d'environnement, base de données, dossier des médias, ffmpeg (libass, police), puis les clés
// et les comptes connectés de chaque propriétaire. Affiche un tableau OK / ÉCHEC avec le correctif ; code 1 si un point bloquant échoue.
import { adresseLisible, assurerCleChiffrement, configBase, ouvrirBase, versionAttendue, type Base as BaseOuverte } from "@studio-video-ia/base";
import { lireCleMaitre } from "@studio-video-ia/core/chiffrement";
import { testerAnthropic, testerCompte, testerElevenLabs, testerOpenAI, testerXai } from "@studio-video-ia/integrations";
import { chargerCles, dechiffrerValeur } from "./cles";
import type { CompteReseau } from "./comptes";
import { chargerFichierEnv, ErreurConfig, lireConfig, type Config } from "./config";
import { aLibass, policePresente, versionOutil } from "./rendu/executant";
import { adressePublique } from "./stockage";
import { lignes, type Base } from "./bdd";

/** État d'un point vérifié. */
export type Etat = "OK" | "ÉCHEC" | "ATTENTION";

/** Une ligne du tableau de diagnostic. */
export type Point = { nom: string; etat: Etat; detail: string; bloquant: boolean };

/** Met en forme le tableau (colonnes alignées, sans dépendance). */
export function formaterTableau(points: readonly Point[]): string {
  const l1 = Math.max(5, ...points.map((p) => [...p.nom].length));
  const l2 = 9;
  const ligne = (a: string, b: string, c: string): string => `${a.padEnd(l1)}  ${b.padEnd(l2)}  ${c}`;
  return [ligne("Point", "État", "Détail / correctif"), ligne("-".repeat(l1), "-".repeat(l2), "-".repeat(20)), ...points.map((p) => ligne(p.nom, p.etat, p.detail))].join("\n");
}

/** Vrai si au moins un point bloquant est en échec. */
export function aEchecBloquant(points: readonly Point[]): boolean {
  return points.some((p) => p.bloquant && p.etat === "ÉCHEC");
}

/** Vérifications de l'infrastructure : base, dossier des médias, adresse du site, ffmpeg, ffprobe, libass, police. */
async function infrastructure(config: Config, base: BaseOuverte, points: Point[]): Promise<boolean> {
  let baseOk = false;
  const db = base.admin;
  const { error, count } = await db.from("espaces").select("id", { count: "exact", head: true });
  if (error) points.push({ nom: "Base de données", etat: "ÉCHEC", detail: `${error.message} → vérifie DATABASE_URL (ou laisse-la vide pour SQLite)`, bloquant: true });
  else {
    baseOk = true;
    const v = base.migration.version;
    points.push({ nom: "Base de données", etat: "OK", detail: `${adresseLisible(base.config)}, schéma v${v}/${versionAttendue(base.moteur)}, ${count ?? 0} espace(s)`, bloquant: true });
  }
  try {
    await base.depot.testerEcriture();
    points.push({ nom: "Dossier des médias", etat: "OK", detail: base.depot.dossier, bloquant: true });
  } catch (e) {
    points.push({ nom: "Dossier des médias", etat: "ÉCHEC", detail: `${base.depot.dossier} non accessible en écriture (${e instanceof Error ? e.message : String(e)}) → règle MEDIAS_DIR ou les droits du dossier`, bloquant: true });
  }
  points.push(
    adressePublique(config.adresseSite)
      ? { nom: "Adresse du site (APP_URL)", etat: "OK", detail: `${config.adresseSite} : Instagram peut télécharger les vidéos`, bloquant: false }
      : { nom: "Adresse du site (APP_URL)", etat: "ATTENTION", detail: `${config.adresseSite} n'est pas publique : la publication Instagram ne marchera pas (TikTok et YouTube oui). Voir docs/INSTALLER.md`, bloquant: false },
  );

  const vFfmpeg = await versionOutil(config.ffmpeg);
  points.push(vFfmpeg ? { nom: "ffmpeg", etat: "OK", detail: vFfmpeg, bloquant: true } : { nom: "ffmpeg", etat: "ÉCHEC", detail: `introuvable (${config.ffmpeg}) → installe ffmpeg ou règle FFMPEG_PATH`, bloquant: true });
  const vFfprobe = await versionOutil(config.ffprobe);
  points.push(vFfprobe ? { nom: "ffprobe", etat: "OK", detail: vFfprobe, bloquant: true } : { nom: "ffprobe", etat: "ÉCHEC", detail: `introuvable (${config.ffprobe}) → installé avec ffmpeg, ou règle FFPROBE_PATH`, bloquant: true });
  if (vFfmpeg) {
    const libass = await aLibass(config.ffmpeg);
    points.push(
      libass
        ? { nom: "libass (sous-titres)", etat: "OK", detail: "filtre « subtitles » disponible", bloquant: true }
        : { nom: "libass (sous-titres)", etat: "ÉCHEC", detail: "filtre « subtitles » absent → installe un ffmpeg complet (Debian/Ubuntu : apt install ffmpeg) ou utilise Docker", bloquant: true },
    );
  }
  const police = await policePresente(config.police);
  points.push(
    police === null
      ? { nom: "Police des sous-titres", etat: "ATTENTION", detail: `fc-list absent : impossible de vérifier « ${config.police} »`, bloquant: false }
      : police
        ? { nom: "Police des sous-titres", etat: "OK", detail: config.police, bloquant: false }
        : { nom: "Police des sous-titres", etat: "ATTENTION", detail: `« ${config.police} » introuvable → installe fonts-noto-cjk ou change SUBTITLE_FONT`, bloquant: false },
  );
  return baseOk;
}

/** Vérifie les clés et les comptes connectés de chaque propriétaire. */
async function proprietaires(config: Config, db: Base, points: Point[]): Promise<void> {
  const cleMaitre = lireCleMaitre(config.cleChiffrement);
  const espaces = await lignes<{ id: string; nom: string; proprietaire: string }>(db.from("espaces").select("id, nom, proprietaire"), "espaces");
  const parProprietaire = new Map<string, { id: string; nom: string }[]>();
  for (const e of espaces) parProprietaire.set(e.proprietaire, [...(parProprietaire.get(e.proprietaire) ?? []), e]);
  if (parProprietaire.size === 0) points.push({ nom: "Comptes utilisateurs", etat: "ATTENTION", detail: "aucun espace : connecte-toi au site et crée un compte", bloquant: false });

  for (const [proprietaire, sesEspaces] of parProprietaire) {
    // Seul le début de l'identifiant est affiché : assez pour s'y retrouver, sans exposer l'utilisateur.
    const qui = `[${proprietaire.slice(0, 8)}]`;
    let cles;
    try {
      cles = await chargerCles(db, cleMaitre, proprietaire);
    } catch (e) {
      points.push({ nom: `${qui} Clés`, etat: "ÉCHEC", detail: e instanceof Error ? e.message : String(e), bloquant: true });
      continue;
    }
    const tests = [
      { nom: "OpenAI", cle: cles.openai, tester: testerOpenAI },
      { nom: "xAI", cle: cles.xai, tester: testerXai },
      { nom: "ElevenLabs", cle: cles.elevenlabs, tester: testerElevenLabs },
      { nom: "Claude (facultative)", cle: cles.anthropic, tester: testerAnthropic },
    ];
    for (const t of tests) {
      if (!t.cle) {
        points.push({ nom: `${qui} Clé ${t.nom}`, etat: "ATTENTION", detail: "non saisie → Réglages → Clés API", bloquant: false });
        continue;
      }
      const r = await t.tester(t.cle);
      points.push({ nom: `${qui} Clé ${t.nom}`, etat: r.ok ? "OK" : "ÉCHEC", detail: r.message, bloquant: !r.ok });
    }
    for (const espace of sesEspaces) {
      const comptes = await lignes<CompteReseau>(db.from("reseaux_connectes").select("*").eq("espace_id", espace.id).neq("statut", "deconnecte"), "comptes connectés");
      for (const c of comptes) {
        const nom = `${qui} ${espace.nom} · ${c.reseau} « ${c.nom_compte} »`;
        if (!c.jeton_acces_chiffre) {
          points.push({ nom, etat: "ÉCHEC", detail: "jeton absent → reconnecte le compte", bloquant: false });
          continue;
        }
        try {
          const jeton = dechiffrerValeur(c.jeton_acces_chiffre, cleMaitre, "le jeton");
          const r = await testerCompte(c.reseau, jeton, c.id_externe);
          const expire = c.jeton_expire_le && new Date(c.jeton_expire_le).getTime() < Date.now() ? " (jeton expiré : le worker le renouvellera avant d'envoyer)" : "";
          points.push({ nom, etat: r.ok ? "OK" : "ÉCHEC", detail: `${r.message}${expire}`, bloquant: !r.ok });
        } catch (e) {
          points.push({ nom, etat: "ÉCHEC", detail: e instanceof Error ? e.message : String(e), bloquant: true });
        }
      }
    }
  }
}

/** Lance le diagnostic complet et renvoie le code de sortie. */
export async function diagnostic(): Promise<number> {
  const points: Point[] = [];
  const env = chargerFichierEnv();
  points.push({ nom: "Fichier .env", etat: env ? "OK" : "ATTENTION", detail: env ?? "absent : variables lues dans l'environnement seulement (cp .env.example .env)", bloquant: false });
  let config: Config;
  const reglagesBase = configBase();
  try {
    assurerCleChiffrement(reglagesBase.dossierDonnees);
    config = lireConfig();
    points.push({ nom: "Variables d'environnement", etat: "OK", detail: `worker « ${config.nom} », ${config.concurrence} tâche(s) à la fois, Instagram ${config.versionInstagram}`, bloquant: true });
  } catch (e) {
    const detail = e instanceof ErreurConfig ? e.problemes.join(" ; ") : e instanceof Error ? e.message : String(e);
    points.push({ nom: "Variables d'environnement", etat: "ÉCHEC", detail: `${detail} → complète le fichier .env`, bloquant: true });
    console.log(formaterTableau(points));
    return 1;
  }
  process.env.INSTAGRAM_API_VERSION = config.versionInstagram;
  let base: BaseOuverte | null = null;
  try {
    base = await ouvrirBase(reglagesBase);
    if (await infrastructure(config, base, points)) await proprietaires(config, base.admin, points);
  } catch (e) {
    points.push({ nom: "Base de données", etat: "ÉCHEC", detail: `${e instanceof Error ? e.message : String(e)} → vérifie DATABASE_URL et les droits du dossier des données`, bloquant: true });
  } finally {
    await base?.fermer().catch(() => undefined);
  }
  console.log(formaterTableau(points));
  const bloquant = aEchecBloquant(points);
  console.log(bloquant ? "\nAu moins un point bloquant est en échec : corrige-le puis relance « npm run diagnostic »." : "\nTout ce qui est nécessaire fonctionne.");
  return bloquant ? 1 : 0;
}

// Exécution directe (npm run diagnostic) ; l'import depuis un test ne lance rien.
if (process.argv[1] && /diagnostic-cli\.ts$/.test(process.argv[1])) {
  diagnostic()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
}
