"use client";

import { useEffect } from "react";
import { minutesAgo, type InboxItem } from "@/lib/brain";
import css from "./nearling.module.css";

const TOAST_MS = 8_000;

/** Messages the pet sent first (proactive, AI-brain 07). */
export function InboxPanel({ items, name }: { items: InboxItem[]; name: string }) {
  return (
    <section aria-label="Inbox" className="pixel-panel flex flex-col gap-3 p-3">
      <h2 className="font-display text-lg">From {name}</h2>
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
