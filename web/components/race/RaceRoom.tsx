"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RULES_VERSION, TICKS_PER_SECOND } from "@nearling/race";
import { BrainRequestError } from "@/lib/brain";
import {
  ClockSync, createRoom, joinRoom, raceSocketUrl, saveJoin, savedJoin, traitsFromName,
  type RacePlayer, type ServerMsg, type Slot,
} from "@/lib/race";
import { RaceCanvas, type Look, type Opponent, type RaceSnapshot } from "./RaceCanvas";
import { RoomQr } from "./RoomQr";

// /race/[code] (web 03 section 11): lobby with Ready, countdown from start_at, the race, the result.

type Room = Extract<ServerMsg, { type: "room" }>;
type Start = Extract<ServerMsg, { type: "start" }>;
type End = Extract<ServerMsg, { type: "result" } | { type: "interrupted" }>;

const NAME_KEY = "nearling.race.name";
const MAX_RETRIES = 5;

export function readRaceName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
export function saveRaceName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // storage blocked: the brain names you "Guest"
  }
}

const lookOf = (p: RacePlayer | null | undefined, fallbackName: string): Look => ({
  traits: p?.traits ?? traitsFromName(p?.name ?? fallbackName),
  stage: p?.stage ?? 1,
});

const seconds = (tick: number | null) => (tick === null ? "the finish" : `${(tick / TICKS_PER_SECOND).toFixed(1)} s`);

export function RaceRoom({ code }: { code: string }) {
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [start, setStart] = useState<Start | null>(null);
  const [end, setEnd] = useState<End | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const clock = useRef(new ClockSync());
  const oppRef = useRef<Opponent>({ lane: 0, laneTick: -1, crashed: false });
  const snapshotRef = useRef<RaceSnapshot>({ tick: null, inputs: [] });

  const send = (m: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    let stopped = false;
    let retries = 0;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;

    const connect = async () => {
      let join = savedJoin(code);
      if (!join) {
        try {
          join = await joinRoom(code);
          saveJoin(code, join);
        } catch (err) {
          if (stopped) return;
          const status = err instanceof BrainRequestError ? err.status : 0;
          setProblem(
            status === 404 ? "No race with that code. Check the code or start a new race."
              : status === 409 ? "This race is full or already started."
                : "The brain is not answering. Try again in a moment.",
          );
          return;
        }
      }
      if (stopped) return;
      const ws = new WebSocket(raceSocketUrl(code, join.race_token));
      wsRef.current = ws;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        retries = 0;
        setConnected(true);
        ws.send(JSON.stringify({ type: "hello", rules_version: RULES_VERSION, name: readRaceName() || undefined }));
        // 5 quick pings for the clock offset, then one every 5 s
        let n = 0;
        pingTimer = setInterval(() => {
          ws.send(JSON.stringify({ type: "ping", t_client: Date.now() }));
          n += 1;
          if (n === 5 && pingTimer) {
            clearInterval(pingTimer);
            pingTimer = setInterval(() => ws.send(JSON.stringify({ type: "ping", t_client: Date.now() })), 5_000);
          }
        }, 200);
      };

      ws.onmessage = (e) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(String(e.data)) as ServerMsg;
        } catch {
          return;
        }
        switch (m.type) {
          case "room":
            setRoom(m);
            break;
          case "pong":
            clock.current.add(m.t_client, m.t_server, Date.now());
            break;
          case "start":
            setStart((s) => (s && s.match_id === m.match_id ? s : m));
            break;
          case "opp_lane":
            if (m.tick > oppRef.current.laneTick) oppRef.current = { ...oppRef.current, lane: m.lane, laneTick: m.tick };
            break;
          case "opp_crash":
            oppRef.current = { ...oppRef.current, crashed: true };
            break;
          case "request_inputs":
            ws.send(JSON.stringify({ type: "crash", ...snapshotRef.current }));
            break;
          case "result":
          case "interrupted":
            finished = true;
            setEnd(m);
            break;
          case "error":
            if (m.code === "rules_version") {
              finished = true;
              setProblem("The race rules changed. Reload this page to get the new version.");
            }
            break;
        }
      };

      ws.onclose = (e) => {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        setConnected(false);
        if (stopped || finished || e.code === 4001 || e.code === 4010) return;
        retries += 1;
        if (!opened && retries >= 3) saveJoin(code, null); // token likely expired or slot freed
        if (retries > MAX_RETRIES) {
          setProblem("Lost the connection to the race.");
          return;
        }
        retryTimer = setTimeout(() => void connect(), 1_000);
      };
    };

    void connect();
    return () => {
      stopped = true;
      if (pingTimer) clearInterval(pingTimer);
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, [code]);

  const newRace = async () => {
    setBusy(true);
    try {
      const r = await createRoom();
      router.push(`/race/${r.code}`);
    } catch {
      setProblem("Could not start a race. Try again in a moment.");
      setBusy(false);
    }
  };

  const you = room?.you ?? null;
  const players = room?.players ?? [null, null];
  const meP = you === null ? null : (players[you] ?? null);
  const oppP = you === null ? null : (players[you === 0 ? 1 : 0] ?? null);
  const url = origin ? `${origin}/race/${code}` : "";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-6 px-4 py-6 md:max-w-[760px] md:gap-8 md:px-6 md:py-10">
      <header className="flex items-center gap-3">
        <Link href="/race" aria-label="Back to races" className="font-display text-2xl text-muted hover:text-ink">
          &lt;
        </Link>
        <h1 className="font-display text-2xl">Petto Run</h1>
        <span className="ml-auto font-mono text-sm text-muted">{connected ? "connected" : "connecting..."}</span>
      </header>

      {problem && (
        <div className="pixel-panel flex flex-col gap-4 p-4" role="alert">
          <p><span className="font-display text-danger">Problem.</span> {problem}</p>
          <button type="button" className="pixel-btn self-start" onClick={newRace} disabled={busy}>
            Start a new race
          </button>
        </div>
      )}

      {!problem && end && (
        <ResultPanel end={end} you={you} me={meP} opp={oppP} onNew={newRace} busy={busy} />
      )}

      {!problem && !end && start && you !== null && (
        <section className="flex flex-col items-center gap-4">
          <RaceCanvas
            seed={start.seed}
            startAt={start.start_at}
            serverNow={() => clock.current.serverNow()}
            me={lookOf(meP, "you")}
            opp={lookOf(oppP, "them")}
            oppRef={oppRef}
            snapshotRef={snapshotRef}
            onLane={(tick, lane) => send({ type: "lane", tick, lane })}
            onCrash={(tick, inputs) => send({ type: "crash", tick, inputs })}
          />
          <p className="text-center text-sm text-muted">
            Space, arrow keys or tap to switch lanes. You are the pet with the gold marker.
          </p>
          <PlayerRows players={players} you={you} running />
        </section>
      )}

      {!problem && !end && !start && (
        <section className="flex flex-col gap-6">
          <div className="pixel-panel flex flex-col items-center gap-4 p-6">
            <p className="text-sm text-muted">Race code</p>
            <p className="font-display text-5xl tracking-[0.2em]" aria-label={`Race code ${code.split("").join(" ")}`}>
              {code}
            </p>
            {url && <RoomQr url={url} />}
            <p className="text-center text-sm text-muted">
              Scan this on a second phone, open it in another tab, or type the code on a Petto.
            </p>
          </div>
          <PlayerRows players={players} you={you} running={false} />
          <button
            type="button"
            className="pixel-btn w-full"
            disabled={!connected || !meP || meP.ready}
            onClick={() => send({ type: "ready" })}
          >
            {meP?.ready ? "Waiting for the other racer" : "Get ready to race"}
          </button>
        </section>
      )}
    </main>
  );
}

