// Connexion OAuth des réseaux (YouTube, Instagram, TikTok) : URL d'autorisation, échange du code, renouvellement, identité.
import type { AppOAuth, Reseau } from "@feuilleton/core";
import { z } from "zod";
import { ErreurApi, type ContratIntegrations, type Fetch, type JetonsOAuth } from "./contrat";
import { appelJson, erreurReponseInvalide, lireJson, requete, erreurDepuisReponse } from "./http";

/** Version de l'API Graph d'Instagram utilisée par défaut (surchargée par INSTAGRAM_API_VERSION). */
export const VERSION_INSTAGRAM_DEFAUT = "v25.0";

/** Version de l'API Instagram : variable d'environnement INSTAGRAM_API_VERSION si présente, sinon la valeur par défaut. */
export function versionInstagram(): string {
  const v = typeof process !== "undefined" ? process.env.INSTAGRAM_API_VERSION : undefined;
  return v && /^v\d+\.\d+$/.test(v) ? v : VERSION_INSTAGRAM_DEFAUT;
}

/** Adresses OAuth et d'identité de chaque réseau. */
export const URLS_OAUTH = {
  youtube: {
    autorisation: "https://accounts.google.com/o/oauth2/v2/auth",
    jeton: "https://oauth2.googleapis.com/token",
    identite: "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
  },
  instagram: {
    autorisation: "https://www.instagram.com/oauth/authorize",
    jeton: "https://api.instagram.com/oauth/access_token",
    longueDuree: "https://graph.instagram.com/access_token",
    renouvellement: "https://graph.instagram.com/refresh_access_token",
    graph: "https://graph.instagram.com",
  },
  tiktok: {
    autorisation: "https://www.tiktok.com/v2/auth/authorize/",
    jeton: "https://open.tiktokapis.com/v2/oauth/token/",
    identite: "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
  },
} as const;

/** Droits demandés à chaque réseau. */
export const SCOPES = {
  youtube: [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    // Revenus et statistiques détaillées (YouTube Analytics).
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
  ].join(" "),
  instagram: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
  // user.info.stats : abonnés, j'aime et nombre de vidéos du compte.
  tiktok: "user.info.basic,user.info.stats,video.publish,video.list",
} as const;

/** Nom du fournisseur dans les messages d'erreur. */
export const NOMS_FOURNISSEURS: Record<Reseau, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };

/** Identité d'un compte connecté. */
export type IdentiteCompte = { idExterne: string; nomCompte: string; infos: Record<string, unknown> };

/** Identifiant numérique ou texte, ramené à du texte. */
const schemaId = z.union([z.string(), z.number()]).transform(String);

const schemaJetonGoogle = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

const schemaChaines = z.object({
  items: z.array(z.object({ id: z.string(), snippet: z.object({ title: z.string() }).partial().optional() })).optional(),
});

/** Jeton court d'Instagram : documenté à plat ou dans une liste `data` selon les versions. */
const schemaJetonCourtInstagram = z.union([
  z.object({ access_token: z.string().min(1), user_id: schemaId, permissions: z.union([z.string(), z.array(z.string())]).optional() }),
  z
    .object({ data: z.array(z.object({ access_token: z.string().min(1), user_id: schemaId, permissions: z.union([z.string(), z.array(z.string())]).optional() })).min(1) })
    .transform((d) => d.data[0] as { access_token: string; user_id: string; permissions?: string | string[] }),
]);

const schemaJetonLongInstagram = z.object({ access_token: z.string().min(1), expires_in: z.number().optional() });

const schemaMoiInstagram = z.object({ user_id: schemaId.optional(), id: schemaId.optional(), username: z.string().optional() });

