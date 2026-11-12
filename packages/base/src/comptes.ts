// Comptes utilisateurs gérés par l'application : mot de passe haché (scrypt, sel unique),
// sessions par jeton aléatoire dont seule l'empreinte est gardée en base (un vol de la base ne donne pas de session).
import { createHash, randomBytes, scrypt as scryptRappel, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { ErreurSql, type Moteur } from "./moteur";

/** scrypt en promesse. */
function scrypt(motDePasse: string, sel: Buffer, longueur: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((ok, ko) => scryptRappel(motDePasse, sel, longueur, options, (e, cle) => (e ? ko(e) : ok(cle))));
}

/** Réglages de scrypt (environ 50 ms par vérification). */
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
/** Durée d'une session : 30 jours. */
export const DUREE_SESSION_MS = 30 * 24 * 3600 * 1000;
/** Longueur minimale d'un mot de passe. */
export const MOT_DE_PASSE_MIN = 10;

/** Utilisateur connecté. */
export type Utilisateur = { id: string; email: string };

/** Hache un mot de passe : « scrypt$N$r$p$sel$empreinte » (base64url). */
export async function hacherMotDePasse(motDePasse: string): Promise<string> {
  const sel = randomBytes(16);
  const empreinte = await scrypt(motDePasse, sel, 32, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, sel.toString("base64url"), empreinte.toString("base64url")].join("$");
}

/** Vérifie un mot de passe en temps constant. */
export async function verifierMotDePasse(motDePasse: string, stocke: string): Promise<boolean> {
  const [algo, n, r, p, sel, empreinte] = stocke.split("$");
  if (algo !== "scrypt" || !sel || !empreinte) return false;
  const attendue = Buffer.from(empreinte, "base64url");
  const calculee = await scrypt(motDePasse, Buffer.from(sel, "base64url"), attendue.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return calculee.length === attendue.length && timingSafeEqual(calculee, attendue);
}

/** Empreinte d'un jeton de session (c'est elle qui est stockée). */
export function empreinteJeton(jeton: string): string {
  return createHash("sha256").update(jeton).digest("hex");
}

/** Adresse e-mail normalisée. */
function normaliserEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Crée un compte. Refuse une adresse déjà utilisée ou un mot de passe trop court. */
export async function creerUtilisateur(m: Moteur, email: string, motDePasse: string): Promise<Utilisateur> {
  const e = normaliserEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ErreurSql("Adresse e-mail invalide.", "22023");
  if (motDePasse.length < MOT_DE_PASSE_MIN) throw new ErreurSql(`Mot de passe trop court : ${MOT_DE_PASSE_MIN} caractères minimum.`, "22023");
  const [deja] = await m.lire(`select id from utilisateurs where lower(email) = ?`, [e]);
  if (deja) throw new ErreurSql("Un compte existe déjà avec cette adresse.", "23505");
  const id = crypto.randomUUID();
  await m.executer(`insert into utilisateurs (id, email, mot_de_passe, cree_le) values (?, ?, ?, ?)`, [id, e, await hacherMotDePasse(motDePasse), new Date().toISOString()]);
  return { id, email: e };
}

/** Vérifie l'adresse et le mot de passe ; null si l'un des deux est faux (sans dire lequel). */
export async function verifierIdentifiants(m: Moteur, email: string, motDePasse: string): Promise<Utilisateur | null> {
  const [l] = await m.lire(`select id, email, mot_de_passe from utilisateurs where lower(email) = ?`, [normaliserEmail(email)]);
  // Sans compte, on calcule quand même une empreinte : le temps de réponse ne révèle pas si l'adresse existe.
  const stocke = typeof l?.mot_de_passe === "string" ? l.mot_de_passe : "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const ok = await verifierMotDePasse(motDePasse, stocke);
  return ok && l ? { id: String(l.id), email: String(l.email) } : null;
}

/** Ouvre une session : renvoie le jeton à mettre dans le cookie (jamais stocké en clair). */
export async function ouvrirSession(m: Moteur, utilisateurId: string): Promise<{ jeton: string; expire: Date }> {
  const jeton = randomBytes(32).toString("base64url");
  const expire = new Date(Date.now() + DUREE_SESSION_MS);
  await m.executer(`insert into sessions (id, utilisateur_id, expire_le, cree_le) values (?, ?, ?, ?)`, [empreinteJeton(jeton), utilisateurId, expire.toISOString(), new Date().toISOString()]);
  // Ménage des sessions expirées de tout le monde.
  await m.executer(`delete from sessions where expire_le < ?`, [new Date().toISOString()]);
  return { jeton, expire };
}

/** Utilisateur d'un jeton de session valide, ou null. */
export async function utilisateurDeSession(m: Moteur, jeton: string | undefined | null): Promise<Utilisateur | null> {
  if (!jeton || jeton.length < 20 || jeton.length > 200) return null;
  const [l] = await m.lire(
    `select u.id, u.email from sessions s join utilisateurs u on u.id = s.utilisateur_id where s.id = ? and s.expire_le > ?`,
    [empreinteJeton(jeton), new Date().toISOString()],
  );
  return l ? { id: String(l.id), email: String(l.email) } : null;
}

/** Ferme une session. */
export async function fermerSession(m: Moteur, jeton: string | undefined | null): Promise<void> {
  if (jeton) await m.executer(`delete from sessions where id = ?`, [empreinteJeton(jeton)]);
}

/** Change le mot de passe et ferme toutes les autres sessions. */
export async function changerMotDePasse(m: Moteur, utilisateurId: string, nouveau: string): Promise<void> {
  if (nouveau.length < MOT_DE_PASSE_MIN) throw new ErreurSql(`Mot de passe trop court : ${MOT_DE_PASSE_MIN} caractères minimum.`, "22023");
  await m.executer(`update utilisateurs set mot_de_passe = ? where id = ?`, [await hacherMotDePasse(nouveau), utilisateurId]);
  await m.executer(`delete from sessions where utilisateur_id = ?`, [utilisateurId]);
}

/** Nombre de comptes (le premier peut toujours être créé, même inscriptions fermées). */
export async function nombreUtilisateurs(m: Moteur): Promise<number> {
  const [l] = await m.lire(`select count(*) as n from utilisateurs`);
  return Number(l?.n ?? 0);
}

/** État de la double authentification d'un utilisateur : secret chiffré (ou null) et activation. */
export async function lireTotp(moteur: Moteur, utilisateurId: string): Promise<{ chiffre: string | null; actif: boolean }> {
  const [l] = await moteur.lire(`select totp_chiffre, totp_actif from utilisateurs where id = ?`, [utilisateurId]);
  return { chiffre: typeof l?.totp_chiffre === "string" ? l.totp_chiffre : null, actif: l?.totp_actif === true || Number(l?.totp_actif) === 1 };
}

/** Enregistre le secret chiffré (null pour l'effacer) et l'activation de la double authentification. */
export async function enregistrerTotp(moteur: Moteur, utilisateurId: string, chiffre: string | null, actif: boolean): Promise<void> {
  const valeur = moteur.dialecte === "sqlite" ? (actif ? 1 : 0) : actif;
  await moteur.executer(`update utilisateurs set totp_chiffre = ?, totp_actif = ? where id = ?`, [chiffre, valeur, utilisateurId]);
}