function PlayerRows({ players, you, running }: { players: (RacePlayer | null)[]; you: Slot | null; running: boolean }) {
  return (
    <ul className="pixel-panel flex w-full flex-col divide-y-2 divide-[var(--n-line)]">
      {[0, 1].map((s) => {
        const p = players[s] ?? null;
        return (
          <li key={s} className="flex items-center gap-3 px-4 py-3">
            <span className="font-display">{p ? p.name : "Open slot"}</span>
            {s === you && <span className="border-2 border-accent px-1 font-display text-sm text-accent">you</span>}
            <span className="text-sm text-muted">{p ? (p.kind === "device" ? "Petto" : "Browser") : "Waiting for a racer"}</span>
            <span className="ml-auto font-mono text-sm">
              {!p ? "" : !p.connected ? <span className="text-warn">offline</span>
                : running ? (p.crashed ? <span className="text-danger">crashed</span> : "running")
                  : p.ready ? <span className="text-fuel">ready</span> : "not ready"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ResultPanel({ end, you, me, opp, onNew, busy }: {
  end: End; you: Slot | null; me: RacePlayer | null; opp: RacePlayer | null; onNew: () => void; busy: boolean;
}) {
  let title: string;
  let line: string;
  if (end.type === "interrupted") {
    title = "Race interrupted";
    line = "A racer lost the connection for more than 5 seconds, so nobody wins this one.";
  } else {
    const mine = you === null ? null : end.crash_ticks[you];
    const theirs = you === null ? null : end.crash_ticks[you === 0 ? 1 : 0];
    title = end.draw ? "Draw" : end.winner_slot === you ? "You won" : "You lost";
    line = end.reason === "time"
      ? "Both pets lasted the full 2 minutes."
      : `${me?.name ?? "You"} lasted to ${seconds(mine)}, ${opp?.name ?? "the other racer"} to ${seconds(theirs)}.`;
  }
  const corrected = end.type === "result" && you !== null && !end.valid[you];
  return (
    <section className="pixel-panel flex flex-col gap-4 p-6">
      <h2 className="font-display text-3xl">{title}</h2>
      <p>{line}</p>
      <p className="text-sm text-muted">
        {corrected
          ? "Your report did not match the replay, so the brain used its own replay of your moves."
          : "The brain replayed both runs from the same seed to check the result."}
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="pixel-btn" onClick={onNew} disabled={busy}>Start a new race</button>
        <Link href="/race" className="pixel-btn pixel-btn--secondary">Join a race</Link>
      </div>
    </section>
  );
}
