// Boucle principale du worker : prise des tâches (concurrence WORKER_CONCURRENCY), battement de cœur, libération des
// tâches bloquées, planificateur, synchronisation des statistiques, arrêt propre sur SIGINT / SIGTERM.
import type { Tache, TypeTache } from "@studio-video-ia/core";
import { ErreurApi, type Fetch } from "@studio-video-ia/integrations";
import { accesBudgetSupabase, estPayante, plafondAtteint, type AccesBudget } from "./budget";
import { ErreurReconnexion } from "./comptes";
import { VERSION_WORKER, type Config } from "./config";
import { creerContexte, ErreurAnnulee, ErreurArret, ErreurPlafond } from "./contexte";
import { erreurCourte } from "./donnees";
import { journal, messageErreur } from "./journal";
import { accesPlanificateurSupabase, planifier, STATUTS_ACTIFS } from "./planificateur";
import { aLibass, policePresente, versionOutil } from "./rendu/executant";
import type { Stockage } from "./stockage";
import { ecrire, lignes, type Base } from "./supabase";
import { EXECUTANTS, type Executant } from "./taches";

/** Intervalles des travaux périodiques (ms). */
export const INTERVALLES = {
  attenteFileVide: 3_000,
  attenteErreur: 15_000,
  battement: 30_000,
  liberation: 5 * 60_000,
  planificateur: 30_000,
  verificationStats: 30 * 60_000,
  /** Une synchronisation des statistiques par espace toutes les 6 heures au plus. */
  periodeStats: 6 * 3600_000,
} as const;

/** Nombre maximal d'essais d'une tâche limitée par un fournisseur (429) avant l'échec. */
export const ESSAIS_MAX_LIMITE = 4;

/** Ce qu'il faut faire d'une tâche après une erreur. */
export type Issue =
  | { statut: "en_pause"; erreur: string }
  | { statut: "en_file"; erreur: string | null; executerApres?: Date }
  | { statut: "echec"; erreur: string }
  | { statut: "annulee" };

/**
 * Décide, sans effet de bord, du sort d'une tâche après une erreur :
 * plafond → pause ; arrêt du worker → remise en file ; annulation → rien ;
 * limite de débit (429) → nouvel essai différé ; sinon → échec avec un message en français.
 */
export function issueErreur(e: unknown, tache: Pick<Tache, "essais">, arretDemande: boolean, maintenant: Date = new Date()): Issue {
  if (e instanceof ErreurPlafond) return { statut: "en_pause", erreur: e.message };
  if (e instanceof ErreurAnnulee) return { statut: "annulee" };
  if (e instanceof ErreurArret || arretDemande) return { statut: "en_file", erreur: null };
  if (e instanceof ErreurApi && e.statut === 429 && tache.essais < ESSAIS_MAX_LIMITE) {
    const apres = new Date(maintenant.getTime() + 2 * 60_000 * Math.max(1, tache.essais));
    return { statut: "en_file", erreur: `${e.fournisseur} limite les requêtes : nouvel essai vers ${apres.toISOString().slice(11, 16)} UTC.`, executerApres: apres };
  }
  if (e instanceof ErreurReconnexion) return { statut: "echec", erreur: e.message };
  return { statut: "echec", erreur: erreurCourte(e) };
}

/** Dépendances de la file. */
export type DependancesFile = {
  db: Base;
  config: Config;
  stockage: Stockage;
  cleMaitre: Buffer;
  f?: Fetch;
  executants?: Partial<Record<TypeTache, Executant>>;
  budget?: AccesBudget;
};

/** File de tâches du worker. */
export class FileDeTaches {
  private readonly arret = new AbortController();
  private readonly minuteurs: NodeJS.Timeout[] = [];
  private readonly boucles: Promise<void>[] = [];
  private readonly enCours = new Map<string, Tache>();
  private readonly budget: AccesBudget;
  private outils: { versionFfmpeg: string | null; libass: boolean; police: boolean | null } = { versionFfmpeg: null, libass: false, police: null };
  private reveil: (() => void) | null = null;

  /** Prépare la file (rien ne démarre avant `demarrer`). */
  constructor(private readonly d: DependancesFile) {
    this.budget = d.budget ?? accesBudgetSupabase(d.db);
  }

  /** Démarre les boucles de travail et les travaux périodiques. */
  async demarrer(): Promise<void> {
    const c = this.d.config;
    this.outils = { versionFfmpeg: await versionOutil(c.ffmpeg), libass: await aLibass(c.ffmpeg), police: await policePresente(c.police) };
    if (!this.outils.versionFfmpeg) journal("attention", `ffmpeg introuvable (${c.ffmpeg}) : les rendus échoueront. Lance « npm run diagnostic ».`);
    else if (!this.outils.libass) journal("attention", "ffmpeg sans libass : les sous-titres ne pourront pas être incrustés.");
    if (this.outils.police === false) journal("attention", `police « ${c.police} » introuvable : les sous-titres japonais et coréens risquent d'être illisibles.`);
    journal("info", `worker « ${c.nom} » démarré : ${c.concurrence} tâche(s) à la fois, dossier ${c.dossierTemp}`);

    this.periodique("battement", INTERVALLES.battement, () => this.battement(), true);
    this.periodique("libération", INTERVALLES.liberation, () => this.liberer(), true);
    this.periodique("planificateur", INTERVALLES.planificateur, () => this.planifier(), true);
    this.periodique("statistiques", INTERVALLES.verificationStats, () => this.programmerStats(), true);
    for (let i = 0; i < c.concurrence; i++) this.boucles.push(this.boucle(i + 1));
  }

