"use client";

import { useEffect, useRef } from "react";
import { streamUrl } from "./brain";

/** Live events from `GET /pets/:petRef/stream` (08-api-reference). */
export const STREAM_EVENTS = [
  "state", "fuel_charged", "fuel_added", "inbox", "evolved", "receipt_ready",
  "paired", "approval_ready", "approval_status",
] as const;
export type StreamEvent = (typeof STREAM_EVENTS)[number];
export type StreamHandlers = Partial<Record<StreamEvent, (data: Record<string, unknown>) => void>>;

const RETRY_MS = 5_000;

/**
 * Subscribes to the pet's SSE stream while a session token exists. The browser reconnects
 * on its own after a dropped connection; when the server closes it for good (for example an
 * expired token) we retry every 5 s. Handlers may change on every render.
 */
export function useStream(petRef: string, token: string | null, handlers: StreamHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!token || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const open = () => {
      es = new EventSource(streamUrl(petRef, token));
      for (const name of STREAM_EVENTS) {
        es.addEventListener(name, (e) => {
          let data: Record<string, unknown> = {};
          try {
            const parsed: unknown = JSON.parse((e as MessageEvent<string>).data || "{}");
            if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
          } catch {
            // ignore a malformed event
          }
          ref.current[name]?.(data);
        });
      }
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED && !stopped) {
          es.close();
          retry = setTimeout(open, RETRY_MS);
        }
      };
    };
    open();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [petRef, token]);
}
