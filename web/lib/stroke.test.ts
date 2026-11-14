import { describe, expect, it } from "vitest";
import { createStroke } from "./stroke";

describe("createStroke", () => {
  it("counts a stroke of 120 px within 1.5 s as one pat", () => {
    const s = createStroke();
    expect(s.move(0, 0, 0)).toBe(false);
    expect(s.move(60, 0, 300)).toBe(false);
    expect(s.move(120, 0, 600)).toBe(true);
  });

  it("does not pat for slow drifting (distance older than the window is forgotten)", () => {
    const s = createStroke();
    s.move(0, 0, 0);
    s.move(70, 0, 1_000);
    expect(s.move(110, 0, 2_600)).toBe(false); // the first 70 px fell out of the window
  });

  it("waits 2 s between pats while rubbing", () => {
    const s = createStroke();
    s.move(0, 0, 0);
    expect(s.move(130, 0, 400)).toBe(true);
    expect(s.move(0, 0, 800)).toBe(false); // 130 px more, but inside the cooldown
    expect(s.move(130, 0, 2_500)).toBe(true); // cooldown over: this stroke is the next pat
  });

  it("starts fresh after the pointer leaves", () => {
    const s = createStroke();
    s.move(0, 0, 0);
    s.move(100, 0, 200);
    s.reset();
    expect(s.move(130, 0, 400)).toBe(false); // a jump from outside is not a stroke
  });
});
