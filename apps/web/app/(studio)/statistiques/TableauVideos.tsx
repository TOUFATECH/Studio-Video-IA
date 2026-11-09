// Tableau de toutes les vidéos d'un ou plusieurs comptes, triable par date, vues, j'aime, engagement ou revenu.
import { NOMS_RESEAUX, type ReseauConnecte, type VideoReseau } from "@feuilleton/core";
import Link from "next/link";
import { compact, jourCourt, pourcent } from "@/lib/format";
import { engagement, trierVideos, type Sens, type TriVideos } from "@/lib/statistiques";
import styles from "./statistiques.module.scss";

/** Colonnes triables. */
const COLONNES: { cle: TriVideos; libelle: string }[] = [
  { cle: "date", libelle: "Date" },
  { cle: "vues", libelle: "Vues" },
  { cle: "jaime", libelle: "J’aime" },
  { cle: "engagement", libelle: "Engagement" },
  { cle: "revenu", libelle: "Revenu" },
];

/** Tableau des vidéos. `base` : URL de la page sans les paramètres de tri. */
export function TableauVideos({ videos, comptes, tri, sens, base, fuseau }: { videos: VideoReseau[]; comptes: ReseauConnecte[]; tri: TriVideos; sens: Sens; base: string; fuseau: string }) {
  const triees = trierVideos(videos, tri, sens);
  const noms = new Map(comptes.map((c) => [c.id, c]));
  /** Lien d'en-tête : même colonne → inverse le sens. */
  const lien = (cle: TriVideos) => `${base}&tri=${cle}&sens=${tri === cle && sens === "desc" ? "asc" : "desc"}`;
  return (
    <section aria-labelledby="videos-h" className="carte">
      <h2 id="videos-h" className="h2">
        Toutes les vidéos <span className="tres-petit doux">({videos.length})</span>
      </h2>
      <p className="tres-petit doux">Même celles publiées sans Feuilleton. Chiffres de la dernière synchronisation.</p>
      {videos.length === 0 ? (
        <p className="petit doux marge-haut">Aucune vidéo : lance une synchronisation.</p>
      ) : (
        <div className="defilement-x">
          <table className="tableau">
            <thead>
              <tr>
                <th scope="col">Vidéo</th>
                {COLONNES.map((c) => (
                  <th key={c.cle} scope="col" className={c.cle === "date" ? "" : "nombre"} aria-sort={tri === c.cle ? (sens === "asc" ? "ascending" : "descending") : "none"}>
                    <Link href={lien(c.cle)} className={styles.entete}>
                      {c.libelle}
                      {tri === c.cle ? (sens === "asc" ? " ↑" : " ↓") : ""}
                    </Link>
                  </th>
                ))}
                <th scope="col" className="nombre">
                  Comment.
                </th>
                <th scope="col">Publiée par Feuilleton</th>
              </tr>
            </thead>
            <tbody>
              {triees.map((v) => {
                const c = noms.get(v.reseau_connecte_id);
                return (
                  <tr key={v.id}>
                    <td>
                      <div className="ligne ligne--sans-retour">
                        <span className={styles.miniature}>{v.miniature_url ? <img src={v.miniature_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}</span>
                        <span className="pile pile--serree" style={{ gap: 2 }}>
                          {v.url ? (
                            <a href={v.url} target="_blank" rel="noopener noreferrer" className="petit">
                              {v.titre || "Sans titre"}
                            </a>
                          ) : (
                            <span className="petit">{v.titre || "Sans titre"}</span>
                          )}
                          <span className="tres-petit doux">{c ? `${NOMS_RESEAUX[c.reseau]} · ${c.nom_compte}` : ""}</span>
                        </span>
                      </div>
                    </td>
                    <td className="mono tres-petit">{v.publiee_le ? jourCourt(v.publiee_le, fuseau) : "—"}</td>
                    <td className="nombre">{compact(v.vues)}</td>
                    <td className="nombre">{compact(v.jaime)}</td>
                    <td className="nombre">{v.vues ? pourcent(engagement(v)) : "—"}</td>
                    <td className="nombre">{v.revenu_estime !== null ? `${v.revenu_estime.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${v.devise ?? ""}` : "—"}</td>
                    <td className="nombre">{compact(v.commentaires)}</td>
                    <td className="petit">{v.publication_id ? "Oui" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