/** Réponse jeton de TikTok : en cas d'erreur, TikTok peut répondre 200 avec un champ `error`. */
const schemaJetonTiktok = z.object({
  access_token: z.string().optional(),
  expires_in: z.number().optional(),
  open_id: z.string().optional(),
  refresh_token: z.string().optional(),
  refresh_expires_in: z.number().optional(),
  scope: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const schemaInfoTiktok = z.object({
  data: z.object({ user: z.object({ open_id: z.string().optional(), display_name: z.string().optional() }).optional() }).optional(),
  error: z.object({ code: z.string(), message: z.string().optional() }).optional(),
});

/** Date d'expiration à partir d'une durée en secondes. */
function expiration(secondes: number | undefined, maintenant = Date.now()): Date | null {
  return typeof secondes === "number" && secondes > 0 ? new Date(maintenant + secondes * 1000) : null;
}

/** Corps de formulaire « application/x-www-form-urlencoded ». */
function formulaire(champs: Record<string, string>): { headers: Record<string, string>; body: string } {
  return { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(champs).toString() };
}

/** Adresse de la page d'autorisation du réseau, vers laquelle on redirige l'utilisateur. */
export const urlAutorisation: ContratIntegrations["urlAutorisation"] = (reseau, app, redirectUri, state) => {
  switch (reseau) {
    case "youtube":
      return `${URLS_OAUTH.youtube.autorisation}?${new URLSearchParams({
        client_id: app.client_id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPES.youtube,
        access_type: "offline",
        // prompt=consent garantit un refresh_token, même si l'utilisateur a déjà autorisé l'application.
        prompt: "consent",
        include_granted_scopes: "true",
        state,
      }).toString()}`;
    case "instagram":
      return `${URLS_OAUTH.instagram.autorisation}?${new URLSearchParams({
        client_id: app.client_id,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPES.instagram,
        state,
      }).toString()}`;
    case "tiktok":
      return `${URLS_OAUTH.tiktok.autorisation}?${new URLSearchParams({
        client_key: app.client_id,
        scope: SCOPES.tiktok,
        response_type: "code",
        redirect_uri: redirectUri,
        state,
      }).toString()}`;
  }
};

/** Identité de la chaîne YouTube du jeton. */
export async function identiteYoutube(jeton: string, f: Fetch = fetch): Promise<IdentiteCompte> {
  const rep = await appelJson(f, "YouTube", URLS_OAUTH.youtube.identite, { headers: { Authorization: `Bearer ${jeton}` } }, schemaChaines, [jeton]);
  const chaine = rep.items?.[0];
  if (!chaine) throw new ErreurApi("YouTube", 404, "aucune chaîne YouTube sur ce compte Google : crée d'abord une chaîne", "sans_chaine");
  return { idExterne: chaine.id, nomCompte: chaine.snippet?.title ?? chaine.id, infos: {} };
}

/** Identité du compte Instagram professionnel du jeton. */
export async function identiteInstagram(jeton: string, f: Fetch = fetch, version = versionInstagram()): Promise<IdentiteCompte> {
  const url = `${URLS_OAUTH.instagram.graph}/${version}/me?${new URLSearchParams({ fields: "user_id,username", access_token: jeton }).toString()}`;
  const rep = await appelJson(f, "Instagram", url, { method: "GET" }, schemaMoiInstagram, [jeton]);
  const id = rep.user_id ?? rep.id;
  if (!id) throw erreurReponseInvalide("Instagram", "identifiant du compte absent");
  return { idExterne: id, nomCompte: rep.username ?? id, infos: { username: rep.username ?? null } };
}

/** Identité du compte TikTok du jeton. */
export async function identiteTiktok(jeton: string, f: Fetch = fetch): Promise<IdentiteCompte> {
  const rep = await appelJson(f, "TikTok", URLS_OAUTH.tiktok.identite, { headers: { Authorization: `Bearer ${jeton}` } }, schemaInfoTiktok, [jeton]);
  if (rep.error && rep.error.code !== "ok") throw new ErreurApi("TikTok", 400, rep.error.message ?? rep.error.code, rep.error.code);
  const u = rep.data?.user;
  if (!u?.open_id) throw erreurReponseInvalide("TikTok", "open_id absent");
  return { idExterne: u.open_id, nomCompte: u.display_name ?? u.open_id, infos: { display_name: u.display_name ?? null } };
}

/** Identité du compte d'un réseau, à partir de son jeton d'accès. */
export async function identite(reseau: Reseau, jeton: string, f: Fetch = fetch): Promise<IdentiteCompte> {
  if (reseau === "youtube") return identiteYoutube(jeton, f);
  if (reseau === "instagram") return identiteInstagram(jeton, f);
  return identiteTiktok(jeton, f);
}

/** Appel du point jeton de TikTok, qui peut signaler une erreur avec un statut 200. */
async function jetonTiktok(champs: Record<string, string>, f: Fetch, secrets: string[]): Promise<z.infer<typeof schemaJetonTiktok>> {
  const rep = await requete(f, "TikTok", URLS_OAUTH.tiktok.jeton, { method: "POST", ...formulaire(champs) });
  if (!rep.ok) throw await erreurDepuisReponse("TikTok", rep, secrets);
  const corps = await lireJson("TikTok", rep, schemaJetonTiktok);
  if (corps.error || !corps.access_token) {
    throw new ErreurApi("TikTok", 400, corps.error_description ?? corps.error ?? "jeton absent de la réponse", corps.error ?? "jeton_absent");
  }
  return corps;
}

/** Échange le code reçu au retour de l'autorisation contre des jetons, puis lit l'identité du compte. */
export const echangerCode: ContratIntegrations["echangerCode"] = async (reseau, app, redirectUri, code, f = fetch) => {
  const secrets = [app.client_secret, code];
  if (reseau === "youtube") {
    const j = await appelJson(
      f,
      "YouTube",
      URLS_OAUTH.youtube.jeton,
      { method: "POST", ...formulaire({ code, client_id: app.client_id, client_secret: app.client_secret, redirect_uri: redirectUri, grant_type: "authorization_code" }) },
      schemaJetonGoogle,
      secrets,
    );
    const id = await identiteYoutube(j.access_token, f);
    return { acces: j.access_token, renouvellement: j.refresh_token ?? null, expireLe: expiration(j.expires_in), ...id, infos: { ...id.infos, scope: j.scope ?? null } } satisfies JetonsOAuth;
  }
  if (reseau === "instagram") {
    const court = await appelJson(
      f,
      "Instagram",
      URLS_OAUTH.instagram.jeton,
      { method: "POST", ...formulaire({ client_id: app.client_id, client_secret: app.client_secret, grant_type: "authorization_code", redirect_uri: redirectUri, code }) },
      schemaJetonCourtInstagram,
      secrets,
    );
    // Le jeton court ne dure qu'une heure : on l'échange tout de suite contre un jeton de 60 jours.
    const urlLong = `${URLS_OAUTH.instagram.longueDuree}?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: app.client_secret, access_token: court.access_token }).toString()}`;
    const long = await appelJson(f, "Instagram", urlLong, { method: "GET" }, schemaJetonLongInstagram, [...secrets, court.access_token]);
    const id = await identiteInstagram(long.access_token, f);
    const permissions = Array.isArray(court.permissions) ? court.permissions.join(",") : (court.permissions ?? null);
    return { acces: long.access_token, renouvellement: null, expireLe: expiration(long.expires_in), ...id, infos: { ...id.infos, permissions } } satisfies JetonsOAuth;
  }
  const j = await jetonTiktok(
    { client_key: app.client_id, client_secret: app.client_secret, code, grant_type: "authorization_code", redirect_uri: redirectUri },
    f,
    secrets,
  );
  const acces = j.access_token ?? "";
  const id = await identiteTiktok(acces, f);
  return {
    acces,
    renouvellement: j.refresh_token ?? null,
    expireLe: expiration(j.expires_in),
    ...id,
    infos: { ...id.infos, scope: j.scope ?? null, renouvellement_expire_le: expiration(j.refresh_expires_in)?.toISOString() ?? null },
  } satisfies JetonsOAuth;
};

/** Renouvelle un jeton d'accès (Google et TikTok : par le jeton de renouvellement ; Instagram : par le jeton lui-même). */
export const renouvelerJeton: ContratIntegrations["renouvelerJeton"] = async (reseau, app, jetons, f = fetch) => {
  if (reseau === "youtube") {
    if (!jetons.renouvellement) throw new ErreurApi("YouTube", 401, "aucun jeton de renouvellement : reconnecte le compte", "sans_renouvellement");
    const j = await appelJson(
      f,
      "YouTube",
      URLS_OAUTH.youtube.jeton,
      { method: "POST", ...formulaire({ client_id: app.client_id, client_secret: app.client_secret, refresh_token: jetons.renouvellement, grant_type: "refresh_token" }) },
      schemaJetonGoogle,
      [app.client_secret, jetons.renouvellement, jetons.acces],
    );
    // Google ne renvoie généralement pas de nouveau refresh_token : on garde l'ancien.
    return { acces: j.access_token, renouvellement: j.refresh_token ?? jetons.renouvellement, expireLe: expiration(j.expires_in) };
  }
  if (reseau === "instagram") {
    const url = `${URLS_OAUTH.instagram.renouvellement}?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: jetons.acces }).toString()}`;
    const j = await appelJson(f, "Instagram", url, { method: "GET" }, schemaJetonLongInstagram, [jetons.acces]);
    return { acces: j.access_token, renouvellement: null, expireLe: expiration(j.expires_in) };
  }
  if (!jetons.renouvellement) throw new ErreurApi("TikTok", 401, "aucun jeton de renouvellement : reconnecte le compte", "sans_renouvellement");
  const j = await jetonTiktok(
    { client_key: app.client_id, client_secret: app.client_secret, grant_type: "refresh_token", refresh_token: jetons.renouvellement },
    f,
    [app.client_secret, jetons.renouvellement, jetons.acces],
  );
  return { acces: j.access_token ?? "", renouvellement: j.refresh_token ?? jetons.renouvellement, expireLe: expiration(j.expires_in) };
};

/** Vrai si une erreur signifie que le jeton est invalide ou expiré (il faut reconnecter le compte). */
export function estErreurJeton(e: unknown): boolean {
  if (!(e instanceof ErreurApi)) return false;
  if (e.statut === 401) return true;
  // Instagram / Meta : code 190 = jeton invalide ou expiré ; TikTok : access_token_invalid ; Google : invalid_grant.
  return e.code === "190" || e.code === "access_token_invalid" || e.code === "invalid_grant";
}

/** Marge avant expiration à partir de laquelle on renouvelle le jeton, par réseau. */
export function margeRenouvellementMs(reseau: Reseau): number {
  // Instagram : jeton de 60 jours, renouvelable seulement s'il a plus de 24 h ; on renouvelle à 7 jours de la fin.
  if (reseau === "instagram") return 7 * 24 * 3600_000;
  return 10 * 60_000;
}

/** Vrai si le jeton doit être renouvelé maintenant (expiré ou bientôt expiré). */
export function doitRenouveler(reseau: Reseau, expireLe: Date | null, maintenant: Date = new Date()): boolean {
  if (!expireLe) return false;
  return expireLe.getTime() - maintenant.getTime() <= margeRenouvellementMs(reseau);
}

/** Paire identifiant/secret d'application attendue pour un réseau (clé « google », « meta » ou « tiktok »). */
export function fournisseurApp(reseau: Reseau): "google" | "meta" | "tiktok" {
  return reseau === "youtube" ? "google" : reseau === "instagram" ? "meta" : "tiktok";
}

/** Type de l'application OAuth (identifiant et secret), réexporté pour les appelants. */
export type { AppOAuth };
