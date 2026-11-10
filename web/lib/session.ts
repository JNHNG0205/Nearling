"use client";

import { useSyncExternalStore } from "react";

/**
 * Brain session (NEP-413 sign-in -> JWT from POST /session), stored in localStorage.
 * Written by the sign-in flow (wallet area); read by every page that calls owner routes.
 */
export interface Session {
  account: string;
  token: string;
  expires_at: number;
}

const KEY = "nearling.session";
const EVENT = "nearling-session";

function read(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const s = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Session | null;
    return s && s.expires_at > Date.now() ? s : null;
  } catch {
    return null;
  }
}

let cached: Session | null = null;
let cachedRaw: string | null = null;
function snapshot(): Session | null {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = read();
  }
  return cached;
}

export function getSession(): Session | null {
  return read();
}

export function setSession(s: Session): void {
  window.localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event(EVENT));
}

export function clearSession(): void {
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

/** Headers for owner routes; empty when signed out. */
export function authHeaders(): Record<string, string> {
  const s = read();
  return s ? { Authorization: `Bearer ${s.token}` } : {};
}

export function useSession(): Session | null {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    snapshot,
    () => null,
  );
}
