"use client";
// Choix de la voix d'un personnage : bibliothèque ElevenLabs, voix clonée (avec accord obligatoire) ou audio Grok.
import { VOIX_GROK, VOIX_GROK_DEFAUT } from "@studio-video-ia/core";
import { useState } from "react";

/** Voix proposée par ElevenLabs. */
export type OptionVoix = { id: string; nom: string; categorie: string };

/** Champs « source de la voix », « voix » et « accord » d'un formulaire de personnage. */
export function ChoixVoix({
  prefixe,
  source,
  voixId,
  accord,
  voix,
}: {
  prefixe: string;
  source: "elevenlabs" | "elevenlabs_clone" | "grok";
  voixId: string;
  accord: boolean;
  /** Voix de la bibliothèque, ou null si la clé ElevenLabs manque (saisie libre de l'ID). */
  voix: OptionVoix[] | null;
}) {
  const [choix, setChoix] = useState(source);
  const bibliotheque = voix?.filter((v) => v.categorie !== "cloned") ?? null;
  const clonees = voix?.filter((v) => v.categorie === "cloned") ?? null;
  const liste = choix === "elevenlabs" ? bibliotheque : choix === "elevenlabs_clone" ? clonees : null;
  return (
    <div className="pile pile--serree">
      <div className="ligne ligne--bas">
        <div className="champ">
          <label className="etiquette" htmlFor={`${prefixe}-src`}>
            Voix
          </label>
          <select id={`${prefixe}-src`} name="source_voix" value={choix} onChange={(e) => setChoix(e.target.value === "grok" ? "grok" : e.target.value === "elevenlabs_clone" ? "elevenlabs_clone" : "elevenlabs")}>
            <option value="elevenlabs">ElevenLabs · bibliothèque</option>
            <option value="elevenlabs_clone">ElevenLabs · voix clonée</option>
            <option value="grok">Grok · voix dans le clip (lèvres synchronisées)</option>
          </select>
        </div>
        {choix !== "grok" ? (
          <div className="champ">
            <label className="etiquette" htmlFor={`${prefixe}-voix`}>
              {liste && liste.length ? "Voix ElevenLabs" : "ID de la voix ElevenLabs"}
            </label>
            {liste && liste.length ? (
              <select id={`${prefixe}-voix`} name="voix_id" defaultValue={voixId}>
                <option value="">À choisir</option>
                {liste.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nom}
                  </option>
                ))}
                {voixId && !liste.some((v) => v.id === voixId) ? <option value={voixId}>{voixId}</option> : null}
              </select>
            ) : (
              <input id={`${prefixe}-voix`} name="voix_id" type="text" defaultValue={voixId} placeholder={choix === "elevenlabs_clone" ? "Créée après l’import des échantillons" : "Ex. : 21m00Tcm4TlvDq8ikWAM"} />
            )}
          </div>
        ) : (
          <div className="champ">
            <label className="etiquette" htmlFor={`${prefixe}-grok`}>
              Voix Grok
            </label>
            <select id={`${prefixe}-grok`} name="voix_id" defaultValue={voixId in VOIX_GROK ? voixId : VOIX_GROK_DEFAUT}>
              {Object.entries(VOIX_GROK).map(([id, nom]) => (
                <option key={id} value={id}>
                  {nom}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {choix === "elevenlabs_clone" ? (
        <label className="case">
          <input type="checkbox" name="accord_clone" defaultChecked={accord} required />
          <span>J’ai l’accord de la personne dont la voix est clonée</span>
        </label>
      ) : (
        <input type="hidden" name="accord_clone" value={accord ? "on" : ""} />
      )}
      <p className="tres-petit doux">{choix === "grok" ? "Grok fait parler le personnage dans le clip avec cette voix, dans la langue d’origine." : "Parle FR · EN · JA · KO · PT."}</p>
    </div>
  );
}
