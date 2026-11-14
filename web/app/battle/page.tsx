"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PetPicker } from "@/components/battle/PetPicker";
import { BattleRequestError, createBattle, joinBattle, normalizeCode } from "@/lib/battle";
import { authHeaders } from "@/lib/session";

// /battle (spec 3.3): pick a pet, then start a battle (code + QR for a friend) or join one by code.
export default function BattleLobbyPage() {
  const router = useRouter();
  const [pet, setPet] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setProblem(null);
    try {
      router.push(`/battle/${await work()}`);
    } catch (e) {
      setProblem(e instanceof BattleRequestError ? e.message : "The brain didn't answer. Try again in a moment.");
      setBusy(false);
    }
  };

  const start = () => pet && run(() => createBattle(pet, authHeaders()));
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pet || code.length !== 6) return;
    void run(async () => {
      await joinBattle(code, pet, authHeaders());
      return code;
    });
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-6 px-4 py-6 md:max-w-[760px] md:gap-8 md:px-6 md:py-10">
      <header className="flex items-center gap-3">
        <Link href="/" aria-label="Back home" className="font-display text-2xl text-muted hover:text-ink">&lt;</Link>
        <h1 className="font-display text-2xl">Battle</h1>
      </header>

      <p>
        Turn-based battles against a friend&apos;s pet. Each turn you both pick Fight or Run at the same time.
        Battles earn battle XP; levels raise HP and MP and unlock skills. Results are saved on NEAR.
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl">Your fighter</h2>
        <PetPicker value={pet} onChange={setPet} />
      </section>

      <section className="pixel-panel flex flex-col gap-3 p-4">
        <h2 className="font-display text-xl">Host</h2>
        <p className="text-sm text-muted">Get a 6-letter code and a QR to share with the other player.</p>
        <button type="button" className="pixel-btn w-full" onClick={start} disabled={busy || !pet}>
          {busy ? "Starting..." : "Start a battle"}
        </button>
      </section>

      <form className="pixel-panel flex flex-col gap-3 p-4" onSubmit={join}>
        <h2 className="font-display text-xl">Join</h2>
        <label className="flex flex-col gap-2">
          <span className="text-sm text-muted">Battle code</span>
          <input
            value={code}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="ABC234"
            className="h-12 border-2 border-[var(--n-line)] bg-bg px-3 font-mono text-2xl tracking-[0.2em] text-ink placeholder:text-muted"
          />
        </label>
        <button type="submit" className="pixel-btn pixel-btn--secondary w-full" disabled={busy || !pet || code.length !== 6}>
          Join the battle
        </button>
      </form>

      {problem && (
        <p role="alert"><span className="font-display text-danger">Problem.</span> {problem}</p>
      )}
    </main>
  );
}
