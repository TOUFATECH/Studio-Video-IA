// Page de connexion : e-mail et mot de passe. Sur un studio neuf, elle propose de créer le premier compte.
import { nombreUtilisateurs } from "@studio-video-ia/base";
import type { Metadata } from "next";
import { inscriptionOuverte } from "@/app/actions/session";
import { Logo } from "@/components/ui/Icone";
import { base } from "@/lib/bdd";
import { parametre } from "@/lib/schemas";
import { FormulairesConnexion } from "./FormulairesConnexion";
import styles from "./connexion.module.scss";

export const metadata: Metadata = { title: "Connexion" };
export const dynamic = "force-dynamic";

/** Écran de connexion. */
export default async function PageConnexion({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const premier = (await nombreUtilisateurs((await base()).moteur)) === 0;
  return (
    <main className={styles.page}>
      <div className={styles.boite}>
        <p className={styles.marque}>
          <Logo />
          <span className="h2">Studio Vidéo IA</span>
        </p>
        <h1 className="h1">{premier ? "Bienvenue" : "Connexion"}</h1>
        <p className="petit doux">
          {premier ? "Studio tout neuf : crée ton compte pour commencer. Tout reste sur ta machine." : "Ton studio de séries et de clips : scénario, images, vidéos, voix, montage et publication."}
        </p>
        <FormulairesConnexion suite={parametre(p.suite) ?? "/"} creation={premier} inscriptionPossible={await inscriptionOuverte()} />
      </div>
    </main>
  );
}
