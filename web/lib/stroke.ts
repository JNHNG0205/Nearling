// Petting by stroking: cursor or finger movement over the pet adds up; about 120 px within
// 1.5 s is one pat, at most one every 2 s (so rubbing does not flood the brain with care).

export function createStroke(o: { distance?: number; windowMs?: number; cooldownMs?: number } = {}) {
  const need = o.distance ?? 120;
  const windowMs = o.windowMs ?? 1_500;
  const cooldownMs = o.cooldownMs ?? 2_000;
  let last: { x: number; y: number } | null = null;
  let steps: { d: number; t: number }[] = [];
  let lastPat = -Infinity;

  return {
    /** Feeds one pointer position; true when this movement completes a pat. */
    move(x: number, y: number, t: number): boolean {
      if (last) steps.push({ d: Math.hypot(x - last.x, y - last.y), t });
      last = { x, y };
      steps = steps.filter((s) => t - s.t <= windowMs);
      if (t - lastPat < cooldownMs) return false;
      if (steps.reduce((sum, s) => sum + s.d, 0) < need) return false;
      lastPat = t;
      steps = [];
      return true;
    },
    /** The pointer left the pet: the next movement starts a new stroke. */
    reset() {
      last = null;
      steps = [];
    },
  };
}