  /** Arrêt propre : plus de nouvelle tâche, interruption des tâches en cours (remises en file), attente bornée. */
  async arreter(delaiMaxMs = 25_000): Promise<void> {
    if (this.arret.signal.aborted) return;
    journal("info", "arrêt demandé : les tâches en cours seront reprises au prochain démarrage");
    this.arret.abort(new ErreurArret());
    this.reveil?.();
    for (const m of this.minuteurs) clearInterval(m);
    const delai = new Promise<void>((r) => setTimeout(r, delaiMaxMs).unref());
    await Promise.race([Promise.allSettled(this.boucles), delai]);
    // Tâches qui n'ont pas rendu la main à temps : remises en file directement.
    for (const t of this.enCours.values()) await this.terminer(t, { statut: "en_file", erreur: null }).catch(() => undefined);
    await ecrire(this.d.db.from("workers_etat").update({ vu_le: new Date().toISOString(), infos: this.infos("arrêté") }).eq("nom", this.d.config.nom), "état du worker").catch(() => undefined);
  }

  /** Lance un travail périodique sans chevauchement ; une erreur est journalisée sans arrêter le worker. */
  private periodique(nom: string, ms: number, travail: () => Promise<void>, immediat: boolean): void {
    let occupe = false;
    const tour = async (): Promise<void> => {
      if (occupe || this.arret.signal.aborted) return;
      occupe = true;
      try {
        await travail();
      } catch (e) {
        journal("erreur", `${nom} : ${messageErreur(e)}`);
      } finally {
        occupe = false;
      }
    };
    if (immediat) void tour();
    this.minuteurs.push(setInterval(() => void tour(), ms));
  }

  /** Attente interrompue par l'arrêt ou par un réveil. */
  private dormir(ms: number): Promise<void> {
    const signal = this.arret.signal;
    return new Promise((r) => {
      const m = setTimeout(fin, ms);
      signal.addEventListener("abort", fin, { once: true });
      this.reveil = fin;
      function fin(): void {
        clearTimeout(m);
        // Retirer l'écouteur évite d'en accumuler un par attente (fuite et avertissement de Node).
        signal.removeEventListener("abort", fin);
        r();
      }
    });
  }

  /** Une boucle de travail : prend une tâche, l'exécute, recommence. */
  private async boucle(n: number): Promise<void> {
    while (!this.arret.signal.aborted) {
      let tache: Tache | null = null;
      try {
        tache = await this.prendre();
      } catch (e) {
        journal("erreur", `prise de tâche impossible : ${messageErreur(e)}`, `boucle ${n}`);
        // Base injoignable : on patiente plus longtemps pour ne pas inonder le journal.
        await this.dormir(INTERVALLES.attenteErreur);
        continue;
      }
      if (!tache) {
        await this.dormir(INTERVALLES.attenteFileVide);
        continue;
      }
      await this.traiter(tache);
    }
  }

  /** Prend la prochaine tâche disponible (verrou posé par la fonction SQL, sans conflit entre workers). */
  private async prendre(): Promise<Tache | null> {
    const { data, error } = await this.d.db.rpc("prendre_tache", { p_worker: this.d.config.nom, p_types: null });
    if (error) throw new Error(error.message);
    const rangs = Array.isArray(data) ? (data as Tache[]) : [];
    return rangs[0] ?? null;
  }

  /** Exécute une tâche et enregistre son issue. */
  async traiter(tache: Tache): Promise<void> {
    const etiquette = `${tache.type} ${tache.id.slice(0, 8)}`;
    this.enCours.set(tache.id, tache);
    const { ctx, nettoyer } = creerContexte(
      { db: this.d.db, config: this.d.config, stockage: this.d.stockage, cleMaitre: this.d.cleMaitre, signal: this.arret.signal, f: this.d.f, plafondAtteint: (e) => plafondAtteint(this.budget, e) },
      tache,
    );
    const debut = Date.now();
    try {
      if (estPayante(tache.type) && (await plafondAtteint(this.budget, tache.espace_id))) throw new ErreurPlafond();
      const executant = this.d.executants?.[tache.type] ?? EXECUTANTS[tache.type];
      journal("info", "début", etiquette);
      await executant(ctx);
      await this.terminer(tache, null);
      journal("info", `terminée en ${Math.round((Date.now() - debut) / 1000)} s`, etiquette);
    } catch (e) {
      const issue = issueErreur(e, tache, this.arret.signal.aborted);
      journal(issue.statut === "echec" ? "erreur" : "attention", `${issue.statut} : ${issue.statut === "annulee" ? "annulée depuis l'interface" : (issue.erreur ?? messageErreur(e))}`, etiquette);
      await this.terminer(tache, issue).catch((err: unknown) => journal("erreur", `issue non enregistrée : ${messageErreur(err)}`, etiquette));
    } finally {
      this.enCours.delete(tache.id);
      await nettoyer().catch(() => undefined);
    }
  }

