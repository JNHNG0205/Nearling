import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { chainErrorCopy, GENERIC_ERROR } from "./errors";

/** Every `"E_CODE: ..."` panic string in the contracts' Rust sources. */
function contractCodes(): string[] {
  const codes = new Set<string>();
  for (const dir of ["../../contract/src", "../../shirts/src"]) {
    const root = fileURLToPath(new URL(dir, import.meta.url));
    for (const f of readdirSync(root, { recursive: true }) as string[]) {
      if (!f.endsWith(".rs")) continue;
      for (const m of readFileSync(join(root, f), "utf8").matchAll(/"(E_[A-Z_]+):/g)) codes.add(m[1]!);
    }
  }
  return [...codes].sort();
}

describe("contract error copy (W9)", () => {
  const codes = contractCodes();

  it("finds the contract codes", () => {
    expect(codes).toContain("E_STAKED");
    expect(codes.length).toBeGreaterThan(20);
  });

  it.each(codes)("%s has friendly copy without exclamation marks", (code) => {
    const text = chainErrorCopy(code, "Mochi");
    expect(text).not.toBe(GENERIC_ERROR);
    expect(text).not.toContain("!");
  });
});
