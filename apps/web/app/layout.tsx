// Layout racine : polices IBM Plex (téléchargées au build, servies par le site), thème, styles globaux.
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import "../styles/main.scss";

const texte = IBM_Plex_Sans({ subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"], variable: "--police-texte", display: "swap" });
const titre = IBM_Plex_Sans_Condensed({ subsets: ["latin", "latin-ext"], weight: ["500", "600"], variable: "--police-titre", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--police-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Feuilleton", template: "%s · Feuilleton" },
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
