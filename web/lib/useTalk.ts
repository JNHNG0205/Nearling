"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Emotion, TalkResponse } from "@petto/shared";
import { BrainRequestError, brainUrl, errorCopy, postTalk, type TalkInput } from "./brain";
import { authHeaders } from "./session";

export const TALK_TIMEOUT_MS = 25_000;
export const MAX_RECORD_MS = 12_000;
const MIN_RECORD_MS = 400;
const REACT_MS = 3_000;
/** Typewriter speed in the speech bubble (design.md section 5), so "talking" lasts as long as the reveal. */
const CHARS_PER_S = 40;

/**
 * Runs `send` with a timeout. On a network error or a timeout it retries once; the caller
 * reuses the same request_id, so the brain replays the saved reply and never charges twice
 * (AI-brain 03 section 2). Brain errors (4xx/5xx with a code) are not retried.
 */
export async function withOneRetry<T>(
  send: (signal: AbortSignal) => Promise<T>,
  timeoutMs = TALK_TIMEOUT_MS,
): Promise<T> {
  const attempt = async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await send(ctrl.signal);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt();
  } catch (err) {
    if (err instanceof BrainRequestError) throw err;
    return attempt();
  }
}

/** A 200 reply with status "failed": the brain made no charge, so the same request_id may be retried. */
export class FailedTurn extends Error {
  constructor() {
    super("upstream");
  }
}

/** Sprite phases of one talk (07-pet-animation section 4): listen -> think -> talk -> emotion -> loop. */
export type TalkPhase = "idle" | "listening" | "thinking" | "talking" | "reacting";

export interface LocalTalk {
  localId: string;
  requestId: string;
  text: string | null; // null for a voice message until the transcript arrives
  at: number;
}

export interface UseTalkOptions {
  petRef: string;
  name: string;
  onSent: (t: LocalTalk) => void;
  onReply: (t: LocalTalk, res: TalkResponse) => void;
  onError: (t: LocalTalk, code: string) => void;
}

export function useTalk({ petRef, name, onSent, onReply, onError }: UseTalkOptions) {
  const [phase, setPhase] = useState<TalkPhase>("idle");
  const [emotion, setEmotion] = useState<Emotion>("happy");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [micDenied, setMicDenied] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const holding = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const cb = useRef({ onSent, onReply, onError });
  cb.current = { onSent, onReply, onError };

  const clearPhaseTimer = () => {
    if (phaseTimer.current) clearTimeout(phaseTimer.current);
    phaseTimer.current = null;
  };

  useEffect(() => () => {
    clearPhaseTimer();
    if (stopTimer.current) clearTimeout(stopTimer.current);
    audio.current?.pause();
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const react = useCallback((e: Emotion) => {
    setEmotion(e);
    setPhase("reacting");
    clearPhaseTimer();
    phaseTimer.current = setTimeout(() => setPhase("idle"), REACT_MS);
  }, []);

  const showReply = useCallback((res: TalkResponse, spoken: boolean) => {
    setPhase("talking");
    clearPhaseTimer();
    const fallbackMs = Math.max(1500, (res.reply.length / CHARS_PER_S) * 1000);
    if (spoken && res.audio_url) {
      const a = new Audio(brainUrl(res.audio_url));
      audio.current?.pause();
      audio.current = a;
      a.onended = () => react(res.emotion);
      a.onerror = () => react(res.emotion); // text stays visible when audio fails
      a.play().catch(() => {
        phaseTimer.current = setTimeout(() => react(res.emotion), fallbackMs);
      });
    } else {
      phaseTimer.current = setTimeout(() => react(res.emotion), fallbackMs);
    }
  }, [react]);

  const send = useCallback(async (input: TalkInput) => {
    if (blockedUntil > 0) return;
    const local: LocalTalk = {
      localId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      text: "text" in input ? input.text : null,
      at: Date.now(),
    };
    setErrorCode(null);
    setHint(null);
    clearPhaseTimer();
    setPhase("thinking");
    cb.current.onSent(local);
    try {
      // A failed generation is HTTP 200 with status "failed" and no charge: retry it once with the same request_id.
      const res = await withOneRetry(async (signal) => {
        const r = await postTalk(petRef, local.requestId, input, authHeaders(), signal);
        if (r.status === "failed") throw new FailedTurn();
        return r;
      });
      cb.current.onReply(local, res);
      showReply(res, true); // the pet speaks every reply out loud, typed or held
    } catch (err) {
      const code = err instanceof BrainRequestError ? err.code : "upstream";
      if (err instanceof BrainRequestError && err.retryAfterS) {
        const until = Date.now() + err.retryAfterS * 1000;
        setBlockedUntil(until);
        setTimeout(() => setBlockedUntil((u) => (u === until ? 0 : u)), err.retryAfterS * 1000);
      }
      setErrorCode(code);
      setPhase("idle");
      cb.current.onError(local, code);
    }
  }, [petRef, blockedUntil, showReply]);

  const sendText = useCallback((text: string) => {
    const t = text.trim();
    if (t) void send({ text: t.slice(0, 500) });
  }, [send]);

  const stopHold = useCallback(() => {
    holding.current = false;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    const r = recorder.current;
    if (r && r.state === "recording") r.stop();
  }, []);

  const startHold = useCallback(async () => {
    if (micDenied || recorder.current?.state === "recording" || phase === "thinking") return;
    holding.current = true;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicDenied(true);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMicDenied(true);
      return;
    }
    if (!holding.current) {
      // released before the mic opened
      stream.getTracks().forEach((t) => t.stop());
      setHint("Hold the button while you talk.");
      return;
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const r = new MediaRecorder(stream, MediaRecorder.isTypeSupported(mime) ? { mimeType: mime } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      const held = Date.now() - startedAt.current;
      if (held < MIN_RECORD_MS || chunks.current.length === 0) {
        setPhase("idle");
        setHint("Hold the button while you talk.");
        return;
      }
      void send({ audio: new Blob(chunks.current, { type: r.mimeType || "audio/webm" }) });
    };
    recorder.current = r;
    startedAt.current = Date.now();
    r.start();
    clearPhaseTimer();
    setHint(null);
    setPhase("listening");
    stopTimer.current = setTimeout(stopHold, MAX_RECORD_MS);
  }, [micDenied, phase, send, stopHold]);

  return {
    phase, emotion, errorCode, micDenied, hint,
    busy: phase === "listening" || phase === "thinking",
    blocked: blockedUntil > 0,
    sendText, startHold, stopHold,
    errorText: errorCode ? errorCopy(errorCode, name) : null,
  };
}
