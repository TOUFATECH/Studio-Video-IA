// Diagnostic : configuration, base, stockage, worker, clés, comptes connectés, quotas, et test complet de la chaîne.
import { LANGUES, NOMS_LANGUES } from "@studio-video-ia/core";
import type { Metadata } from "next";
import { lancerTestComplet } from "@/app/actions/diagnostic";
import { RafraichissementDirect } from "@/components/RafraichissementDirect";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Jauge, Pastille, Puce } from "@/components/ui/elements";
import { verifierCles, verifierComptes, verifierEnv, verifierQuotas, verifierSupabase, verifierWorkers, type Verification } from "@/lib/diagnostic";
import { supabaseConfigure } from "@/lib/env";
import { chargerEspaces } from "@/lib/espace-courant";
import { dureeLisible, ilYa } from "@/lib/format";
import { ligneFichier, lignes, ligneTache, schemaEtapesTest } from "@/lib/lignes";
import { urlsSignees } from "@/lib/medias";
import { utilisateur } from "@/lib/session";
import { z } from "zod";

export const metadata: Metadata = { title: "Diagnostic" };
export const dynamic = "force-dynamic";

/** Tableau des vérifications, groupées. */
function Tableau({ verifs }: { verifs: Verification[] }) {
  const groupes = [...new Set(verifs.map((v) => v.groupe))];
  return (
    <>
      {groupes.map((g) => (
        <section key={g} aria-label={g} className="carte">
          <h2 className="h2">{g}</h2>
          <ul className="liste-nue">
            {verifs
              .filter((v) => v.groupe === g)
              .map((v) => (
                <li key={v.nom} className="liste-ligne liste-ligne--haut">
                  <Pastille ton={v.ok ? "succes" : "erreur"} />
                  <div className="extensible">
                    <p className="petit gras">{v.nom}</p>
                    <p className="tres-petit doux">{v.detail}</p>
                    {v.aFaire ? <p className="tres-petit texte-attention">{v.aFaire}</p> : null}
                  </div>
                  <Puce ton={v.ok ? "succes" : "erreur"}>{v.ok ? "OK" : "Échec"}</Puce>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** Page Diagnostic. */
export default async function PageDiagnostic() {
  const env = verifierEnv();
  if (!supabaseConfigure()) {
    return (
      <div className="pile pile--large">
        <header>
          <p className="surtitre">Studio Vidéo IA</p>
          <h1 className="h1">Diagnostic</h1>
          <p className="petit doux marge-haut">Supabase n’est pas configuré : complète les variables ci-dessous, puis redémarre l’app.</p>
        </header>
        <Tableau verifs={env} />
      </div>
    );
  }
  const { supabase, user } = await utilisateur();
  const espaces = await chargerEspaces();
  const ids = espaces.map((e) => e.id);
  const groupes = await Promise.all([verifierSupabase(supabase), verifierWorkers(supabase), verifierCles(user.id), verifierComptes(user.id, ids), verifierQuotas(supabase, ids)]);
  const verifs = [...env, ...groupes.flat()];
  const echecs = verifs.filter((v) => !v.ok).length;

  // Dernier test complet et son rendu.
  const test = lignes(ligneTache, (await supabase.from("taches").select("*").eq("type", "test_complet").in("espace_id", ids).order("cree_le", { ascending: false }).limit(1)).data, "taches")[0];
  const etapes = test ? schemaEtapesTest.parse(test.progression.etapes) : [];
  const cheminProgression = test ? z.string().optional().catch(undefined).parse(test.progression.rendu ?? test.progression.rendu_chemin) : undefined;
  let cheminRendu = cheminProgression;
  if (test && !cheminRendu && test.statut === "terminee") {
    // Sinon : rendu sans épisode créé dans l'espace après le lancement du test.
    const f = lignes(ligneFichier, (await supabase.from("fichiers").select("*").eq("espace_id", test.espace_id).eq("genre", "rendu").is("episode_id", null).gte("cree_le", test.cree_le).order("cree_le", { ascending: false }).limit(1)).data, "fichiers")[0];
    cheminRendu = f?.chemin ?? undefined;
  }
  const urlRendu = cheminRendu ? (await urlsSignees([cheminRendu])).get(cheminRendu) : undefined;
  const actif = !!test && (test.statut === "en_file" || test.statut === "en_cours");
  const fait = test?.progression.fait ?? etapes.filter((e) => e.ok || e.statut === "ok").length;
  const total = test?.progression.total ?? etapes.length;

  return (
    <div className="pile pile--large">
      <RafraichissementDirect actif={actif} />
      <header className="ligne ligne--entre ligne--bas">
        <div>
          <p className="surtitre">Réglages</p>
          <h1 className="h1">Diagnostic</h1>
        </div>
        <Puce ton={echecs ? "erreur" : "succes"}>{echecs ? `${echecs} point${echecs > 1 ? "s" : ""} à corriger` : "Tout est prêt"}</Puce>
      </header>

      <section aria-labelledby="test-h" className="carte pile">
        <div>
          <h2 id="test-h" className="h2">
            Test complet de la chaîne
          </h2>
          <p className="tres-petit doux">Coût : quelques centimes (1 image, 1 clip de 2 s, 1 voix). Vérifie aussi le montage ffmpeg avec les sous-titres choisis.</p>
        </div>
        <form action={lancerTestComplet} className="ligne ligne--bas">
          <div className="champ">
            <label className="etiquette" htmlFor="t-espace">
              Compte (budget)
            </label>
            <select id="t-espace" name="espace_id" defaultValue={espaces[0]?.id}>
              {espaces.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nom}
                </option>
              ))}
            </select>
          </div>
          <div className="champ">
            <label className="etiquette" htmlFor="t-st">
              Sous-titres du rendu de test
            </label>
            <select id="t-st" name="sous_titres" defaultValue="fr">
              <option value="aucun">Pas de sous-titres</option>
              {LANGUES.map((l) => (
                <option key={l} value={l}>
                  {NOMS_LANGUES[l]}
                </option>
              ))}
            </select>
          </div>
          <BoutonEnvoi variante="principal" desactive={actif}>
            Lancer le test complet
          </BoutonEnvoi>
        </form>
        {test ? (
          <div className="pile pile--serree">
            <p className="petit">
              Dernier test : <strong>{test.statut === "terminee" ? "réussi" : test.statut === "echec" ? "en échec" : test.statut === "en_cours" ? "en cours" : test.statut === "en_file" ? "en file" : test.statut}</strong> · lancé {ilYa(test.cree_le)}
              {test.progression.secondes ? ` · ${dureeLisible(test.progression.secondes)}` : ""}
            </p>
            <Jauge pourcentage={total ? (100 * fait) / total : test.statut === "terminee" ? 100 : 0} ton={test.statut === "echec" ? "erreur" : "info"} libelle="Progression du test" />
            {test.progression.etape ? <p className="tres-petit doux">{test.progression.etape}</p> : null}
            <ul className="liste-nue">
              {etapes.map((e) => {
                const ok = e.ok === true || e.statut === "ok" || e.statut === "terminee";
                const ko = e.ok === false || e.statut === "echec";
                return (
                  <li key={e.nom} className="liste-ligne">
                    <Pastille ton={ok ? "succes" : ko ? "erreur" : "neutre"} />
                    <span className="petit extensible">{e.nom}</span>
                    {e.message ? <span className="tres-petit doux">{e.message}</span> : null}
                    {e.secondes ? <span className="tres-petit mono doux">{dureeLisible(e.secondes)}</span> : null}
                  </li>
                );
              })}
            </ul>
            {test.erreur ? (
              <p className="bandeau bandeau--erreur" role="alert">
                {test.erreur}
              </p>
            ) : null}
            {urlRendu ? <video src={urlRendu} controls preload="metadata" playsInline style={{ width: "100%", maxWidth: 320, aspectRatio: "9 / 16" }} aria-label="Rendu du test complet" /> : null}
          </div>
        ) : null}
      </section>

      <Tableau verifs={verifs} />
    </div>
  );
}
