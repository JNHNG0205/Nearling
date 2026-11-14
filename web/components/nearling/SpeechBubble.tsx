"use client";

import { useEffect, useRef, useState } from "react";
import css from "./nearling.module.css";

const CHARS_PER_S = 40;

/**
 * Pixel speech bubble with a typewriter reveal (instant with reduced motion). `compact` (the pet's
 * screen) uses smaller type and shows at most 5 whole lines; a longer reply scrolls inside the
 * bubble and follows the typing.
 */
export function SpeechBubble({ text, compact = false, className = "" }: { text: string; compact?: boolean; className?: string }) {
  const [shown, setShown] = useState(0);
  const lines = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = lines.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const n = Math.min(text.length, Math.floor(((now - start) / 1000) * CHARS_PER_S));
      setShown(n);
      if (n < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  return (
    <div className={`${css.bubble} font-display ${compact ? "text-[14px] leading-5" : "text-[18px] leading-6"} ${className}`} aria-live="polite">
      <span className="sr-only">{text}</span>
      <span ref={lines} aria-hidden className={compact ? "chat-scroll block max-h-[100px] overflow-y-auto break-words" : undefined}>
        {text.slice(0, shown)}
      </span>
    </div>
  );
}
