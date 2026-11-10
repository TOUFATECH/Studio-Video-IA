// Lecture d'un média par adresse signée (« /api/medias/<chemin>?e=<expiration>&s=<signature> »).
// Sans session : la signature, liée au chemin et limitée dans le temps, suffit (Instagram télécharge ainsi les vidéos).
// Gère les plages d'octets (Range) pour que les vidéos se lisent et se parcourent dans le navigateur.
import { Readable } from "node:stream";
import { typeDepuisChemin } from "@studio-video-ia/base";
import { type NextRequest, NextResponse } from "next/server";
import { base } from "@/lib/bdd";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Analyse « bytes=debut-fin » ; null si absent ou invalide. */
function plage(entete: string | null, taille: number): { debut: number; fin: number } | null {
  const m = entete ? /^bytes=(\d*)-(\d*)$/.exec(entete.trim()) : null;
  if (!m) return null;
  let debut = m[1] ? Number(m[1]) : NaN;
  let fin = m[2] ? Number(m[2]) : taille - 1;
  if (Number.isNaN(debut)) {
    // « bytes=-500 » : les 500 derniers octets.
    debut = Math.max(0, taille - fin);
    fin = taille - 1;
  }
  if (debut > fin || debut >= taille) return null;
  return { debut, fin: Math.min(fin, taille - 1) };
}

/** Sert le fichier demandé si la signature est valide. */
export async function GET(requete: NextRequest, { params }: { params: Promise<{ chemin: string[] }> }) {
  const { chemin: morceaux } = await params;
  const chemin = morceaux.map((m) => decodeURIComponent(m)).join("/");
  const { depot } = await base();
  const u = requete.nextUrl;
  if (!depot.verifier(chemin, u.searchParams.get("e"), u.searchParams.get("s"))) return new NextResponse("Lien expiré ou invalide.", { status: 403 });
  const taille = await depot.taille(chemin);
  if (taille === null) return new NextResponse("Fichier introuvable.", { status: 404 });
  const entetes: Record<string, string> = {
    "content-type": typeDepuisChemin(chemin),
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  };
  const p = plage(requete.headers.get("range"), taille);
  if (requete.headers.get("range") && !p) return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${taille}` } });
  const flux = depot.flux(chemin, p ?? undefined);
  const corps = Readable.toWeb(flux) as ReadableStream<Uint8Array>;
  if (p) {
    return new NextResponse(corps, { status: 206, headers: { ...entetes, "content-range": `bytes ${p.debut}-${p.fin}/${taille}`, "content-length": String(p.fin - p.debut + 1) } });
  }
  return new NextResponse(corps, { status: 200, headers: { ...entetes, "content-length": String(taille) } });
}
