// Page de connexion : e-mail et mot de passe, ou lien magique envoyé par Supabase.
import type { Metadata } from "next";
import { Logo } from "@/components/ui/Icone";
import { parametre } from "@/lib/schemas";
import { FormulairesConnexion } from "./FormulairesConnexion";
import styles from "./connexion.module.scss";

export const metadata: Metadata = { title: "Connexion" };

/** Écran de connexion. */
export default async function PageConnexion({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const erreur = parametre(p.erreur);
  return (
    <main className={styles.page}>
      <div className={styles.boite}>
        <p className={styles.marque}>
          <Logo />
          <span className="h2">Studio Vidéo IA</span>
        </p>
        <h1 className="h1">Connexion</h1>
        <p className="petit doux">Ton studio de séries : scénario, images, clips, voix, montage et publication.</p>
        {erreur ? (
          <p className="bandeau bandeau--erreur" role="alert">
            Le lien de connexion n’a pas marché ou a expiré. Demande-en un nouveau.
          </p>
        ) : null}
        <FormulairesConnexion suite={parametre(p.suite) ?? "/"} />
      </div>
    </main>
  );
}
