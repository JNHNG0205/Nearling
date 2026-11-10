"use client";

import { useEffect, useRef } from "react";
import { brainUrl, type Turn } from "@/lib/brain";
import { FuelChip } from "./FuelChip";
import { ReceiptBadge } from "./ReceiptBadge";

/** One exchange: what the owner said and the pet's reply (or the pending / failed state). */
export interface ChatEntry {
  key: string;
  user: string | null; // null = voice message without transcript yet
  turn: Turn | null; // null while thinking
  error: string | null;
}

const EMOTION_ICON: Record<string, string> = {
  happy: "♥", excited: "*", sleepy: "z", sad: "~", hungry: "!", curious: "?", silly: "@",
};

function ReplyBubble({ turn, name }: { turn: Turn; name: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
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
        {turn.audio_url && (
          <>
            <button type="button" className="pixel-btn pixel-btn--secondary min-h-[44px] px-3 text-sm"
              onClick={() => void audioRef.current?.play().catch(() => undefined)}>
              Play voice
            </button>
            <audio ref={audioRef} src={brainUrl(turn.audio_url)} preload="none" />
          </>
        )}
      </div>
    </div>
  );
}

export function ChatLog({ entries, name, readOnly }: { entries: ChatEntry[]; name: string; readOnly?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length]);

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
          <p className="self-end max-w-[85%] border-2 border-accent px-3 py-2">
            <span className="sr-only">You: </span>
            {e.user ?? <span className="text-muted">Voice message</span>}
          </p>
          {e.turn ? (
            <ReplyBubble turn={e.turn} name={name} />
          ) : e.error ? (
            <p className="text-warn"><span aria-hidden>! </span>{e.error}</p>
          ) : (
            <p className="font-display text-muted">{name} is thinking...</p>
          )}
        </div>
      ))}
      <div ref={end} />
    </section>
  );
}
