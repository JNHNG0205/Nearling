import type { DisplayState } from "@petto/shared";

/** Shown on every page of a `pets-demo` pet (CLAUDE.md rule 5). */
export function DemoSpeedPill() {
  return (
    <span className="inline-flex h-7 items-center border-2 border-accent px-2 font-display text-sm text-accent">
      demo speed
    </span>
  );
}

const STATE: Record<DisplayState, { word: string; icon: string; colour: string }> = {
  happy: { word: "Happy", icon: "♥", colour: "text-fuel border-fuel" },
  sad: { word: "Sad", icon: "♡", colour: "text-sleep border-sleep" },
  hungry: { word: "Hungry", icon: "!", colour: "text-warn border-warn" },
  sleepy: { word: "Sleepy", icon: "z", colour: "text-sleep border-sleep" },
  starving: { word: "Low fuel", icon: "!", colour: "text-danger border-danger" },
  dormant: { word: "Deep sleep", icon: "z", colour: "text-sleep border-sleep" },
};

/** Icon plus a word, never colour alone (design.md section 7). */
export function StatePill({ state }: { state: DisplayState }) {
  const s = STATE[state];
  return (
    <span className={`inline-flex h-7 items-center gap-1 border-2 px-2 font-display text-sm ${s.colour}`}>
      <span aria-hidden>{s.icon}</span>
      {s.word}
    </span>
  );
}

/** Banner copy per display state (05 section 1). */
export function stateBanner(state: DisplayState, name: string, left: number): string | null {
  switch (state) {
    case "sad": return `${name} wants some attention.`;
    case "hungry": return `Running low: ${left} ${left === 1 ? "thought" : "thoughts"} left.`;
    case "sleepy": return `Shh, ${name} is sleepy.`;
    case "starving": return `Low Fuel. ${name} can't think until someone feeds the brain.`;
    case "dormant": return `${name} is in a deep sleep. Feed or plant NEAR to wake them.`;
    default: return null;
  }
}
