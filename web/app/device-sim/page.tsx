"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEVICE_GAS, deviceKey, sendDeviceTx, type DeviceKey, type DeviceTxResult,
} from "@nearling/device";
import type { PetState, PetView } from "@nearling/shared";
import { NearlingFrame } from "@/components/nearling/NearlingFrame";
import { PetSprite } from "@/components/PetSprite";
import { RoomQr } from "@/components/race/RoomQr";
import { AppFrame, ErrorText, Panel, Spinner, TxLink } from "@/components/wallet/ui";
import { BRAIN_URL, getPetState } from "@/lib/brain";
import { RPC_URL, formatNear, getPet, petFromRef, petPath, view } from "@/lib/chain";
import { errorText, friendlyChainError } from "@/lib/errors";

// /device-sim: a browser Nearling that behaves like the hardware (docs/hardware/DEVICE_PROTOCOL.md).
// Real brain calls with a real device token, real testnet transactions signed in the browser by
// a limited function-call key (packages/device). Nothing is mocked. Testnet only.

const STORE = "nearling.devicesim.v1";
const HOLD_MS = 2000;
const POLL_MS = 3000;
const PANTRY_BITE = 50_000_000_000_000_000_000_000n; // 0.05 NEAR per feed_from_pantry

interface SimStore {
  hw_id: string;
  device_secret: string;
  key: DeviceKey;
  device_token?: string;
  pet_ref?: string;
}

interface Pending {
  id: string;
  summary: string;
  expires_at?: number;
}

interface TxLine {
  label: string;
  hash: string;
  error?: string;
}

const randHex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

function loadStore(): SimStore {
  try {
    const raw = window.localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw) as SimStore;
  } catch {
    // fall through: a fresh device
  }
  const fresh: SimStore = { hw_id: `sim-${randHex(6)}`, device_secret: randHex(24), key: deviceKey() };
  saveStore(fresh);
  return fresh;
}

function saveStore(s: SimStore) {
  try {
    window.localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // private window: the device forgets itself on reload
  }
}

async function brain<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T | null }> {
  const res = await fetch(`${BRAIN_URL}${path}`, init);
  return { status: res.status, body: (await res.json().catch(() => null)) as T | null };
}

const secretHeaders = (s: SimStore) => ({ "X-Device-Id": s.hw_id, "X-Device-Secret": s.device_secret });
const deviceAuth = (s: SimStore) => ({ Authorization: `Device ${s.device_token}` });

/** Accepts the brain's `GET /devices/actions` items and the contract's own `get_pending_actions`. */
function toPending(raw: unknown): Pending | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.id ?? r.action_id;
  if (typeof id !== "string" && typeof id !== "number") return null;
  const expiresNs = typeof r.expires_at_ns === "string" ? Number(BigInt(r.expires_at_ns) / 1_000_000n) : undefined;
  return {
    id: String(id),
    summary: typeof r.summary === "string" ? r.summary : describeAction(r.action),
    expires_at: typeof r.expires_at === "number" ? r.expires_at : expiresNs,
  };
}

function describeAction(a: unknown): string {
  if (typeof a === "string") return a;
  if (!a || typeof a !== "object") return "Unknown action";
  const [kind, v] = Object.entries(a as Record<string, Record<string, unknown>>)[0] ?? ["Action", {}];
  if (v && typeof v.amount === "string") return `${kind} ${formatNear(v.amount)} NEAR`;
  if (v && typeof v.receiver_id === "string") return `${kind} to ${v.receiver_id}`;
  if (v && typeof v.on === "boolean") return `${kind}: ${v.on ? "on" : "off"}`;
  return kind;
}

type Phase =
  | { k: "booting" }
  | { k: "pairing"; url: string; status: string; petName?: string }
  | { k: "lost_token" }
  | { k: "paired" };

