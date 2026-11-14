"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PetState } from "@petto/shared";
import type { AnyAnim, CareEvent } from "@petto/sprites";
import { FuelMeter } from "@/components/FuelMeter";
import { PetScreen } from "@/components/PetScreen";
import { PantryCard } from "@/components/garden/PantryCard";
import { ChatLog, type ChatEntry } from "@/components/talk/ChatLog";
import { TalkBar } from "@/components/talk/TalkBar";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import {
  ackInbox, errorCopy, getInbox, getPetState, getTurns, normalizeInbox, normalizeTurn, postCare,
  type InboxItem, type Turn,
} from "@/lib/brain";
import { authHeaders, useSession } from "@/lib/session";
import { useStream } from "@/lib/useStream";
import { useTalk } from "@/lib/useTalk";
import { useHatch } from "@/components/wallet/useHatch";
import { growth } from "@/lib/growth";
import { BattleLine } from "./BattleLine";
import { DeviceNudge } from "./DeviceNudge";
import { PetTabs } from "./PetTabs";
import { notifyInBackground } from "./Inbox";
import { DemoSpeedPill, StatePill, stateBanner } from "./Pills";
import { talkAnim, turnFromTalk } from "./talkFlow";

const POLL_MS = 15_000;

export function PetHome({ initial }: { initial: PetState }) {
  const [pet, setPet] = useState(initial);
  const session = useSession();
  const isOwner = !!session && session.account === pet.owner;
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [event, setEvent] = useState<{ anim: AnyAnim; key: number } | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [careError, setCareError] = useState<string | null>(null);
  const [hatching, setHatching] = useState(false);
  const hatch = useHatch();
  const petRef = pet.pet_ref;
  const chatRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setPet(await getPetState(petRef, { cache: "no-store" }));
    } catch {
      // keep the last state; the next poll retries
    }
  }, [petRef]);

  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Owner-only data: chat history and inbox.
  useEffect(() => {
    if (!isOwner) {
      setEntries([]);
      setInbox([]);
      return;
    }
    let live = true;
    getTurns(petRef, authHeaders())
      .then((turns) => live && setEntries(turns.map((t) => ({ key: t.turn_id, user: t.user_text, turn: t, error: null }))))
      .catch(() => undefined);
    getInbox(petRef, authHeaders()).then((items) => live && setInbox(items)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [isOwner, petRef]);

  // desktop chat panel: always show the newest message; scroll up for older ones
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const play = (anim: AnyAnim) => setEvent({ anim, key: Date.now() });

  const patchTurn = (turnId: string, patch: (t: Turn) => Turn) =>
    setEntries((list) => list.map((e) => (e.turn?.turn_id === turnId ? { ...e, turn: patch(e.turn) } : e)));

  useStream(petRef, isOwner && session ? session.token : null, {
    state: (d) => {
      if (d.pet_ref === petRef) setPet(d as unknown as PetState);
      else void refresh();
    },
    fuel_charged: (d) => {
      const id = typeof d.turn_id === "string" ? d.turn_id : null;
      const tx = typeof d.tx_hash === "string" ? d.tx_hash : typeof d.tx === "string" ? d.tx : null;
      const source = typeof d.source === "string" ? (d.source as Turn["fuel"]["source"]) : null;
      if (id) patchTurn(id, (t) => ({ ...t, fuel: { status: "settled", tx, source } }));
      void refresh();
    },
    fuel_added: () => {
      play("eat");
      void refresh();
    },
    inbox: (d) => {
      const item = normalizeInbox(d);
      if (!item) return;
      setInbox((list) => (list.some((i) => i.id === item.id) ? list : [...list, item]));
      notifyInBackground(pet.name, item.text);
    },
    evolved: () => {
      play("evolve");
      void refresh();
    },
    receipt_ready: (d) => {
      const id = typeof d.turn_id === "string" ? d.turn_id : null;
      const status = normalizeTurn({ turn_id: id, verification: d.status })?.verification;
      if (id && status) patchTurn(id, (t) => ({ ...t, verification: status }));
    },
  });

  const talk = useTalk({
    petRef,
    name: pet.name,
    onSent: (l) => {
      setBubble(null);
      setEntries((list) => [...list, { key: l.localId, user: l.text, turn: null, error: null }]);
    },
    onReply: (l, res) => {
      const turn = turnFromTalk(l, res);
      setEntries((list) => list.map((e) => (e.key === l.localId ? { ...e, user: turn.user_text, turn } : e)));
      setBubble(res.reply);
      setPet((p) => ({ ...p, fuel: { ...p.fuel, left: res.fuel.left } }));
      if (res.status === "canned") void refresh();
    },
    onError: (l, code) => {
      setEntries((list) => list.map((e) => (e.key === l.localId ? { ...e, error: errorCopy(code, pet.name) } : e)));
    },
  });

  useEffect(() => {
    if (talk.phase === "idle" && bubble) {
      const t = setTimeout(() => setBubble(null), 4_000);
      return () => clearTimeout(t);
    }
  }, [talk.phase, bubble]);

  const onCare = async (kind: CareEvent) => {
    if (!isOwner) return; // the local animation still plays for visitors
    setCareError(null);
    try {
      const r = await postCare(petRef, authHeaders(), [{ id: crypto.randomUUID(), kind, at: Date.now() }]);
      setPet((p) => ({ ...p, form: r.form, care: { mood: r.mood, milestones: r.milestones } }));
      if (r.evolved_now) play("evolve");
    } catch {
      setCareError("Care did not sync. The animation still played; try again in a moment.");
    }
  };

  // Messages the pet sent on its own (inbox) appear in the chat, in time order, after the turns they follow.
  const chat = mergeInbox(entries, inbox);
  // seeing the chat reads the inbox
  const lastInbox = inbox.at(-1);
  useEffect(() => {
    if (isOwner && lastInbox && lastInbox.read_at === null) {
      void ackInbox(petRef, authHeaders(), lastInbox.id).catch(() => undefined);
    }
  }, [isOwner, petRef, lastInbox]);

  const lowFuel = pet.fuel.left === 0 || pet.display_state === "starving" || pet.display_state === "dormant";
  const banner = stateBanner(pet.display_state, pet.name, pet.fuel.left);
  const ref = encodeURIComponent(petRef);
  const m = pet.care.milestones;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-6 px-4 py-6 md:max-w-[760px] md:px-6 lg:h-[calc(100dvh-66px)] lg:min-h-0 lg:max-w-[1200px] lg:gap-4 lg:overflow-hidden lg:py-5">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl">
            {pet.name} <span className="text-base text-muted">. {cap(pet.stage)}{pet.form === "winged" ? " . winged" : ""}</span>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {pet.demo_speed && <DemoSpeedPill />}
          <StatePill state={pet.display_state} />
        </div>
        <DeviceNudge petRef={petRef} name={pet.name} href={`/pet/${ref}/device`} isOwner={isOwner} paired={pet.device.paired} />
        <PetTabs petRef={petRef} isOwner={isOwner} />
      </header>

      {/* phone: one column (pet, talk, links). desktop: pet and links left, talk and chat right */}
      <div className="flex flex-col gap-6 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:items-start lg:gap-x-10 lg:gap-y-4">
      <div className="flex flex-col gap-6 lg:col-start-1 lg:row-start-1 lg:gap-3">

      {banner && <p className="border-2 border-line bg-surface px-3 py-2">{banner}</p>}

      <PetScreen
        traits={pet.traits}
        stageIndex={pet.stage_index}
        winged={pet.form === "winged"}
        shirt={pet.equipped_shirt}
        costume={pet.equipped_costume}
        state={pet.display_state}
        name={pet.name}
        talk={talkAnim(talk.phase, talk.emotion)}
        event={event}
        onEventDone={() => setEvent(null)}
        bubble={bubble}
        onCare={onCare}
      />
      {careError && <p className="text-sm text-warn" role="status">{careError}</p>}
      {isOwner && !pet.hatched && (
        // Build Spec 1: an egg the owner has not hatched yet (adopted before hatching existed,
        // or the adopt page could not reach the brain). One press, once.
        <button
          type="button"
          className="pixel-btn self-center"
          disabled={hatching}
          onClick={async () => {
            setHatching(true);
            setCareError(null);
            play("egg_hatch");
            try {
              // let the 8-frame hatch play on the egg before the baby appears
              const [r] = await Promise.all([hatch(pet.contract, pet.token_id), new Promise((ok) => setTimeout(ok, 1_400))]);
              setPet(r.state);
            } catch {
              setCareError(`${pet.name} could not hatch right now. Try again in a moment.`);
            } finally {
              setHatching(false);
            }
          }}
        >
          Hatch {pet.name}
        </button>
      )}

      <div className="flex flex-col gap-2">
        <FuelMeter fuel={pet.fuel} name={pet.name} />
        <p className="flex items-center gap-3 text-sm">
          <span className="font-display">Wings</span>
          <span className="flex gap-2" aria-label={`Care milestones: pat ${m.pat ? "done" : "to do"}, rock ${m.rock ? "done" : "to do"}, sleep ${m.sleep ? "done" : "to do"}`}>
            {(["pat", "rock", "sleep"] as const).map((k) => (
              <span key={k} className={`inline-block h-3 w-3 border-2 ${m[k] ? "border-accent bg-accent" : "border-line"}`} title={k} />
            ))}
          </span>
          <span className="text-muted">Pat, rock and put {pet.name} to sleep to grow wings.</span>
        </p>
        <GrowthLine
          xp={pet.xp ?? 0}
          stage={pet.chain_stage_index}
          name={pet.name}
          // hatched in the app before hatching moved on chain: one signature makes it a Baby there too
          onFinishHatch={isOwner && pet.hatched && pet.chain_stage_index === 0
            ? async () => {
                try {
                  setPet((await hatch(pet.contract, pet.token_id)).state);
                } catch {
                  setCareError(`${pet.name} could not finish hatching. Try again in a moment.`);
                }
              }
            : undefined}
        />
        <PantryCard compact contract={pet.contract} tokenId={pet.token_id} name={pet.name} />
        <BattleLine contract={pet.contract} tokenId={pet.token_id} isOwner={isOwner} />
      </div>

      </div>

      <div className="flex flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-full lg:min-h-0 lg:gap-4 lg:self-stretch lg:border-l-2 lg:border-line lg:pl-10">
      {/* desktop: messages scroll above, the talk box stays at the bottom like a chat app */}
      <div className="lg:order-last">
      {isOwner ? (
        <TalkBar
          petRef={petRef}
          name={pet.name}
          phase={talk.phase}
          lowFuel={lowFuel}
          micDenied={talk.micDenied}
          blocked={talk.blocked}
          hint={talk.hint}
          errorText={talk.errorText}
          onHoldStart={() => void talk.startHold()}
          onHoldEnd={talk.stopHold}
          onText={talk.sendText}
        />
      ) : (
        <div className="flex flex-col gap-3 border-2 border-line p-3">
          {session ? (
            <p>Only {pet.name}&apos;s owner can talk to {pet.name}. Anyone can feed the brain.</p>
          ) : (
            <>
              <p>Connect your wallet to talk.</p>
              <div className="self-start"><ConnectButton /></div>
            </>
          )}
          <Link href={`/feed/${ref}`} className="pixel-btn self-start">Feed {pet.name}</Link>
        </div>
      )}
      </div>

      <div ref={chatRef} className="chat-scroll max-h-[60dvh] overflow-y-auto pr-2 lg:max-h-none lg:min-h-0 lg:flex-1 lg:pr-3">
        <ChatLog entries={chat} name={pet.name} readOnly={!isOwner} petRef={petRef} />
      </div>
      </div>

      <div className="chat-scroll flex flex-col gap-6 lg:col-start-1 lg:row-start-2 lg:max-h-full lg:min-h-0 lg:gap-3 lg:overflow-y-auto">

      </div>
      </div>

    </main>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Chat turns plus the pet's own messages, oldest first; pending turns (no time yet) stay last. */
function mergeInbox(entries: ChatEntry[], inbox: InboxItem[]): ChatEntry[] {
  // a message the pet sent first also exists as a turn with no owner line; show it once, as the note
  const noteTurns = new Set(inbox.map((i) => i.turn_id).filter(Boolean));
  const turns = entries.filter((e) => !(e.turn && noteTurns.has(e.turn.turn_id)));
  const notes: ChatEntry[] = inbox.map((i) => ({ key: `inbox-${i.id}`, user: null, turn: null, error: null, note: { text: i.text, at: i.created_at } }));
  const at = (e: ChatEntry) => e.note?.at ?? e.turn?.at ?? Number.POSITIVE_INFINITY;
  return [...turns, ...notes].sort((a, b) => at(a) - at(b));
}

/** On-chain stage and XP toward the next stage (lib/growth.ts): hatch for Baby, then chats +1 XP, daily visit +2. */
function GrowthLine({ xp, stage, name, onFinishHatch }: { xp: number; stage: number; name: string; onFinishHatch?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const g = growth(xp, stage);
  const blocks = 5;
  const lit = g.at === null ? (g.next ? 0 : blocks) : Math.min(blocks, Math.floor(((xp - g.from) / (g.at - g.from)) * blocks));
  return (
    <p className="flex flex-wrap items-center gap-3 text-sm" title={`Chats give ${name} 1 XP each, plus 2 XP for your first visit each day.`}>
      <span className="font-display">Growth</span>
      <span className="flex gap-1" aria-hidden="true">
        {Array.from({ length: blocks }, (_, i) => (
          <span key={i} className={`inline-block h-3 w-3 border-2 ${i < lit ? "border-accent bg-accent" : "border-line"}`} />
        ))}
      </span>
      <span className="font-mono text-muted">
        {!g.next ? `${xp} XP · fully grown` : g.at === null ? "Hatch to grow into a Baby" : `${xp} / ${g.at} XP to ${g.next}`}
      </span>
      {onFinishHatch && (
        <button
          className="text-accent underline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onFinishHatch();
            setBusy(false);
          }}
        >
          {busy ? "Hatching..." : "Finish hatching"}
        </button>
      )}
    </p>
  );
}
