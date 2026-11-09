"use client";
// Affiche le message éphémère laissé par la dernière action, puis efface son cookie.
import { useEffect, useState } from "react";
import type { Flash } from "@/lib/flash";
import styles from "./coquille.module.scss";

/** Zone de notification (annoncée aux lecteurs d'écran). */
export function Notifications({ flash }: { flash: Flash | null }) {
  const [visible, setVisible] = useState<Flash | null>(flash);
  useEffect(() => {
    setVisible(flash);
    if (!flash) return;
    // Le cookie a servi : on l'efface pour ne pas réafficher le message à la page suivante.
    document.cookie = "flash=; Max-Age=0; path=/; SameSite=Lax";
    const minuteur = setTimeout(() => setVisible(null), 6000);
    return () => clearTimeout(minuteur);
  }, [flash]);
  return (
    <div className={styles.notifications} aria-live="polite" role="status">
      {visible ? (
        <div className={styles.notification}>
          <span className={`pastille pastille--${visible.ton}`} aria-hidden="true" />
          <span className="petit">{visible.texte}</span>
          <button type="button" className="btn btn--discret" onClick={() => setVisible(null)} aria-label="Fermer le message">
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
