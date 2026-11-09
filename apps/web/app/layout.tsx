// Layout racine : polices IBM Plex (fichiers woff2 du dépôt, licence OFL, aucune requête externe), thème, styles globaux.
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import "../styles/main.scss";

// Polices rangées dans app/polices : le build marche sans internet et le site ne dépend d'aucun service tiers.
const texte = localFont({
  src: [
    { path: "./polices/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./polices/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./polices/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--police-texte",
  display: "swap",
});
const titre = localFont({
  src: [
    { path: "./polices/ibm-plex-sans-condensed-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./polices/ibm-plex-sans-condensed-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--police-titre",
  display: "swap",
});
const mono = localFont({
  src: [
    { path: "./polices/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./polices/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--police-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Studio Vidéo IA", template: "%s · Studio Vidéo IA" },
  description: "Studio de séries vidéo : scénario, images, clips, voix, montage et publication.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

/** Enveloppe HTML de toute l'app ; le thème vient du cookie « theme » (sombre par défaut). */
export default async function LayoutRacine({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get("theme")?.value === "clair" ? "clair" : "sombre";
  return (
    <html lang="fr" data-theme={theme} className={`${texte.variable} ${titre.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
