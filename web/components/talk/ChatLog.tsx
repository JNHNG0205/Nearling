"use client";

import { useEffect, useRef, useState } from "react";
import type { McpTaskCard } from "@petto/shared";
import { BrainRequestError, brainUrl, errorCopy, requestVoice, type Turn } from "@/lib/brain";
import { authHeaders } from "@/lib/session";
import { FuelChip } from "./FuelChip";
import { ReceiptBadge } from "./ReceiptBadge";

/** One exchange: what the owner said and the pet's reply (or the pending / failed state). */
export interface ChatEntry {
  key: string;
  user: string | null; // null = voice message without transcript yet
  turn: Turn | null; // null while thinking
  error: string | null;
  /** a message the pet sent first (proactive inbox), shown as a pet bubble with no owner line */
  note?: { text: string; at: number };
}

const EMOTION_ICON: Record<string, string> = {
  happy: "♥", excited: "*", sleepy: "z", sad: "~", hungry: "!", curious: "?", silly: "@",
};

function ReplyBubble({ turn, name, petRef, onTask }: { turn: Turn; name: string; petRef?: string; onTask?: TaskHandler }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState(turn.audio_url);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  useEffect(() => setAudioUrl(turn.audio_url), [turn.audio_url]);

  // "Hear it" (A4): the brain voices this saved reply once, then the same clip replays.
  async function hear() {
    if (!petRef) return;
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      const url = await requestVoice(petRef, turn.turn_id, authHeaders());
      setAudioUrl(url);
      // play after React has set the new src
      requestAnimationFrame(() => void audioRef.current?.play().catch(() => undefined));
    } catch (err) {
      const code = err instanceof BrainRequestError ? err.code : "upstream";
      setVoiceError(code === "brain_resting" ? `${name}'s voice is resting for today. The text is above.` : errorCopy(code, name));
    } finally {
      setVoiceBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="max-w-[90%] border-2 border-line bg-surface px-3 py-2">
        <span className="mr-2 font-display text-accent" title={turn.emotion}>
          <span aria-hidden>{EMOTION_ICON[turn.emotion] ?? "♥"}</span> {name}
        </span>
        <span className="font-display text-[18px] leading-6">{turn.reply}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {turn.status !== "canned" && <ReceiptBadge turnId={turn.turn_id} status={turn.verification} />}
        <FuelChip fuel={turn.fuel} />
        {audioUrl ? (
          <button type="button" className="pixel-btn pixel-btn--secondary min-h-[44px] px-3 text-sm"
            onClick={() => void audioRef.current?.play().catch(() => undefined)}>
            Play voice
          </button>
        ) : petRef && turn.status === "done" ? (
          <button type="button" className="pixel-btn pixel-btn--secondary min-h-[44px] px-3 text-sm"
            disabled={voiceBusy} onClick={() => void hear()}>
            {voiceBusy ? "Finding the voice..." : `Hear ${name}`}
          </button>
        ) : null}
        {audioUrl && <audio ref={audioRef} src={brainUrl(audioUrl)} preload="none" />}
      </div>
      {voiceError && <p className="text-sm text-warn" role="status">{voiceError}</p>}
      {turn.tasks.map((task) => <TaskCard key={task.id} task={task} name={name} onTask={onTask ? (d) => onTask(turn.turn_id, task, d) : undefined} />)}
    </div>
  );
}

export type TaskHandler = (turnId: string, task: McpTaskCard, decision: "approve" | "decline") => Promise<void>;

const TASK_STATUS: Record<McpTaskCard["status"], string> = {
  pending: "Waiting for you", approved: "Running...", done: "Done", failed: "Didn't work", declined: "Declined",
};

/** A tool call the pet proposed (web /mcp). It runs only when the owner presses Approve. */
function TaskCard({ task, name, onTask }: { task: McpTaskCard; name: string; onTask?: (d: "approve" | "decline") => Promise<void> }) {
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const args = Object.entries(task.args);
  const decide = async (d: "approve" | "decline") => {
    if (!onTask) return;
    setBusy(d);
    try {
      await onTask(d);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex w-full max-w-[90%] flex-col gap-2 border-2 border-accent bg-surface p-3" role="group" aria-label={`Task: ${task.tool}`}>
      <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span><span className="font-display">{name} wants to use</span> <span className="font-mono text-accent">{task.tool}</span> <span className="text-muted">({task.server})</span></span>
        <span className={`font-display text-xs ${task.status === "done" ? "text-fuel" : task.status === "failed" ? "text-warn" : "text-muted"}`}>{TASK_STATUS[task.status]}</span>
      </p>
      {args.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
          {args.slice(0, 8).map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-words">{typeof v === "string" ? v : JSON.stringify(v)}</dd></div>
          ))}
        </dl>
      )}
      {task.status === "failed" && task.error && (
        <p className="border-l-2 border-warn pl-2 font-mono text-xs text-warn break-words">{task.error}</p>
      )}
      {task.status === "pending" && onTask && (
        <div className="flex gap-2">
          <button type="button" className="pixel-btn px-3 text-sm" disabled={busy !== null} onClick={() => void decide("approve")}>
            {busy === "approve" ? "Running..." : "Approve"}
          </button>
          <button type="button" className="pixel-btn pixel-btn--secondary px-3 text-sm" disabled={busy !== null} onClick={() => void decide("decline")}>
            Decline
          </button>
        </div>
      )}
    </div>
  );
}

/** `petRef` turns on "Hear it" for the owner's saved replies. */
export function ChatLog({ entries, name, readOnly, petRef, onTask }: { entries: ChatEntry[]; name: string; readOnly?: boolean; petRef?: string; onTask?: TaskHandler }) {
  if (entries.length === 0) {
    return (
      <p className="text-muted">
        {readOnly ? `${name}'s chats are private to the owner.` : `Say hi to ${name}. Hold the button and talk.`}
      </p>
    );
  }
  return (
    <section aria-label="Chat" className="flex flex-col gap-4">
      {entries.map((e) => (
        <div key={e.key} className="flex flex-col gap-2">
          {e.note ? (
            <p className="max-w-[90%] border-2 border-line border-l-accent bg-surface px-3 py-2">
              <span className="mr-2 font-display text-accent">{name}</span>
              <span className="font-display text-[18px] leading-6">{e.note.text}</span>
            </p>
          ) : (
          <>
          <p className="self-end max-w-[85%] border-2 border-accent px-3 py-2">
            <span className="sr-only">You: </span>
            {e.user ?? <span className="text-muted">Voice message</span>}
          </p>
          {e.turn ? (
            <ReplyBubble turn={e.turn} name={name} petRef={readOnly ? undefined : petRef} onTask={readOnly ? undefined : onTask} />
          ) : e.error ? (
            <p className="text-warn"><span aria-hidden>! </span>{e.error}</p>
          ) : (
            <p className="font-display text-muted">{name} is thinking...</p>
          )}
          </>
          )}
        </div>
      ))}
    </section>
  );
}
