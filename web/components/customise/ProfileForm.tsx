"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorText, Panel } from "@/components/wallet/ui";
import type { PetData } from "@/components/wallet/usePet";
import { BrainRequestError, getProfile, putProfile } from "@/lib/brain";
import { brainErrorCopy } from "@/lib/errors";
import { authHeaders } from "@/lib/session";

const NICKNAME_MAX = 32;

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function ProfileForm({ pet }: { pet: PetData }) {
  const name = pet.chain!.name;
  const [nickname, setNickname] = useState("");
  const [tz, setTz] = useState(browserZone);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [browserZone()];
    }
  }, []);

  useEffect(() => {
    getProfile(pet.ref, authHeaders())
      .then((p) => {
        if (!p) return;
        if (p.nickname) setNickname(p.nickname);
        if (p.owner_tz) setTz(p.owner_tz);
      })
      .catch(() => undefined);
  }, [pet.ref]);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await putProfile(pet.ref, authHeaders(), { nickname: nickname.trim() || null, owner_tz: tz });
      setSaved(true);
      } catch (err) {
      setError(brainErrorCopy(err instanceof BrainRequestError ? err.code : "upstream", name));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <label className="flex flex-col gap-2">
        <span className="font-display text-sm">What {name} calls you</span>
        <input
          value={nickname}
          maxLength={NICKNAME_MAX}
          onChange={(e) => {
            setNickname(e.target.value);
            setSaved(false);
          }}
          className="h-12 w-full border-2 border-line bg-bg px-3 text-base"
        />
        <span className="text-sm text-muted">Leave it empty and {name} asks your name. Stored encrypted by the brain.</span>
      </label>
      <label className="flex flex-col gap-2">
        <span className="font-display text-sm">Your time zone</span>
        <select
          value={tz}
          onChange={(e) => {
            setTz(e.target.value);
            setSaved(false);
          }}
          className="h-12 w-full border-2 border-line bg-bg px-3 font-mono text-base"
        >
          {(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
        <span className="text-sm text-muted">{name} says good morning and keeps quiet at night by this clock.</span>
      </label>
      <button className="pixel-btn" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving..." : "Save settings"}
      </button>
      {saved && <p className="font-mono text-sm text-fuel" role="status">Saved</p>}
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}
