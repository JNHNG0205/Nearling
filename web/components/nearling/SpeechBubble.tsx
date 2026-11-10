"use client";

import { useEffect, useState } from "react";
import css from "./nearling.module.css";

const CHARS_PER_S = 40;

/** Pixel speech bubble with a typewriter reveal (instant with reduced motion). */
export function SpeechBubble({ text, className = "" }: { text: string; className?: string }) {
  const [shown, setShown] = useState(0);

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
    <div className={`${css.bubble} font-display text-[18px] leading-6 ${className}`} aria-live="polite">
      <span className="sr-only">{text}</span>
      <span aria-hidden>{text.slice(0, shown)}</span>
    </div>
  );
}
