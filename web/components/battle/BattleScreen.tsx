"use client";

import { useEffect, useState } from "react";
import type { Move } from "@petto/battle";
import { PetSprite } from "@/components/PetSprite";
import { PixelIcon } from "@/components/PixelIcon";
import { eventText, menuOptions, type ClientEvent, type ClientState } from "@/lib/battle";
import { battleFx, type SideFx } from "@/lib/battleFx";
import { BattleMenu } from "./BattleMenu";
import { StatusPlate } from "./StatusPlate";

const EVENT_MS = 1200;

function useSecondsLeft(endsAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [endsAt]);
  return endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;
}

/**
 * The battle: the other pet top right, yours bottom left, a message box and the menu. After each
 * turn the events play back one line at a time, then the menu returns.
 */
export function BattleScreen({ s, dispatch, send }: { s: ClientState; dispatch: (e: ClientEvent) => void; send: (m: Move) => void }) {
  // playback position, reset during render when a new turn's events arrive
  const [play, setPlay] = useState({ queue: s.queue, step: 0 });
  if (play.queue !== s.queue) setPlay({ queue: s.queue, step: 0 });
  const step = play.queue === s.queue ? play.step : 0;
  const secondsLeft = useSecondsLeft(s.screen === "menu" || s.screen === "fight" || s.screen === "waiting" ? s.turnEndsAt : 0);
  const you = s.you ?? 0;
  const foe = you === 0 ? 1 : 0;
  const names: [string, string] = [s.pets[0]?.name ?? "Pet A", s.pets[1]?.name ?? "Pet B"];

  useEffect(() => {
    if (s.screen !== "playing") return;
    if (step >= s.queue.length) return dispatch({ type: "played" });
    const t = setTimeout(() => setPlay((p) => ({ ...p, step: p.step + 1 })), EVENT_MS);
    return () => clearTimeout(t);
  }, [s.screen, s.queue, step, dispatch]);

  if (!s.battle) return null;
  const event = s.screen === "playing" ? s.queue[step] : undefined;
  const line = event ? eventText(event, names) : s.message;

  const pick = (id: string) => {
    if (id === "fight") return dispatch({ type: "choose", screen: "fight" });
    if (id === "back") return dispatch({ type: "choose", screen: "menu" });
    send(id === "run" || id === "attack" || id === "defend" || id === "dodge" ? { kind: id } : { kind: "skill", skill: id });
    dispatch({ type: "choose", screen: "waiting" });
  };

  // the playing event's effect on each pet; a pet faints on screen only when its faint event plays
  const fx: (SideFx | undefined)[] = [undefined, undefined];
  if (event) for (const f of battleFx(event)) fx[f.side] = f;
  const faintAt = (side: 0 | 1) => s.queue.findIndex((e) => e.kind === "faint" && e.side === side);

  const sprite = (side: 0 | 1) => {
    const p = s.pets[side];
    if (!p) return null;
    const at = faintAt(side);
    const fainted = s.battle!.fighters[side].hp === 0 && (s.screen !== "playing" || at === -1 || step >= at);
    const f = fx[side];
    const toward = side === you ? "up" : "down"; // yours stands bottom left, the foe top right
    return (
      <div key={`${side}-${step}-${s.queue.length}`} className={`relative ${f?.motion ? `battle-fx battle-fx-${f.motion} battle-fx-${toward}` : ""}`}>
        <PetSprite
          traits={p.traits}
          stageIndex={p.stageIndex}
          winged={false}
          costume={p.costume}
          state={fainted ? "dormant" : "happy"}
          play={f?.sprite ?? null}
          playKey={`${step}-${side}`}
          scale={3}
          label={p.name}
        />
        {f?.popup && (
          <span className={`battle-popup battle-popup-${f.popup.tone} font-display`} aria-hidden="true">
            {f.popup.icon && <PixelIcon name={f.popup.icon} size={14} />}
            {f.popup.text}
          </span>
        )}
      </div>
    );
  };

  return (
    <section aria-label="Battle" className="flex flex-col gap-3">
      <div className="pixel-panel relative grid grid-cols-2 gap-3 bg-[var(--n-screen)] p-3">
        <div className="self-start">
          <StatusPlate name={names[foe]} fighter={s.battle.fighters[foe]} />
        </div>
        <div className="flex justify-center">{sprite(foe)}</div>
        <div className="flex justify-center">{sprite(you)}</div>
        <div className="self-end">
          <StatusPlate name={names[you]} fighter={s.battle.fighters[you]} />
        </div>
      </div>

      <div className="pixel-panel flex min-h-16 items-center justify-between gap-3 p-3" aria-live="polite">
        <p className="font-display">{line}</p>
        {secondsLeft > 0 && <span className="font-mono text-sm text-muted tabular-nums" aria-label="Seconds left this turn">{secondsLeft}s</span>}
      </div>

      {s.error && <p role="alert" className="text-sm text-danger">{s.error}</p>}
      {(s.screen === "menu" || s.screen === "fight") && <BattleMenu options={menuOptions(s)} onPick={pick} />}
    </section>
  );
}
