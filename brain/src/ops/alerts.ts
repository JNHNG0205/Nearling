/**
 * O4: `log.alert` lines also go to `ALERT_WEBHOOK_URL` (Discord or Slack incoming webhook). The
 * payload carries `content` (Discord) and `text` (Slack) with the message and the already cleaned
 * fields (ids, costs, statuses; log.ts drops content fields). Rate limited: the same message at
 * most once per 10 min, and at most 20 posts per hour in total. A failed post is dropped quietly
 * (it must not loop back into `log.alert`).
 */

type Fetch = typeof fetch;

export const SAME_ALERT_EVERY_MS = 10 * 60_000;
export const MAX_ALERTS_PER_HOUR = 20;

export function formatAlert(msg: string, fields: Record<string, unknown>): string {
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  return `[nearling brain] ${msg}${parts.length ? ` (${parts.join(", ")})` : ""}`.slice(0, 1900);
}

export function createAlertWebhook(url: string, opts: { fetch?: Fetch; now?: () => number } = {}) {
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const lastByMsg = new Map<string, number>();
  let sent: number[] = [];

  return (msg: string, fields: Record<string, unknown>): boolean => {
    const t = now();
    const last = lastByMsg.get(msg);
    if (last !== undefined && t - last < SAME_ALERT_EVERY_MS) return false;
    sent = sent.filter((s) => t - s < 3_600_000);
    if (sent.length >= MAX_ALERTS_PER_HOUR) return false;
    lastByMsg.set(msg, t);
    sent.push(t);
    const line = formatAlert(msg, fields);
    void f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: line, text: line }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
    return true;
  };
}
