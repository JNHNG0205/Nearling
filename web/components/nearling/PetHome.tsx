"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { PetState } from "@nearling/shared";
import type { AnyAnim, CareEvent } from "@nearling/sprites";
import { FuelMeter } from "@/components/FuelMeter";
import { PetScreen } from "@/components/PetScreen";
import { PantryCard } from "@/components/garden/PantryCard";
import { ChatLog, type ChatEntry } from "@/components/talk/ChatLog";
import { TalkBar } from "@/components/talk/TalkBar";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import {
  ackInbox, errorCopy, getInbox, getPetState, getTurns, normalizeInbox, normalizeTurn, postCare, postHatch,
  type InboxItem, type Turn,
} from "@/lib/brain";
import { authHeaders, useSession } from "@/lib/session";
import { useStream } from "@/lib/useStream";
import { useTalk } from "@/lib/useTalk";
import { InboxPanel, InboxToast, notifyInBackground } from "./Inbox";
import { DemoSpeedPill, StatePill, stateBanner } from "./Pills";
import { talkAnim, turnFromTalk } from "./talkFlow";

const POLL_MS = 15_000;

export function PetHome({ initial }: { initial: PetState }) {
  const [pet, setPet] = useState(initial);
  const session = useSession();
  const isOwner = !!session && session.account === pet.owner;
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [toast, setToast] = useState<InboxItem | null>(null);
  const [event, setEvent] = useState<{ anim: AnyAnim; key: number } | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const [careError, setCareError] = useState<string | null>(null);
  const [hatching, setHatching] = useState(false);
  const petRef = pet.pet_ref;

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
      setToast(item);
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

  const unread = inbox.filter((i) => i.read_at === null).length;
  const openInbox = () => {
    setInboxOpen((o) => !o);
    const last = inbox.at(-1);
    if (last && isOwner && unread > 0) {
      const at = Date.now();
      setInbox((list) => list.map((i) => (i.read_at === null ? { ...i, read_at: at } : i)));
      void ackInbox(petRef, authHeaders(), last.id).catch(() => undefined);
    }
  };

  const lowFuel = pet.fuel.left === 0 || pet.display_state === "starving" || pet.display_state === "dormant";
  const banner = stateBanner(pet.display_state, pet.name, pet.fuel.left);
  const ref = encodeURIComponent(petRef);
  const m = pet.care.milestones;

  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl">
            {pet.name} <span className="text-base text-muted">. {cap(pet.stage)}{pet.form === "winged" ? " . winged" : ""}</span>
          </h1>
          {isOwner && (
            <button type="button" className="pixel-btn pixel-btn--secondary px-3 text-sm" onClick={openInbox}
              aria-expanded={inboxOpen}>
              Inbox
              {unread > 0 && (
                <span className="ml-2 bg-accent px-1 font-mono text-bg" aria-label={`${unread} unread`}>{unread}</span>
              )}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {pet.demo_speed && <DemoSpeedPill />}
          <StatePill state={pet.display_state} />
        </div>
      </header>

      {inboxOpen && isOwner && <InboxPanel items={inbox} name={pet.name} />}
      {banner && <p className="border-2 border-line bg-surface px-3 py-2">{banner}</p>}

      <PetScreen
        traits={pet.traits}
        stageIndex={pet.stage_index}
        winged={pet.form === "winged"}
        shirt={pet.equipped_shirt}
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
              const [r] = await Promise.all([postHatch(petRef, authHeaders()), new Promise((ok) => setTimeout(ok, 1_400))]);
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
      </div>

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

      <ChatLog entries={entries} name={pet.name} readOnly={!isOwner} petRef={petRef} />

      <PantryCard compact contract={pet.contract} tokenId={pet.token_id} name={pet.name} />
      <nav aria-label={`${pet.name} pages`} className="flex flex-wrap gap-2 border-t-2 border-line pt-4">
        {[
          [`/feed/${ref}`, "Feed"],
          [`/pet/${ref}/closet`, "Closet"],
          [`/pet/${ref}/soul`, "Soul"],
          [`/pet/${ref}/garden`, "Garden"],
          [`/pet/${ref}/device`, "Device"],
          ["/race", "Race"],
          [`/pet/${ref}/receipts`, "Receipts"],
          [`/p/${ref}`, "Share"],
          ...(isOwner ? [[`/pet/${ref}/settings`, "Settings"], [`/pet/${ref}/transfer`, "Give away"]] : []),
        ].map(([href, label]) => (
          <Link key={href} href={href!} className="pixel-btn pixel-btn--secondary px-3 text-sm">{label}</Link>
        ))}
      </nav>

      {toast && <InboxToast item={toast} name={pet.name} onClose={() => setToast(null)} />}
    </main>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
