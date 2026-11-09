// Tests des clés API et des comptes connectés, pour la page Diagnostic et `npm run diagnostic`.
// Chaque test renvoie {ok, message} en français et ne lève jamais d'exception.
import type { ContratIntegrations, ResultatTest } from "./contrat";
import { ErreurApi } from "./contrat";
import { listerVoix, lireUtilisateurElevenLabs } from "./elevenlabs";
import { estErreurJeton, identite, NOMS_FOURNISSEURS } from "./oauth";
import { listerModelesOpenAI } from "./openai";
import { chiffresCompteTiktok, estScopeManquant } from "./statistiques";
import { listerModelesXai } from "./xai";

/** Message lisible pour une erreur pendant un test de clé. */
export function messageEchec(fournisseur: string, e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.statut === 401 || e.statut === 403) return `Clé ${fournisseur} refusée (${e.statut}) : vérifie-la ou crée-en une nouvelle, puis enregistre-la dans Réglages → Clés API.`;
    if (e.statut === 429) return `${fournisseur} limite les requêtes (429) ou le crédit est épuisé : vérifie la facturation de ton compte.`;
    if (e.statut === 0) return `${fournisseur} injoignable : vérifie la connexion internet du serveur (${e.message}).`;
    return `${fournisseur} a répondu ${e.statut} : ${e.message}`;
  }
  return `${fournisseur} : erreur inattendue (${e instanceof Error ? e.message : String(e)}).`;
}

/** Teste une clé OpenAI (liste des modèles). */
export const testerOpenAI: ContratIntegrations["testerOpenAI"] = async (cle, f = fetch) => {
  try {
    const modeles = await listerModelesOpenAI(cle, f);
    const images = modeles.filter((m) => m.includes("image"));
    return { ok: true, message: `Clé OpenAI valide : ${modeles.length} modèles accessibles${images.length ? `, dont ${images.slice(0, 3).join(", ")}` : ""}.`, details: { modeles: modeles.length, images } };
  } catch (e) {
    return { ok: false, message: messageEchec("OpenAI", e) };
  }
};

/** Teste une clé xAI (liste des modèles). */
export const testerXai: ContratIntegrations["testerXai"] = async (cle, f = fetch) => {
  try {
    const modeles = await listerModelesXai(cle, f);
    return { ok: true, message: `Clé xAI valide : ${modeles.length} modèles accessibles.`, details: { modeles } };
  } catch (e) {
    return { ok: false, message: messageEchec("xAI", e) };
  }
};

/** Teste une clé ElevenLabs (compte, puis liste des voix si la clé n'a pas le droit de lire le compte). */
export const testerElevenLabs: ContratIntegrations["testerElevenLabs"] = async (cle, f = fetch) => {
  try {
    const u = await lireUtilisateurElevenLabs(cle, f);
    const s = u.subscription;
    const reste = s?.character_limit != null && s.character_count != null ? s.character_limit - s.character_count : null;
    return {
      ok: true,
      message: `Clé ElevenLabs valide${s?.tier ? ` (offre ${s.tier})` : ""}${reste !== null ? ` : ${reste} caractères restants ce mois-ci` : ""}.`,
      details: { offre: s?.tier ?? null, caracteres_restants: reste },
    };
  } catch (e) {
    // Une clé restreinte peut ne pas avoir le droit « user_read » : on vérifie alors qu'elle sait lister les voix.
    if (e instanceof ErreurApi && e.statut === 401 && e.code === "missing_permissions") {
      try {
        const voix = await listerVoix(cle, f);
        return { ok: true, message: `Clé ElevenLabs valide (droits restreints) : ${voix.length} voix disponibles.` };
      } catch (e2) {
        return { ok: false, message: messageEchec("ElevenLabs", e2) };
      }
    }
    return { ok: false, message: messageEchec("ElevenLabs", e) };
  }
};

/** Teste le jeton d'un compte connecté (appel d'identité) et vérifie qu'il s'agit bien du même compte. */
export const testerCompte: ContratIntegrations["testerCompte"] = async (reseau, jetonAcces, idExterne, f = fetch): Promise<ResultatTest> => {
  const nom = NOMS_FOURNISSEURS[reseau];
  try {
    const id = await identite(reseau, jetonAcces, f);
    if (idExterne && id.idExterne !== idExterne) {
      return { ok: false, message: `Le jeton ${nom} correspond à un autre compte (${id.nomCompte}) : reconnecte le bon compte.`, details: { compte: id.nomCompte } };
    }
    if (reseau === "tiktok") {
      // Les statistiques du compte demandent l'autorisation user.info.stats, ajoutée après les premières connexions.
      try {
        await chiffresCompteTiktok(jetonAcces, f);
      } catch (e) {
        if (estScopeManquant(e)) {
          return { ok: false, message: `Compte TikTok « ${id.nomCompte} » connecté, mais l'autorisation des statistiques (user.info.stats) manque : reconnecte le compte.`, details: { compte: id.nomCompte, scope_manquant: "user.info.stats" } };
        }
        throw e;
      }
    }
    return { ok: true, message: `Compte ${nom} « ${id.nomCompte} » connecté.`, details: { compte: id.nomCompte, id: id.idExterne } };
  } catch (e) {
    if (estScopeManquant(e)) return { ok: false, message: `Autorisation ${nom} incomplète : reconnecte le compte pour accorder toutes les autorisations.` };
    if (estErreurJeton(e)) return { ok: false, message: `Jeton ${nom} expiré ou révoqué : reconnecte le compte dans Réglages → Réseaux.` };
    return { ok: false, message: messageEchec(nom, e) };
  }
};
