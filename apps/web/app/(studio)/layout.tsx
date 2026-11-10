// Coquille des pages connectées : barre du haut (compte, générations, Nouveau), menu latéral, notifications.
import { NOMS_RESEAUX, schemaReseau } from "@studio-video-ia/core";
import Link from "next/link";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { z } from "zod";
import { MenuLateral } from "@/components/coquille/MenuLateral";
import { MenuNouveau } from "@/components/coquille/MenuNouveau";
import { Notifications } from "@/components/coquille/Notifications";
import { SelecteurEspace, type OptionEspace } from "@/components/coquille/SelecteurEspace";
import styles from "@/components/coquille/coquille.module.scss";
import { Logo } from "@/components/ui/Icone";
import { construireAFaire } from "@/lib/a-faire";
import { chargerProduction } from "@/lib/donnees";
import { codeEpisode, lienEpisode, nomEpisode } from "@/lib/episodes";
import { COOKIE_FLASH, decoderFlash } from "@/lib/flash";
import { ligne, ligneEpisode, ligneSaison, ligneSerie } from "@/lib/lignes";
import { id as schemaId } from "@/lib/schemas";
import { initialiserCompte, utilisateur } from "@/lib/session";

/** Cookie posé par la page épisode pour la carte « Épisode ouvert ». */
const COOKIE_EPISODE = "episode_ouvert";

/** Carte de l'épisode ouvert en dernier (relu avec les droits de l’utilisateur). */
async function episodeOuvert(brut: string | undefined) {
  const r = schemaId.safeParse(brut);
  if (!r.success) return null;
  const { db } = await utilisateur();
  const ep = ligne(ligneEpisode, (await db.from("episodes").select("*").eq("id", r.data).maybeSingle()).data);
  if (!ep) return null;
  const [serie, saison] = await Promise.all([
    db.from("series").select("*").eq("id", ep.serie_id).maybeSingle().then((x) => ligne(ligneSerie, x.data)),
    db.from("saisons").select("*").eq("id", ep.saison_id).maybeSingle().then((x) => ligne(ligneSaison, x.data)),
  ]);
  if (!serie) return null;
  return { lien: lienEpisode(ep), titre: nomEpisode(ep, saison ?? undefined), detail: `${serie.nom} · ${codeEpisode(ep, saison ?? undefined)}`, serie: serie.genre === "serie" ? { id: serie.id, nom: serie.nom } : null };
}

/** Coquille commune. */
export default async function LayoutStudio({ children }: { children: ReactNode }) {
  const { db, user } = await utilisateur();
  const magasin = await cookies();
  let prod = await chargerProduction();
  if (!prod.portee.espaces.length) {
    // Premier passage sans espace (ex. compte créé en ligne de commande) : on prépare le compte puis on recharge.
    await initialiserCompte(db);
    prod = await chargerProduction();
  }
  const { portee } = prod;
  const aFaire = construireAFaire({ ...prod, espaces: portee.courant ? [portee.courant] : portee.espaces });
  const enCours = prod.taches.filter((t) => t.statut === "en_cours").length;
  const enFile = prod.taches.filter((t) => t.statut === "en_file").length;
  const ouvert = await episodeOuvert(magasin.get(COOKIE_EPISODE)?.value);

  // Résumé de chaque espace (toutes portées confondues) pour le menu : nombre de séries et réseaux.
  const [rSeries, rReseaux] = await Promise.all([db.from("series").select("espace_id"), db.from("reseaux_connectes").select("espace_id, reseau")]);
  const resume = z.array(z.object({ espace_id: z.string(), reseau: schemaReseau.optional() }));
  const seriesToutes = resume.catch([]).parse(rSeries.data);
  const reseauxTous = resume.catch([]).parse(rReseaux.data);
  /** Résumé des réseaux d'un espace : « TikTok · YouTube ». */
  const reseauxDe = (espaceId: string) => {
    const noms = [...new Set(reseauxTous.filter((r) => r.espace_id === espaceId && r.reseau).map((r) => (r.reseau ? NOMS_RESEAUX[r.reseau] : "")))];
    return noms.join(" · ") || "aucun réseau";
  };
  const options: OptionEspace[] = [
    { id: "tous", nom: "Tous mes comptes", detail: `${portee.espaces.length} compte${portee.espaces.length > 1 ? "s" : ""} · vue d’ensemble`, couleur: null },
    ...portee.espaces.map((e) => {
      const n = seriesToutes.filter((s) => s.espace_id === e.id).length;
      return { id: e.id, nom: e.nom, detail: `${n} série${n > 1 ? "s" : ""} · ${reseauxDe(e.id)}`, couleur: e.couleur };
    }),
  ];

  return (
    <>
      <a href="#contenu" className="invisible">
        Aller au contenu
      </a>
      <header className={styles.barre}>
        <Link href="/" className={styles.marque}>
          <Logo />
          <span>Studio Vidéo IA</span>
        </Link>
        <SelecteurEspace options={options} courant={portee.cle} />
        <span className={styles.espaceur} />
        <Link href="/" className="btn btn--discret" aria-label={`Générations : ${enCours} en cours, ${enFile} en attente`}>
          <span className={`pastille ${enCours ? "pastille--info" : ""}`} aria-hidden="true" />
          <span className="petit">{enCours ? `${enCours} en génération${enFile ? ` · ${enFile} en file` : ""}` : enFile ? `${enFile} en file` : "Aucune génération"}</span>
        </Link>
        <MenuNouveau serie={ouvert?.serie ?? null} />
      </header>
      <div className={styles.corps}>
        <MenuLateral aFaire={aFaire.length} episodeOuvert={ouvert ? { lien: ouvert.lien, titre: ouvert.titre, detail: ouvert.detail } : null} />
        <main id="contenu" className={styles.principal}>
          <div className={styles.contenu}>{children}</div>
        </main>
      </div>
      <Notifications flash={decoderFlash(magasin.get(COOKIE_FLASH)?.value)} />
    </>
  );
}
