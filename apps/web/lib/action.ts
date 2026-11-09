// Enveloppe commune des Server Actions : exécute, affiche un message, rafraîchit les pages.
import "server-only";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { messageErreur } from "./erreurs";
import { COOKIE_FLASH, encoderFlash, type Flash } from "./flash";

/** Écrit le message éphémère de la prochaine page. */
export async function flash(texte: string, ton: Flash["ton"] = "succes"): Promise<void> {
  (await cookies()).set(COOKIE_FLASH, encoderFlash({ texte, ton }), { path: "/", maxAge: 30, sameSite: "lax" });
}

/** Résultat d'une action : un message et, au besoin, une valeur (id créé…). */
export type ResultatAction<T> = { message?: string; ton?: Flash["ton"]; valeur?: T } | void;

/**
 * Exécute le corps d'une action. Une erreur devient un message rouge au lieu d'une page d'erreur ;
 * les redirections de Next sont relancées telles quelles. Renvoie la valeur éventuelle.
 */
export async function executer<T = never>(corps: () => Promise<ResultatAction<T>>): Promise<T | undefined> {
  let valeur: T | undefined;
  try {
    const r = await corps();
    if (r?.message) await flash(r.message, r.ton ?? "succes");
    valeur = r?.valeur;
  } catch (e) {
    unstable_rethrow(e);
    await flash(messageErreur(e), "erreur");
  }
  revalidatePath("/", "layout");
  return valeur;
}
