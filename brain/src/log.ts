// Structured logs. CLAUDE.md rule 4: never log chat content or memories. Fields named below are
// dropped even if passed by mistake; log ids, costs, timings and statuses only.
const DENY = new Set([
  "text", "reply", "transcript", "soul", "prompt", "summary", "facts", "nickname", "audio",
  "secret", "token", "key", "content", "messages", "body",
]);

type Fields = Record<string, unknown>;

export function clean(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) out[k] = DENY.has(k.toLowerCase()) ? "[redacted]" : v;
  return out;
}

let alertSink: ((msg: string, fields: Fields) => void) | null = null;

/** O4: where `log.alert` lines also go (ops/alerts.ts webhook). Receives cleaned fields only. */
export function setAlertSink(sink: ((msg: string, fields: Fields) => void) | null): void {
  alertSink = sink;
}

function emit(level: string, msg: string, fields: Fields = {}) {
  const safe = clean(fields);
  const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...safe });
  if (level === "error" || level === "alert") console.error(line);
  else console.log(line);
  if (level === "alert" && alertSink) {
    try {
      alertSink(msg, safe);
    } catch {
      // an alert sink must never break the caller
    }
  }
}

export const log = {
  info: (msg: string, f?: Fields) => emit("info", msg, f),
  warn: (msg: string, f?: Fields) => emit("warn", msg, f),
  error: (msg: string, f?: Fields) => emit("error", msg, f),
  /** Something the team must act on (charge failing, feeder low, NEAR AI 402). */
  alert: (msg: string, f?: Fields) => emit("alert", msg, f),
};
