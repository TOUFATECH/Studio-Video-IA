"use client";
// Mise à jour en direct : tant qu'une tâche est active, la page se recharge côté serveur toutes les 3 s.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Rafraîchit la route courante à intervalle régulier quand `actif` est vrai (et que l'onglet est visible). */
export function RafraichissementDirect({ actif, intervalleMs = 3000 }: { actif: boolean; intervalleMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!actif) return;
    const minuteur = setInterval(() => {
      // Inutile de solliciter le serveur pour un onglet caché.
      if (document.visibilityState === "visible") router.refresh();
    }, intervalleMs);
    return () => clearInterval(minuteur);
  }, [actif, intervalleMs, router]);
  return actif ? (
    <p className="invisible" aria-live="polite">
      Mise à jour automatique active.
    </p>
  ) : null;
}
