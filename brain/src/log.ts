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

function emit(level: string, msg: string, fields: Fields = {}) {
  const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...clean(fields) });
  if (level === "error" || level === "alert") console.error(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, f?: Fields) => emit("info", msg, f),
  warn: (msg: string, f?: Fields) => emit("warn", msg, f),
  error: (msg: string, f?: Fields) => emit("error", msg, f),
  /** Something the team must act on (charge failing, feeder low, NEAR AI 402). */
  alert: (msg: string, f?: Fields) => emit("alert", msg, f),
};
