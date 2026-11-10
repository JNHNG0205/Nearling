"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readRaceName, saveRaceName } from "@/components/race/RaceRoom";
import { createRoom, normalizeCode } from "@/lib/race";

// /race (03-pages-and-flows.md section 11): start a room or join one by code. No wallet needed.
export default function RacePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => setName(readRaceName()), []);

  const remember = () => saveRaceName(name.trim().slice(0, 16));

  const start = async () => {
    remember();
    setBusy(true);
    setProblem(null);
    try {
      const r = await createRoom();
      router.push(`/race/${r.code}`);
    } catch {
      setProblem("Could not start a race. The brain may be offline; try again in a moment.");
      setBusy(false);
    }
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    remember();
    router.push(`/race/${code}`);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col gap-6 px-4 py-6">
      <header className="flex items-center gap-3">
        <Link href="/" aria-label="Back home" className="font-display text-2xl text-muted hover:text-ink">&lt;</Link>
        <h1 className="font-display text-2xl">Nearling Run</h1>
      </header>

      <p>
        Two pets, one course, one button. Switch lanes to dodge the bars; the first pet to crash loses.
        Race a desk Nearling or another browser tab. Free, off chain.
      </p>

      <label className="flex flex-col gap-2">
        <span className="font-display text-sm">Your racer&apos;s name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={16}
          placeholder="Guest"
          className="pixel-panel h-12 px-3 font-display text-ink placeholder:text-muted"
        />
      </label>

      <section className="pixel-panel flex flex-col gap-3 p-4">
        <h2 className="font-display text-xl">Host</h2>
        <p className="text-sm text-muted">Get a 6-letter code and a QR to share with the other racer.</p>
        <button type="button" className="pixel-btn w-full" onClick={start} disabled={busy}>
          {busy ? "Starting..." : "Start a race"}
        </button>
      </section>

      <form className="pixel-panel flex flex-col gap-3 p-4" onSubmit={join}>
        <h2 className="font-display text-xl">Join</h2>
        <label className="flex flex-col gap-2">
          <span className="text-sm text-muted">Race code</span>
          <input
            value={code}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="ABC234"
            className="h-12 border-2 border-[var(--n-line)] bg-bg px-3 font-mono text-2xl tracking-[0.2em] text-ink placeholder:text-muted"
          />
        </label>
        <button type="submit" className="pixel-btn pixel-btn--secondary w-full" disabled={code.length !== 6}>
          Join a race
        </button>
      </form>

      {problem && (
        <p role="alert"><span className="font-display text-danger">Problem.</span> {problem}</p>
      )}
    </main>
  );
}
