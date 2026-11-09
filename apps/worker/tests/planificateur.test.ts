// Tests du planificateur avec un faux accès base : tâches de publication à l'heure, sans doublon, reprise des pauses.
import { describe, expect, it } from "vitest";
import { deciderPublications, planifier, type AccesPlanificateur, type PublicationAPlanifier } from "../src/planificateur";

const MAINTENANT = new Date("2026-11-09T18:00:00Z");

/** Fabrique une publication programmée. */
function pub(id: string, reseau: PublicationAPlanifier["reseau"], programmee_le: string, extra: Partial<PublicationAPlanifier> = {}): PublicationAPlanifier {
  return { id, episode_id: "ep", espace_id: "esp", reseau, statut: "programmee", programmee_le, id_externe: null, ...extra };
}

/** Faux accès en mémoire qui enregistre les actions. */
function fauxAcces(publications: PublicationAPlanifier[], actives: string[] = [], pauses: { id: string; espace_id: string }[] = [], depenses: Record<string, number> = {}) {
  const creees: string[] = [];
  const publiees: string[] = [];
  const reprises: string[] = [];
  const tachesActives = new Set(actives);
  const acces: AccesPlanificateur = {
    maintenant: () => MAINTENANT,
    publicationsProgrammees: async () => publications,
    publicationsAvecTacheActive: async (ids) => new Set(ids.filter((i) => tachesActives.has(i))),
    creerTachePublication: async (p) => {
      creees.push(p.id);
      tachesActives.add(p.id);
    },
    marquerPubliee: async (p) => void publiees.push(p.id),
    tachesEnPause: async () => pauses,
    remettreEnFile: async (ids) => void reprises.push(...ids),
    depenseDuMois: async (e) => depenses[e] ?? 0,
    plafond: async () => 50,
  };
  return { acces, creees, publiees, reprises };
}

describe("décisions de publication", () => {
  it("YouTube sans id_externe : tâche tout de suite, même si la date est lointaine", () => {
    const d = deciderPublications([pub("y", "youtube", "2026-12-01T00:00:00Z")], new Set(), MAINTENANT);
    expect(d.aCreer.map((p) => p.id)).toEqual(["y"]);
  });
  it("Instagram et TikTok : seulement à l'heure", () => {
    const d = deciderPublications([pub("i-tot", "instagram", "2026-11-09T17:59:00Z"), pub("i-tard", "instagram", "2026-11-09T18:05:00Z"), pub("t", "tiktok", "2026-11-09T18:00:00Z")], new Set(), MAINTENANT);
    expect(d.aCreer.map((p) => p.id)).toEqual(["i-tot", "t"]);
  });
  it("YouTube déjà envoyé et date passée : marqué publié, sans tâche", () => {
    const d = deciderPublications([pub("y1", "youtube", "2026-11-09T17:00:00Z", { id_externe: "vid" }), pub("y2", "youtube", "2026-11-10T17:00:00Z", { id_externe: "vid2" })], new Set(), MAINTENANT);
    expect(d.aMarquerPubliees.map((p) => p.id)).toEqual(["y1"]);
    expect(d.aCreer).toEqual([]);
  });
  it("jamais deux tâches pour la même publication", () => {
    const p = pub("t", "tiktok", "2026-11-09T10:00:00Z");
    expect(deciderPublications([p], new Set(["t"]), MAINTENANT).aCreer).toEqual([]);
    // Même publication présente deux fois dans le lot : une seule tâche.
    expect(deciderPublications([p, p], new Set(), MAINTENANT).aCreer).toHaveLength(1);
  });
  it("ignore les publications qui ne sont pas « programmee »", () => {
    expect(deciderPublications([pub("x", "tiktok", "2026-11-09T10:00:00Z", { statut: "envoi" })], new Set(), MAINTENANT).aCreer).toEqual([]);
  });
});

describe("passage du planificateur", () => {
  it("crée les tâches dues, marque les YouTube publiées, et ne recrée rien au passage suivant", async () => {
    const f = fauxAcces([pub("i", "instagram", "2026-11-09T17:00:00Z"), pub("y", "youtube", "2026-11-20T00:00:00Z"), pub("y-env", "youtube", "2026-11-09T12:00:00Z", { id_externe: "abc" })]);
    expect(await planifier(f.acces)).toEqual({ tachesCreees: 2, publiees: 1, reprises: 0 });
    expect(f.creees).toEqual(["i", "y"]);
    expect(f.publiees).toEqual(["y-env"]);
    await planifier(f.acces);
    expect(f.creees).toEqual(["i", "y"]);
  });
  it("reprend les tâches en pause des espaces sous le plafond seulement", async () => {
    const f = fauxAcces([], [], [{ id: "t1", espace_id: "pauvre" }, { id: "t2", espace_id: "ok" }, { id: "t3", espace_id: "ok" }], { pauvre: 50, ok: 12 });
    const b = await planifier(f.acces);
    expect(b.reprises).toBe(2);
    expect(f.reprises).toEqual(["t2", "t3"]);
  });
});