export default function DeviceSimPage() {
  const [store, setStore] = useState<SimStore | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "booting" });
  const [error, setError] = useState<string | null>(null);

  const update = useCallback((s: SimStore) => {
    saveStore(s);
    setStore(s);
  }, []);

  // Boot: POST /devices/hello, like the firmware does on every power-on.
  const hello = useCallback(async (s: SimStore) => {
    setError(null);
    setPhase({ k: "booting" });
    try {
      const r = await brain<{ bound: boolean; pet_ref?: string; pairing?: { qr_url: string } }>("/devices/hello", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hw_id: s.hw_id, device_secret: s.device_secret, fw_version: "browser-sim", device_pk: s.key.publicKey }),
      });
      if (r.status !== 200 || !r.body) throw new Error(`hello failed (${r.status})`);
      if (r.body.bound) {
        if (s.device_token && r.body.pet_ref === s.pet_ref) setPhase({ k: "paired" });
        else setPhase({ k: "lost_token" });
      } else if (r.body.pairing) {
        if (s.device_token) update({ ...s, device_token: undefined, pet_ref: undefined });
        setPhase({ k: "pairing", url: r.body.pairing.qr_url, status: "open" });
      }
    } catch (e) {
      setError(`Can't reach the brain at ${BRAIN_URL}. ${errorText(e)}`);
    }
  }, [update]);

  useEffect(() => {
    const s = loadStore();
    setStore(s);
    void hello(s);
  }, [hello]);

  // Pairing: poll GET /devices/pairing until the owner claims the code on /hatch.
  useEffect(() => {
    if (phase.k !== "pairing" || !store) return;
    const id = window.setInterval(async () => {
      const r = await brain<{ status: string; pet_name?: string }>("/devices/pairing", { headers: secretHeaders(store) }).catch(() => null);
      if (!r?.body) return;
      if (r.body.status === "expired") void hello(store);
      else setPhase((p) => (p.k === "pairing" ? { ...p, status: r.body!.status, petName: r.body!.pet_name } : p));
    }, 2000);
    return () => window.clearInterval(id);
  }, [phase.k, store, hello]);

  const confirm = async () => {
    if (!store) return;
    setError(null);
    const r = await brain<{ device_token: string; pet_ref: string }>("/devices/pairing/confirm", {
      method: "POST",
      headers: secretHeaders(store),
    });
    if (r.status !== 200 || !r.body) {
      setError(`Pairing failed (${r.status}).`);
      return;
    }
    update({ ...store, device_token: r.body.device_token, pet_ref: r.body.pet_ref });
    setPhase({ k: "paired" });
  };

  const factoryReset = () => {
    const fresh: SimStore = { hw_id: `sim-${randHex(6)}`, device_secret: randHex(24), key: deviceKey() };
    update(fresh);
    void hello(fresh);
  };

  return (
    <AppFrame title="Device simulator">
      <Panel>
        <p className="text-sm">
          A Nearling in your browser. It does what the hardware does: pairs with the brain, shows your pet and signs
          its own NEAR testnet transactions with a limited device key.
        </p>
        <p className="border-2 border-warn px-2 font-display text-sm text-warn">browser device, testnet only</p>
        {store && (
          <p className="break-all font-mono text-xs text-muted">
            hw_id {store.hw_id}
            <br />
            device key {store.key.publicKey}
          </p>
        )}
      </Panel>

      {phase.k === "booting" && <Spinner label="Booting..." />}

      {phase.k === "pairing" && (
        <NearlingFrame
          label="Pairing screen"
          buttons={
            <button className="pixel-btn" disabled={phase.status !== "awaiting_confirm"} onClick={() => void confirm()}>
              Pair
            </button>
          }
        >
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-2 text-center">
            {phase.status === "awaiting_confirm" ? (
              <p className="font-display text-lg">Pair {phase.petName ?? "this pet"}? Press Pair.</p>
            ) : (
              <>
                <RoomQr url={phase.url} size={150} />
                <a href={phase.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent underline">
                  Open the pairing link
                </a>
              </>
            )}
          </div>
        </NearlingFrame>
      )}

      {phase.k === "lost_token" && (
        <Panel>
          <p>This browser device is paired, but its device token was lost. Unpair it on the pet page, or reset it.</p>
        </Panel>
      )}

      {phase.k === "paired" && store?.device_token && store.pet_ref && <Paired store={store} />}

      <ErrorText>{error}</ErrorText>
      <button className="self-start text-sm text-muted underline" onClick={factoryReset}>
        Factory reset (new device key, pair again)
      </button>
    </AppFrame>
  );
}

