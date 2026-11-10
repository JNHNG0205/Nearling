import type { Db } from "../db/db";

/** Global provider spend per UTC day (AI-brain 03 section 8). Logged cost, never charged as fuel. */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addSpend(db: Db, now: number, providerNano: number, ttsChars = 0): void {
  db.prepare(
    `INSERT INTO spend_daily (day, provider_nano, tts_chars) VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET provider_nano = provider_nano + excluded.provider_nano,
                                    tts_chars = tts_chars + excluded.tts_chars`,
  ).run(utcDay(now), Math.max(0, Math.round(providerNano)), ttsChars);
}

export function spentToday(db: Db, now: number): { provider_nano: number; tts_chars: number } {
  return (
    (db.prepare("SELECT provider_nano, tts_chars FROM spend_daily WHERE day = ?").get(utcDay(now)) as
      | { provider_nano: number; tts_chars: number }
      | undefined) ?? { provider_nano: 0, tts_chars: 0 }
  );
}

export function overSpendCap(db: Db, now: number, capUsd: number): boolean {
  return spentToday(db, now).provider_nano >= capUsd * 1e9;
}
