"use client";

import { useEffect, useState } from "react";
import { minutesAgo, type InboxItem } from "@/lib/brain";
import css from "./nearling.module.css";

const TOAST_MS = 8_000;

/** Messages the pet sent first (proactive, AI-brain 07). */
export function InboxPanel({ items, name }: { items: InboxItem[]; name: string }) {
  return (
    <section aria-label="Inbox" className="pixel-panel flex flex-col gap-3 p-3">
      <h2 className="font-display text-lg">From {name}</h2>
      <AlertsToggle name={name} />
      {items.length === 0 ? (
        <p className="text-muted">No messages yet. {name} writes when something happens.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {[...items].reverse().map((i) => (
            <li key={i.id} className="flex flex-col border-l-2 border-accent pl-3">
              <span className="font-display text-[18px] leading-6">{i.text}</span>
              <span className="font-mono text-sm text-muted">{minutesAgo(i.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function InboxToast({ item, name, onClose }: { item: InboxItem; name: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, TOAST_MS);
    return () => clearTimeout(t);
  }, [item.id, onClose]);
  return (
    <div className={`${css.toast} pixel-panel flex items-start gap-3 p-3`} role="status">
      <p className="flex-1">
        <span className="font-display text-accent">{name}: </span>
        <span className="font-display text-[18px] leading-6">{item.text}</span>
      </p>
      <button type="button" className="pixel-btn pixel-btn--secondary min-h-[44px] px-3 text-sm" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/**
 * Browser alert for a new inbox message while this tab is open but hidden (W8). Web push to a
 * closed tab is roadmap; nothing is sent when permission was not granted.
 */
export function notifyInBackground(name: string, text: string): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || !document.hidden) return;
  try {
    new Notification(name, { body: text, tag: "petto-inbox" });
  } catch {
    // some mobile browsers only allow notifications from a service worker
  }
}

function AlertsToggle({ name }: { name: string }) {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);
  if (perm === "unsupported") return null;
  if (perm === "granted") return <p className="text-sm text-muted">Alerts are on while this tab is open.</p>;
  if (perm === "denied") return <p className="text-sm text-muted">Alerts are blocked in your browser settings.</p>;
  return (
    <button type="button" className="pixel-btn pixel-btn--secondary self-start px-3 text-sm"
      onClick={() => void Notification.requestPermission().then(setPerm).catch(() => undefined)}>
      Turn on alerts from {name}
    </button>
  );
}
