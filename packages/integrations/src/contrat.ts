// Contrat public utilisé par l'app web : connexion OAuth des réseaux, tests des clés, liste des voix.
// Les signatures ci-dessous sont figées : l'implémentation les remplit sans les changer.
import type { AppOAuth, Reseau } from "@feuilleton/core";

/** Fonction fetch injectable, pour les tests (par défaut : fetch global). */
export type Fetch = typeof fetch;

/** Jetons et identité obtenus après la connexion d'un compte. */
export type JetonsOAuth = {
  acces: string;
  renouvellement: string | null;
  expireLe: Date | null;
  idExterne: string;
  nomCompte: string;
  infos: Record<string, unknown>;
};

/** Résultat d'un test de clé ou de compte, affiché dans la page Diagnostic. */
export type ResultatTest = { ok: boolean; message: string; details?: Record<string, unknown> };

/** Voix disponible chez ElevenLabs. */
export type VoixElevenLabs = { id: string; nom: string; categorie: string };

/** Erreur d'API avec le statut HTTP et le message du fournisseur, sans jamais inclure de clé. */
export class ErreurApi extends Error {
  /** Crée une erreur lisible : « Instagram 400 : message du fournisseur ». */
  constructor(
    public readonly fournisseur: string,
    public readonly statut: number,
    message: string,
    public readonly code?: string,
  ) {
    super(`${fournisseur} ${statut} : ${message}`);
    this.name = "ErreurApi";
  }
}

/** Signatures attendues (implémentées dans oauth.ts, diagnostic.ts et elevenlabs.ts). */
export type ContratIntegrations = {
  urlAutorisation: (reseau: Reseau, app: AppOAuth, redirectUri: string, state: string) => string;
  echangerCode: (reseau: Reseau, app: AppOAuth, redirectUri: string, code: string, f?: Fetch) => Promise<JetonsOAuth>;
  renouvelerJeton: (
    reseau: Reseau,
    app: AppOAuth,
    jetons: { acces: string; renouvellement: string | null },
    f?: Fetch,
  ) => Promise<{ acces: string; renouvellement: string | null; expireLe: Date | null }>;
  testerOpenAI: (cle: string, f?: Fetch) => Promise<ResultatTest>;
  testerXai: (cle: string, f?: Fetch) => Promise<ResultatTest>;
  testerElevenLabs: (cle: string, f?: Fetch) => Promise<ResultatTest>;
  testerCompte: (reseau: Reseau, jetonAcces: string, idExterne: string | null, f?: Fetch) => Promise<ResultatTest>;
  listerVoix: (cle: string, f?: Fetch) => Promise<VoixElevenLabs[]>;
};
