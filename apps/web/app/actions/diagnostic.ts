"use server";
// Action du diagnostic : lancer le test complet (1 image, 1 clip de 2 s, 1 voix, rendu avec sous-titres).
import { executer } from "@/lib/action";
import { espaceAMoi } from "@/lib/appartenance";
import { ErreurUtilisateur } from "@/lib/erreurs";
import { formulaire, premiereErreur, schemaTestComplet } from "@/lib/schemas";
import { exigerMiseEnFile } from "@/lib/taches";

/** Met en file la tâche « test_complet » avec la langue de sous-titres choisie. */
export async function lancerTestComplet(fd: FormData): Promise<void> {
  await executer(async () => {
    const r = schemaTestComplet.safeParse(formulaire(fd));
    if (!r.success) throw new ErreurUtilisateur(premiereErreur(r.error));
    const espace = await espaceAMoi(r.data.espace_id);
    await exigerMiseEnFile({ espace_id: espace.id, type: "test_complet", donnees: { sous_titres: r.data.sous_titres }, priorite: 5 });
    return { message: "Test complet en file. Suis les étapes ci-dessous." };
  });
}
