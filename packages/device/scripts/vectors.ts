// Writes vectors/*.json (pnpm --filter @nearling/device vectors). Tests fail if the files drift.
import { writeFileSync } from "node:fs";
import { VECTOR_INPUTS, makeVector } from "../src/vectors";

for (const [name, input] of Object.entries(VECTOR_INPUTS)) {
  const path = new URL(`../vectors/${name}.json`, import.meta.url);
  writeFileSync(path, JSON.stringify(makeVector(input), null, 2) + "\n");
  console.log(`wrote vectors/${name}.json`);
}
