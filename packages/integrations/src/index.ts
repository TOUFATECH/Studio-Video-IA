// Point d'entrée de @feuilleton/integrations.
// Provisoire : les fonctions du contrat lèvent « non implémenté » tant que le lot worker ne les a pas écrites.
import type { ContratIntegrations } from "./contrat";

export * from "./contrat";

/** Erreur provisoire, remplacée par les vraies implémentations. */
function nonImplemente(nom: string): never {
  throw new Error(`${nom} : non implémenté`);
}

export const urlAutorisation: ContratIntegrations["urlAutorisation"] = () => nonImplemente("urlAutorisation");
export const echangerCode: ContratIntegrations["echangerCode"] = async () => nonImplemente("echangerCode");
export const renouvelerJeton: ContratIntegrations["renouvelerJeton"] = async () => nonImplemente("renouvelerJeton");
export const testerOpenAI: ContratIntegrations["testerOpenAI"] = async () => nonImplemente("testerOpenAI");
export const testerXai: ContratIntegrations["testerXai"] = async () => nonImplemente("testerXai");
export const testerElevenLabs: ContratIntegrations["testerElevenLabs"] = async () => nonImplemente("testerElevenLabs");
export const testerCompte: ContratIntegrations["testerCompte"] = async () => nonImplemente("testerCompte");
export const listerVoix: ContratIntegrations["listerVoix"] = async () => nonImplemente("listerVoix");
