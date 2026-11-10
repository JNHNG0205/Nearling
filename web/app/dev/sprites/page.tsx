"use client";

import { useState } from "react";
import { BODY_PALETTES, EGG_ANIMS, PATTERNS, PET_ANIMS, type AnyAnim } from "@nearling/sprites";
import { PetSprite } from "@/components/PetSprite";

// Team review page: every animation for any traits, stage and form. Not linked from the app.
export default function SpriteGallery() {
  const [body, setBody] = useState(2);
  const [pattern, setPattern] = useState(1);
  const [stageIndex, setStageIndex] = useState(3);
  const [winged, setWinged] = useState(false);
  const traits = [body, 0, pattern, 0, 0];
  const anims = (stageIndex === 0 ? Object.keys(EGG_ANIMS) : Object.keys(PET_ANIMS)) as AnyAnim[];

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8">
      <h1 className="font-display text-3xl">Nearling sprites</h1>
      <p className="mt-2 text-muted">Same frames as the device header in art/nearling_sprites.h.</p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">Colour
          <select className="bg-surface px-2 py-1" value={body} onChange={(e) => setBody(Number(e.target.value))}>
            {BODY_PALETTES.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">Pattern
          <select className="bg-surface px-2 py-1" value={pattern} onChange={(e) => setPattern(Number(e.target.value))}>
            {PATTERNS.map((p, i) => <option key={p} value={i}>{p}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">Stage
          <select className="bg-surface px-2 py-1" value={stageIndex} onChange={(e) => setStageIndex(Number(e.target.value))}>
            {["egg", "baby", "teen", "adult"].map((s, i) => <option key={s} value={i}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={winged} onChange={(e) => setWinged(e.target.checked)} /> Winged
        </label>
      </div>
      <ul className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
        {anims.map((a) => (
          <li key={a} className="pixel-panel flex flex-col items-center gap-2 p-3">
            <PetSprite traits={traits} stageIndex={stageIndex} winged={winged} state="happy" play={a} scale={3} label={a} />
            <span className="font-mono text-sm">{a}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