  /** Enregistre la fin d'une tâche (succès si `issue` est null). Ne touche pas une tâche annulée entre-temps. */
  private async terminer(tache: Tache, issue: Issue | null): Promise<void> {
    if (issue?.statut === "annulee") return;
    const maintenant = new Date().toISOString();
    const valeurs: Record<string, unknown> =
      issue === null
        ? { statut: "terminee", erreur: null }
        : issue.statut === "en_file"
          ? { statut: "en_file", erreur: issue.erreur, ...(issue.executerApres ? { executer_apres: issue.executerApres.toISOString() } : {}) }
          : { statut: issue.statut, erreur: issue.erreur };
    await ecrire(
      this.d.db
        .from("taches")
        .update({ ...valeurs, verrouille_par: null, verrouille_le: null, modifie_le: maintenant })
        .eq("id", tache.id)
        .eq("statut", "en_cours"),
      "fin de tâche",
    );
  }

  /** Informations publiées dans workers_etat. */
  private infos(etat: string): Record<string, unknown> {
    return {
      etat,
      version_worker: VERSION_WORKER,
      libass: this.outils.libass,
      police: this.d.config.police,
      police_presente: this.outils.police,
      concurrence: this.d.config.concurrence,
      taches_en_cours: [...this.enCours.values()].map((t) => ({ id: t.id, type: t.type })),
    };
  }

  /** Battement de cœur : l'interface sait que le worker tourne et ce qu'il sait faire. */
  private async battement(): Promise<void> {
    await ecrire(
      this.d.db.from("workers_etat").upsert({ nom: this.d.config.nom, vu_le: new Date().toISOString(), version_ffmpeg: this.outils.versionFfmpeg, infos: this.infos("actif") }, { onConflict: "nom" }),
      "battement de cœur",
    );
    // Rafraîchit le verrou des tâches en cours : une tâche longue (film, gros envoi) n'est jamais
    // prise pour une tâche abandonnée par liberer_taches_bloquees, donc jamais relancée ni payée deux fois.
    const ids = [...this.enCours.keys()];
    if (ids.length) {
      await ecrire(this.d.db.from("taches").update({ verrouille_le: new Date().toISOString() }).in("id", ids).eq("verrouille_par", this.d.config.nom), "verrou des tâches en cours");
    }
  }

  /** Remet en file les tâches d'un worker arrêté en plein travail. */
  private async liberer(): Promise<void> {
    const { data, error } = await this.d.db.rpc("liberer_taches_bloquees");
    if (error) throw new Error(error.message);
    const n = Number(data ?? 0);
    if (n > 0) journal("attention", `${n} tâche(s) bloquée(s) remise(s) en file`);
  }

  /** Passage du planificateur. */
  private async planifier(): Promise<void> {
    const b = await planifier(accesPlanificateurSupabase(this.d.db, this.budget));
    if (b.tachesCreees || b.publiees || b.reprises) {
      journal("info", `planificateur : ${b.tachesCreees} publication(s) lancée(s), ${b.publiees} marquée(s) publiée(s), ${b.reprises} tâche(s) reprise(s)`);
      this.reveil?.();
    }
  }

  /** Crée une tâche « stats » par espace qui a des comptes connectés, au plus une toutes les 6 heures. */
  private async programmerStats(): Promise<void> {
    const comptes = await lignes<{ espace_id: string }>(this.d.db.from("reseaux_connectes").select("espace_id").eq("statut", "connecte"), "comptes connectés");
    const espaces = [...new Set(comptes.map((c) => c.espace_id))];
    if (espaces.length === 0) return;
    const depuis = new Date(Date.now() - INTERVALLES.periodeStats).toISOString();
    const recentes = await lignes<{ espace_id: string; statut: string; cree_le: string }>(
      this.d.db.from("taches").select("espace_id, statut, cree_le").eq("type", "stats").in("espace_id", espaces).or(`cree_le.gte."${depuis}",statut.in.(${STATUTS_ACTIFS.join(",")})`),
      "tâches stats récentes",
    );
    const deja = new Set(recentes.map((t) => t.espace_id));
    const aCreer = espaces.filter((e) => !deja.has(e));
    if (aCreer.length === 0) return;
    await ecrire(this.d.db.from("taches").insert(aCreer.map((e) => ({ espace_id: e, type: "stats", priorite: -5, donnees: { automatique: true } }))), "tâches stats");
    journal("info", `${aCreer.length} synchronisation(s) de statistiques programmée(s)`);
  }
}