function Paired({ store }: { store: SimStore }) {
  const ref = petFromRef(store.pet_ref!)!;
  const [pet, setPet] = useState<PetState | null>(null);
  const [chain, setChain] = useState<(PetView & { pantry_yocto?: string }) | null>(null);
  const [actions, setActions] = useState<Pending[]>([]);
  const [txs, setTxs] = useState<TxLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [state, onChain] = await Promise.all([
      getPetState(store.pet_ref!).catch(() => null),
      getPet(ref.contract, ref.tokenId).catch(() => null),
    ]);
    if (state) setPet(state);
    if (onChain) setChain(onChain);
    // Pending approvals: the brain's device route, else the contract's own view (public data).
    const r = await brain<{ actions?: unknown[] }>("/devices/actions", { headers: deviceAuth(store) }).catch(() => null);
    let list: unknown[] | null = r?.status === 200 && Array.isArray(r.body?.actions) ? r.body!.actions! : null;
    if (!list) list = await view<unknown[]>(ref.contract, "get_pending_actions", { pet_id: ref.tokenId }).catch(() => []);
    setActions(list.map(toPending).filter((a): a is Pending => !!a && (!a.expires_at || a.expires_at > Date.now())));
  }, [store, ref.contract, ref.tokenId]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const registered = !!chain && chain.device_pk === store.key.publicKey;

  const sign = async (label: string, methodName: string, args: object, gas: bigint) => {
    if (!pet) return;
    setBusy(label);
    setError(null);
    try {
      const r: DeviceTxResult = await sendDeviceTx(RPC_URL, {
        signerId: pet.owner, secretKey: store.key.secretKey, receiverId: ref.contract, methodName, args, gas,
      });
      const fail = r.failure ? friendlyChainError(JSON.stringify(r.failure), pet.name).message : undefined;
      setTxs((t) => [{ label, hash: r.txHash, error: fail }, ...t].slice(0, 8));
      if (fail) setError(fail);
      void refresh();
    } catch (e) {
      const text = errorText(e);
      setError(
        /access key|does not exist|AccessKeyNotFound|InvalidAccessKey/i.test(text)
          ? "This device key is not on the owner's account yet. Add it on the pet's device page."
          : friendlyChainError(text, pet.name).message,
      );
    } finally {
      setBusy(null);
    }
  };

  const pat = async () => {
    // Offline care first (instant on the hardware), then the signed on-chain pat.
    await brain("/pets/" + encodeURIComponent(store.pet_ref!) + "/care", {
      method: "POST",
      headers: { ...deviceAuth(store), "Content-Type": "application/json" },
      body: JSON.stringify({ events: [{ id: crypto.randomUUID(), kind: "pat", at: Date.now() }] }),
    }).catch(() => null);
    await sign("Pat", "play", { pet_id: ref.tokenId, action: "pet" }, DEVICE_GAS.play);
  };

  if (!pet) return <Spinner label="Loading your pet..." />;
  const pantry = chain?.pantry_yocto ? BigInt(chain.pantry_yocto) : 0n;
  const bite = pantry < PANTRY_BITE ? pantry : PANTRY_BITE;
  const action = actions[0];

  return (
    <>
      <NearlingFrame
        label={`${pet.name} on the browser device`}
        buttons={
          <div className="flex flex-wrap justify-center gap-3">
            <button className="pixel-btn" disabled={!!busy || !registered} onClick={() => void pat()}>
              {busy === "Pat" ? "Signing..." : "Pat"}
            </button>
            {pantry > 0n && (
              <button
                className="pixel-btn pixel-btn--secondary"
                disabled={!!busy || !registered}
                onClick={() => void sign("Feed", "feed_from_pantry", { pet_id: ref.tokenId, amount: bite.toString() }, DEVICE_GAS.feed_from_pantry)}
              >
                {busy === "Feed" ? "Signing..." : `Feed ${formatNear(bite, 2)}`}
              </button>
            )}
          </div>
        }
      >
        {action ? (
          <ApproveScreen
            action={action}
            busy={busy === "Approve"}
            disabled={!!busy || !registered}
            onApprove={() => void sign("Approve", "approve_action", { action_id: action.id }, DEVICE_GAS.approve_action)}
          />
        ) : (
          <PetSprite
            traits={pet.traits}
            stageIndex={pet.stage_index}
            winged={pet.form === "winged"}
            shirt={pet.equipped_shirt}
            state={pet.display_state}
            scale={6}
            label={`${pet.name}, ${pet.display_state}`}
          />
        )}
      </NearlingFrame>

      <Panel>
        <p className="font-display text-lg">{pet.name}</p>
        <p className="font-mono text-sm">
          {pet.display_state} · fuel {pet.fuel.left}
          {pantry > 0n && <> · pantry {formatNear(pantry, 3)} NEAR</>}
        </p>
        {registered ? (
          <p className="text-sm text-fuel">Device key registered on {ref.contract}. This browser signs for {pet.owner}.</p>
        ) : (
          <p className="text-sm">
            The contract does not know this device key yet. On{" "}
            <Link className="text-accent underline" href={petPath(ref.contract, ref.tokenId, "/device")}>
              the pet&apos;s device page
            </Link>
            , add <span className="break-all font-mono text-xs">{store.key.publicKey}</span> as a function-call key and
            register it.
          </p>
        )}
      </Panel>

      {txs.length > 0 && (
        <Panel>
          <p className="font-display">Signed by this device</p>
          <ul className="flex flex-col gap-1">
            {txs.map((t) => (
              <li key={t.hash} className="font-mono text-sm">
                {t.label} <TxLink hash={t.hash} /> {t.error ? <span className="text-danger">failed</span> : "ok"}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <ErrorText>{error}</ErrorText>
    </>
  );
}

/** Approve screen: shows the exact action, then hold Approve for 2 s (Build Spec 7, CLAUDE.md 7.3). */
function ApproveScreen({
  action, busy, disabled, onApprove,
}: { action: Pending; busy: boolean; disabled: boolean; onApprove: () => void }) {
  const [progress, setProgress] = useState(0);
  const timer = useRef<number | null>(null);
  const started = useRef(0);

  const stop = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setProgress(0);
  };
  const start = () => {
    if (disabled) return;
    started.current = Date.now();
    timer.current = window.setInterval(() => {
      const p = Math.min(1, (Date.now() - started.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        stop();
        onApprove();
      }
    }, 50);
  };
  useEffect(() => stop, []);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-3 text-center">
      <p className="font-display text-sm">Approve?</p>
      <p className="font-display text-lg">{action.summary}</p>
      <p className="font-mono text-xs text-muted">action #{action.id}</p>
      <button
        className="pixel-btn relative w-full overflow-hidden"
        disabled={disabled}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !timer.current && start()}
        onKeyUp={stop}
      >
        <span className="absolute inset-y-0 left-0 bg-fuel/40" style={{ width: `${progress * 100}%` }} aria-hidden />
        <span className="relative">{busy ? "Signing..." : "Hold to approve"}</span>
      </button>
    </div>
  );
}
