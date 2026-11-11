import type { Db } from "../db/db";

/** Global provider spend per UTC day (AI-brain 03 section 8). Logged cost, never charged as fuel. */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * ElevenLabs Flash v2.5 API price, USD per 1,000 characters. [VERIFY] against the plan we use;
 * overridden by `TTS_USD_PER_1K_CHARS` through `configureSpend` (ops module start).
 */
export const DEFAULT_TTS_USD_PER_1K_CHARS = 0.05;

const rates = { ttsUsdPer1kChars: DEFAULT_TTS_USD_PER_1K_CHARS };
let sttSink: ((nano: number) => void) | null = null;

/** Called once at boot (ops module): TTS price and where STT costs are recorded. */
export function configureSpend(opts: { ttsUsdPer1kChars?: number; sttSink?: ((nano: number) => void) | null }): void {
  if (opts.ttsUsdPer1kChars !== undefined) rates.ttsUsdPer1kChars = opts.ttsUsdPer1kChars;
  if (opts.sttSink !== undefined) sttSink = opts.sttSink;
}

export const sttSpendTracked = () => sttSink !== null;

/** The NEAR AI client reports each transcription's cost here (A6). No-op until configured. */
export function reportSttSpend(nano: number): void {
  if (sttSink && Number.isFinite(nano) && nano > 0) sttSink(nano);
}

export function addSpend(db: Db, now: number, providerNano: number, ttsChars = 0, sttNano = 0): void {
  db.prepare(
    `INSERT INTO spend_daily (day, provider_nano, tts_chars, stt_nano) VALUES (?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET provider_nano = provider_nano + excluded.provider_nano,
                                    tts_chars = tts_chars + excluded.tts_chars,
                                    stt_nano = stt_nano + excluded.stt_nano`,
  ).run(utcDay(now), Math.max(0, Math.round(providerNano)), ttsChars, Math.max(0, Math.round(sttNano)));
}

/** Billing reconcile (A5): moves a day's provider spend by the billed-minus-estimated delta, never below 0. */
export function adjustProviderSpend(db: Db, day: string, deltaNano: number): void {
  const d = Math.round(deltaNano);
  db.prepare(
    `INSERT INTO spend_daily (day, provider_nano) VALUES (?, MAX(0, ?))
     ON CONFLICT(day) DO UPDATE SET provider_nano = MAX(0, provider_nano + ?)`,
  ).run(day, d, d);
}

export interface SpendToday {
  provider_nano: number;
  tts_chars: number;
  stt_nano: number;
}

export function spentToday(db: Db, now: number): SpendToday {
  return (
    (db.prepare("SELECT provider_nano, tts_chars, stt_nano FROM spend_daily WHERE day = ?").get(utcDay(now)) as
      | SpendToday
      | undefined) ?? { provider_nano: 0, tts_chars: 0, stt_nano: 0 }
  );
}

/** TTS characters in nano-USD at the configured price. */
export function ttsNano(chars: number, usdPer1k = rates.ttsUsdPer1kChars): number {
  return Math.round((chars / 1000) * usdPer1k * 1e9);
}

/** Chat and summaries (billed where reconciled) + STT + TTS, in nano-USD. */
export function totalSpendNano(s: SpendToday, usdPer1k = rates.ttsUsdPer1kChars): number {
  return s.provider_nano + s.stt_nano + ttsNano(s.tts_chars, usdPer1k);
}

export function overSpendCap(db: Db, now: number, capUsd: number, ttsUsdPer1k = rates.ttsUsdPer1kChars): boolean {
  return totalSpendNano(spentToday(db, now), ttsUsdPer1k) >= capUsd * 1e9;
}
