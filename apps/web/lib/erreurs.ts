// Erreur métier affichée telle quelle à l'utilisateur, et conversion des autres erreurs en message lisible.

/** Erreur dont le message est destiné à l'utilisateur. */
export class ErreurUtilisateur extends Error {
  /** Crée une erreur au message affichable. */
  constructor(message: string) {
    super(message);
    this.name = "ErreurUtilisateur";
  }
}

/** Message à afficher pour une erreur quelconque (sans détail technique sensible). */
export function messageErreur(e: unknown): string {
  if (e instanceof ErreurUtilisateur) return e.message;
  if (e instanceof Error && /manquante|non implémenté/i.test(e.message)) return e.message;
  console.error(e);
  return "Quelque chose n’a pas marché. Réessaie, ou ouvre la page Diagnostic.";
}
