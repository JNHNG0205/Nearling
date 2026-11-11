"use client";

import { useEffect, useRef, useState } from "react";
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
}

const EMOTION_ICON: Record<string, string> = {
  happy: "♥", excited: "*", sleepy: "z", sad: "~", hungry: "!", curious: "?", silly: "@",
};

function ReplyBubble({ turn, name, petRef }: { turn: Turn; name: string; petRef?: string }) {
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
    </div>
  );
}

/** `petRef` turns on "Hear it" for the owner's saved replies. */
export function ChatLog({ entries, name, readOnly, petRef }: { entries: ChatEntry[]; name: string; readOnly?: boolean; petRef?: string }) {
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
            <ReplyBubble turn={e.turn} name={name} petRef={readOnly ? undefined : petRef} />
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
