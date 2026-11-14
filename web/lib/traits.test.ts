import { describe, expect, it } from "vitest";
import { traitSummary } from "./traits";

describe("traitSummary", () => {
  it("lists the five traits in chain order with what each one does in battle", () => {
    const s = traitSummary([50, 45, 82, 41, 56]);
    expect(s.traits.map((t) => [t.label, t.value])).toEqual([
      ["Playful", 50], ["Curious", 45], ["Calm", 82], ["Sassy", 41], ["Kind", 56],
    ]);
    expect(s.traits[2]?.effect).toBe("HP and defence");
  });

  it("names the battle style after the highest trait, with its skills and unlock levels", () => {
    const s = traitSummary([84, 57, 43, 83, 74]);
    expect(s.family).toBe("Playful");
    expect(s.skills).toEqual([
      { name: "Zoomies", level: 3 }, { name: "Big Pounce", level: 6 }, { name: "Tantrum", level: 10 },
    ]);
  });
});
