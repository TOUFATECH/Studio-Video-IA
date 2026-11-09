// Petits éléments d'interface partagés : puce de statut, jauge, badge de réseau, pastille.
import { NOMS_RESEAUX, type Reseau, type Ton } from "@feuilleton/core";
import type { CSSProperties, ReactNode } from "react";

/** Puce de statut colorée selon le ton sémantique. */
export function Puce({ ton = "neutre", children }: { ton?: Ton | "accent"; children: ReactNode }) {
  return <span className={`puce puce--${ton}`}>{children}</span>;
}

/** Pastille ronde (le sens est toujours redit par un texte à côté). */
export function Pastille({ ton = "neutre" }: { ton?: Ton | "accent" }) {
  return <span className={`pastille pastille--${ton}`} aria-hidden="true" />;
}

/** Pastille à la couleur d'un espace (couleur choisie par l'utilisateur, stockée en base). */
export function PastilleEspace({ couleur }: { couleur: string }) {
  const style = { "--couleur-espace": couleur } as CSSProperties;
  return <span className="pastille pastille--espace" style={style} aria-hidden="true" />;
}

/** Jauge de progression (0 à 100). */
export function Jauge({ pourcentage, ton, epaisse, libelle }: { pourcentage: number; ton?: "info" | "succes" | "attention" | "erreur"; epaisse?: boolean; libelle?: string }) {
  const p = Math.max(0, Math.min(100, Math.round(pourcentage)));
  return (
    <span className={`jauge${epaisse ? " jauge--epaisse" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={libelle ?? "Progression"}>
      <span className={`jauge__barre${ton ? ` jauge__barre--${ton}` : ""}`} style={{ width: `${p}%` }} />
    </span>
  );
}

/** Abréviations des réseaux dans les badges. */
const COURTS: Record<Reseau, string> = { tiktok: "TT", instagram: "IG", youtube: "YT" };

/** Badge d'un réseau, avec le nom complet pour les lecteurs d'écran. */
export function BadgeReseau({ reseau }: { reseau: Reseau }) {
  return (
    <span className={`badge-reseau badge-reseau--${reseau}`} title={NOMS_RESEAUX[reseau]}>
      <span aria-hidden="true">{COURTS[reseau]}</span>
      <span className="invisible">{NOMS_RESEAUX[reseau]}</span>
    </span>
  );
}

/** Carte de chiffre clé. */
export function Kpi({ libelle, valeur, detail, children }: { libelle: string; valeur: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="carte">
      <p className="etiquette">{libelle}</p>
      <p className="mono kpi__valeur">{valeur}</p>
      {detail ? <p className="tres-petit doux">{detail}</p> : null}
      {children}
    </div>
  );
}
