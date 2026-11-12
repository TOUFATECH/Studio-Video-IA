import { CHAMPS_PLAN_DEFAUT } from "@studio-video-ia/core";
// Tests des choix liés au format : orientation des images et des clips, choix des plans pour les miniatures.
import type { Plan, TypePlan } from "@studio-video-ia/core";
import { describe, expect, it } from "vitest";
import { ratioClips } from "../src/taches/clips";
import { plansPourMiniatures } from "../src/taches/rendu";
import { tailleImage } from "../src/taches/storyboard";

/** Fabrique un plan minimal. */
function plan(id: string, type: TypePlan, position: number): Plan {
  return { id, episode_id: "e", position, section: "principal", type, texte: "", personnage_id: null, replique: "", repliques_traduites: {}, duree_fixee: null, valide: true, modifie: false, prise_choisie: "A", debut: null, fin: null, ...CHAMPS_PLAN_DEFAUT };
}

describe("formats", () => {
  it("tourne le court en vertical, l'épisode YouTube et le film en 16:9", () => {
    expect(ratioClips("court")).toBe("9:16");
    expect(ratioClips("moyen")).toBe("16:9");
    expect(ratioClips("long")).toBe("16:9");
    expect(tailleImage("court")).toBe("1024x1536");
    expect(tailleImage("moyen")).toBe("1536x1024");
  });
  it("choisit les climax puis l'accroche pour les miniatures, trois au plus", () => {
    const plans = [plan("a", "accroche", 0), plan("b", "decor", 1), plan("c", "climax", 2), plan("d", "climax", 3), plan("e", "final", 4)];
    expect(plansPourMiniatures(plans).map((p) => p.id)).toEqual(["c", "d", "a"]);
  });
});
