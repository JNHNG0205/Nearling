"use client";

import Link from "next/link";
import { useState, type KeyboardEvent } from "react";
import type { TalkPhase } from "@/lib/useTalk";
import css from "../nearling/nearling.module.css";

/**
 * Hold-to-talk (mouse, touch and keyboard) plus a text field. With no fuel the talk controls
 * are replaced by a Feed link; care still works (Build Spec 4).
 */
export function TalkBar(props: {
  petRef: string;
  name: string;
  phase: TalkPhase;
  lowFuel: boolean;
  micDenied: boolean;
  blocked: boolean;
  hint: string | null;
  errorText: string | null;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onText: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const busy = props.phase === "thinking";
  const listening = props.phase === "listening";

  if (props.lowFuel) {
    return (
      <div className="flex flex-col gap-2 border-2 border-danger p-3">
        <p><span aria-hidden className="text-danger">! </span>Out of fuel. {props.name} can&apos;t think until someone feeds the brain.</p>
        <Link href={`/feed/${encodeURIComponent(props.petRef)}`} className="pixel-btn self-start">
          Feed {props.name}
        </Link>
      </div>
    );
  }

  const keyDown = (e: KeyboardEvent) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      props.onHoldStart();
    }
  };
  const keyUp = (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      props.onHoldEnd();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {!props.micDenied && (
        <button
          type="button"
          className={`${css.hwBtn} min-h-[56px] w-full text-base`}
          data-held={listening}
          disabled={busy || props.blocked}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            props.onHoldStart();
          }}
          onPointerUp={props.onHoldEnd}
          onPointerCancel={props.onHoldEnd}
          onKeyDown={keyDown}
          onKeyUp={keyUp}
          onContextMenu={(e) => e.preventDefault()}
          aria-pressed={listening}
        >
          {listening ? "Listening. Let go to send" : busy ? `${props.name} is thinking...` : "Hold to talk"}
        </button>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() || busy || props.blocked) return;
          props.onText(text);
          setText("");
        }}
      >
        <label className="sr-only" htmlFor="talk-text">Message for {props.name}</label>
        <input
          id="talk-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          autoComplete="off"
          placeholder={`Type to ${props.name}`}
          className="min-h-[48px] min-w-0 flex-1 border-2 border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button type="submit" className="pixel-btn" disabled={busy || props.blocked || !text.trim()}>
          Send
        </button>
      </form>
      {props.micDenied && <p className="text-sm text-muted">Microphone is off, so typing works instead.</p>}
      {props.hint && <p className="text-sm text-muted">{props.hint}</p>}
      {props.errorText && <p className="text-sm text-warn" role="alert"><span aria-hidden>! </span>{props.errorText}</p>}
    </div>
  );
}
