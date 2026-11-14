"use client";

import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Move } from "@petto/battle";
import { PetSprite } from "@/components/PetSprite";
import { EXPLORER_TX } from "@/lib/brain";
import {
  BattleRequestError, battleSocketUrl, initialState, joinBattle, reduce, type ClientEvent,
} from "@/lib/battle";
import { authHeaders, useSession } from "@/lib/session";
import type { BattleServerMsg } from "@petto/battle/protocol";
import { BattleScreen } from "./BattleScreen";
import { PetPicker } from "./PetPicker";
import { RoomQr } from "./RoomQr";

// /battle/[code] (spec 3.3): waiting room with the code and a QR, Ready, the battle, the result.
// A visitor who is not in the room yet (opened the QR link) picks a pet and joins here.

const MAX_RETRIES = 5;

export function BattleRoom({ code }: { code: string }) {
  const session = useSession();
  const [s, dispatch] = useReducer(reduce, undefined, initialState);
  const [needJoin, setNeedJoin] = useState(false);
  const [joinPet, setJoinPet] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [origin, setOrigin] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const gotRoom = useRef(false);
  const retries = useRef(0);
  const doneRef = useRef(false);
  doneRef.current = s.result !== null || s.closedEarly;

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (!session || needJoin) return;
    const ws = new WebSocket(battleSocketUrl(code, session.token));
    wsRef.current = ws;
    let stop = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as BattleServerMsg;
        if (msg.type === "room") {
          gotRoom.current = true;
          retries.current = 0;
        }
        dispatch(msg);
      } catch {
        // not ours: ignore
      }
    };
    ws.onclose = (ev) => {
      if (stop || doneRef.current) return;
      if (!gotRoom.current) return setNeedJoin(true); // not in this room (or it is gone): offer to join
      if (ev.code === 4004) return dispatch({ type: "closed" });
      if (ev.code === 4009) return setProblem("This battle is open in another tab.");
      if (retries.current >= MAX_RETRIES) return dispatch({ type: "closed" });
      retries.current += 1;
      retry = setTimeout(() => setAttempt((n) => n + 1), 1500);
    };
    return () => {
      stop = true;
      if (retry) clearTimeout(retry);
      ws.close();
    };
  }, [code, session, needJoin, attempt]);

  const send = useCallback((m: Move | "ready") => {
    wsRef.current?.send(JSON.stringify(m === "ready" ? { type: "ready" } : { type: "move", move: m }));
  }, []);
  const stableDispatch = useCallback((e: ClientEvent) => dispatch(e), []);

  const join = async () => {
    if (!joinPet) return;
    setJoining(true);
    setProblem(null);
    try {
      await joinBattle(code, joinPet, authHeaders());
      gotRoom.current = false;
      setNeedJoin(false);
    } catch (e) {
      setProblem(e instanceof BattleRequestError ? e.message : "The brain didn't answer. Try again in a moment.");
    } finally {
      setJoining(false);
    }
  };

  const header = (
    <header className="flex items-center gap-3">
      <Link href="/battle" aria-label="Back to battles" className="font-display text-2xl text-muted hover:text-ink">&lt;</Link>
      <h1 className="font-display text-2xl">Battle {code}</h1>
    </header>
  );

  let body: React.ReactNode;
  if (!session) {
    body = <p>Sign in to battle. Use the wallet button at the top of the page.</p>;
  } else if (needJoin) {
    body = (
      <section className="flex flex-col gap-4">
        <p>Pick the pet that will fight in this battle.</p>
        <PetPicker value={joinPet} onChange={setJoinPet} />
        <button type="button" className="pixel-btn w-full" onClick={join} disabled={joining || !joinPet}>
          {joining ? "Joining..." : "Join the battle"}
        </button>
      </section>
    );
  } else if (s.closedEarly) {
    body = (
      <section className="pixel-panel flex flex-col gap-3 p-4">
        <p>{s.message}</p>
        <Link href="/battle" className="pixel-btn w-full text-center">Start a new battle</Link>
      </section>
    );
  } else if (s.result && s.screen === "over") {
    const r = s.result;
    body = (
      <section className="pixel-panel flex flex-col items-center gap-3 p-6 text-center">
        <h2 className="font-display text-2xl">{s.message}</h2>
        <p className="font-display">+{r.xp} battle XP</p>
        {r.levelUp && <p className="font-display text-accent">Level up! Now Lv {r.levelUp}.</p>}
        <p className="text-sm text-muted">
          {r.saved === "pending" && "Saving to NEAR..."}
          {r.saved === "saved" && r.tx && (
            <>Saved on NEAR. <a className="underline hover:text-ink" href={`${EXPLORER_TX}${r.tx}`} target="_blank" rel="noreferrer">See the transaction</a></>
          )}
          {r.saved === "failed" && "Saving to NEAR failed, so this battle's XP was not recorded."}
        </p>
        <Link href="/battle" className="pixel-btn w-full">Battle again</Link>
      </section>
    );
  } else if (s.battle) {
    body = <BattleScreen s={s} dispatch={stableDispatch} send={send} />;
  } else if (s.you === null) {
    body = <p className="text-muted">Connecting...</p>;
  } else {
    const me = s.you;
    const other = s.pets[me === 0 ? 1 : 0];
    const link = `${origin}/battle/${code}`;
    body = (
      <section className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          {[0, 1].map((side) => {
            const p = s.pets[side];
            return (
              <div key={side} className="pixel-panel flex flex-col items-center gap-2 p-3">
                {p ? (
                  <>
                    <PetSprite traits={p.traits} stageIndex={p.stageIndex} winged={false} costume={p.costume} state="happy" scale={3} label={p.name} />
                    <span className="font-display">{p.name}</span>
                    <span className="text-xs text-muted">Lv {p.level} · {s.ready[side] ? "Ready" : "Not ready"}</span>
                  </>
                ) : (
                  <span className="py-8 text-sm text-muted">Waiting for a challenger</span>
                )}
              </div>
            );
          })}
        </div>
        {!other && origin && (
          <div className="pixel-panel flex flex-col items-center gap-3 p-4 text-center">
            <p className="text-sm">Share the code <span className="font-mono text-lg tracking-[0.2em]">{code}</span> or scan:</p>
            <RoomQr url={link} size={180} />
          </div>
        )}
        <button type="button" className="pixel-btn w-full" onClick={() => send("ready")} disabled={s.ready[me]}>
          {s.ready[me] ? (other ? "Waiting for the other player..." : "Ready. Waiting for a challenger...") : "Ready"}
        </button>
      </section>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-6 px-4 py-6 md:max-w-[760px] md:px-6 md:py-10">
      {header}
      {body}
      {problem && (
        <p role="alert"><span className="font-display text-danger">Problem.</span> {problem}</p>
      )}
    </main>
  );
}
