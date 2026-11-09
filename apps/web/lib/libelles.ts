// Libellés et tons des statuts affichés (publications, tâches, comptes).
import { LANGUES, NOMS_LANGUES, type Langue, type Publication, type ReseauConnecte, type Ton } from "@feuilleton/core";

/** Libellé et ton d'une publication. */
export function statutPublication(p: Pick<Publication, "statut" | "progression">): { texte: string; ton: Ton } {
  switch (p.statut) {
    case "attend_rendu":
      return { texte: "Attend le rendu", ton: "secondaire" };
    case "programmee":
      return { texte: "Programmé", ton: "info" };
    case "envoi":
      return { texte: `Envoi ${p.progression} %`, ton: "info" };
    case "traitement":
      return { texte: "Traitement par le réseau", ton: "info" };
    case "publiee":
      return { texte: "Publié", ton: "succes" };
    case "privee":
      return { texte: "Publié en privé", ton: "attention" };
    case "echec":
      return { texte: "Échec", ton: "erreur" };
    case "annulee":
      return { texte: "Annulé", ton: "neutre" };
  }
}

/** Libellé et ton de l'état d'un compte connecté. */
export function statutCompte(r: Pick<ReseauConnecte, "statut" | "reseau" | "audit_tiktok_valide">): { texte: string; ton: Ton } {
  if (r.statut === "expire") return { texte: "Reconnexion requise", ton: "erreur" };
  if (r.statut === "deconnecte") return { texte: "Déconnecté", ton: "neutre" };
  if (r.reseau === "tiktok" && !r.audit_tiktok_valide) return { texte: "Privé (audit)", ton: "attention" };
  return { texte: "Connecté", ton: "succes" };
}

/** Options de langue pour un <select>. */
export const OPTIONS_LANGUES: { valeur: Langue; libelle: string }[] = LANGUES.map((l) => ({ valeur: l, libelle: NOMS_LANGUES[l] }));

/** Langues en majuscules : « FR · EN ». */
export function languesCourtes(langues: readonly Langue[]): string {
  return langues.map((l) => l.toUpperCase()).join(" · ");
}
