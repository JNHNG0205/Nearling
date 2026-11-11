"use client";

import { useEffect, useRef, useState } from "react";

/** Counts up once when it scrolls into view (landing section 5 type moment). Reduced motion: final value. */
export function CountUp({ to, decimals = 0, ms = 1200, className = "" }: { to: number; decimals?: number; ms?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Show the real value until the count actually starts, so screenshots, crawlers and
    // anyone who never scrolls here see the true figure, never 0.
    let raf = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      io.disconnect();
      setValue(0);
      const start = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - start) / ms);
        // stepped, like a pixel counter
        setValue(Math.round(to * k * 10 ** decimals) / 10 ** decimals);
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, decimals, ms]);

  return <span ref={ref} className={className}>{value.toFixed(decimals)}</span>;
}
