// Espace (« compte ») choisi dans le sélecteur du haut, mémorisé dans le cookie « espace » (un id ou « tous »).
import "server-only";
import type { Espace } from "@feuilleton/core";
import { cookies } from "next/headers";
import { cache } from "react";
import { ligneEspace, lignes } from "./lignes";
import { utilisateur } from "./session";

/** Nom du cookie du sélecteur d'espace. */
export const COOKIE_ESPACE = "espace";

/** Espaces de l'utilisateur, du plus ancien au plus récent. */
export const chargerEspaces = cache(async (): Promise<Espace[]> => {
  const { supabase } = await utilisateur();
  const { data } = await supabase.from("espaces").select("*").order("cree_le");
  return lignes(ligneEspace, data, "espaces");
});

/** Portée affichée : un espace précis ou « tous ». */
export type Portee = { espaces: Espace[]; courant: Espace | null; ids: string[]; cle: string };

/** Lit le cookie et renvoie la portée ; un id inconnu retombe sur « tous ». */
export const porteeCourante = cache(async (): Promise<Portee> => {
  const espaces = await chargerEspaces();
  const brut = (await cookies()).get(COOKIE_ESPACE)?.value;
  const courant = espaces.find((e) => e.id === brut) ?? null;
  return { espaces, courant, ids: courant ? [courant.id] : espaces.map((e) => e.id), cle: courant?.id ?? "tous" };
});

/** Fuseau de référence : celui de l'espace choisi, sinon du premier espace. */
export function fuseauReference(p: Portee): string {
  return p.courant?.fuseau ?? p.espaces[0]?.fuseau ?? "Europe/Paris";
}
