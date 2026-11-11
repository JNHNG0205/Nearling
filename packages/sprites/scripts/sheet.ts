// Review sheet: every animation (rows) x frames (columns), scaled up, on the UI background.
// Usage: pnpm --filter @nearling/sprites sheet [out.png] [stage] [winged] [traits csv] [shirt token id or -]
// The personality variant comes from the traits (personalityFromTraits).
import { writeFileSync } from "node:fs";
import { EGG_ANIMS, PET_ANIMS, clip, personalityFromTraits, type AnyAnim, type Stage } from "../src/index";
import { renderSheet } from "./sheet-lib";

const [out = "sheet.png", stageArg = "adult", wingedArg = "0", traitsArg = "0,0,1,0,0", shirtArg = "-"] = process.argv.slice(2);
const stage = stageArg as Stage;
const winged = wingedArg === "1";
const traits = traitsArg.split(",").map(Number);
const shirt = shirtArg === "-" ? null : shirtArg;
const personality = personalityFromTraits(traits);

const names: AnyAnim[] = stage === "egg" ? (Object.keys(EGG_ANIMS) as AnyAnim[]) : (Object.keys(PET_ANIMS) as AnyAnim[]);
const clips = names.map((n) => clip(n, { stage, winged, shirt, personality }));
writeFileSync(out, renderSheet(clips.map((c) => ({ clip: c, traits, shirt }))));
console.log(`wrote ${out} (personality ${personality ?? "none"}, shirt ${shirt ?? "none"}): ${clips.map((c) => `${c.name}(${c.frames.length})`).join(" ")}`);
