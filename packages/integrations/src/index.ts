// Point d'entrée de @studio-video-ia/integrations : le contrat public utilisé par l'app web et les clients des API externes.
export * from "./contrat";
export * from "./http";
export * from "./openai";
export * from "./xai";
export * from "./elevenlabs";
export * from "./oauth";
export * from "./youtube";
export * from "./instagram";
export * from "./tiktok";
export * from "./statistiques";
export * from "./diagnostic";

import type { ContratIntegrations } from "./contrat";
import { testerCompte, testerElevenLabs, testerOpenAI, testerXai } from "./diagnostic";
import { listerVoix } from "./elevenlabs";
import { echangerCode, renouvelerJeton, urlAutorisation } from "./oauth";

/** Vérification à la compilation : les fonctions exportées respectent le contrat figé utilisé par l'app web. */
const contratRespecte = { urlAutorisation, echangerCode, renouvelerJeton, testerOpenAI, testerXai, testerElevenLabs, testerCompte, listerVoix } satisfies ContratIntegrations;
void contratRespecte;
