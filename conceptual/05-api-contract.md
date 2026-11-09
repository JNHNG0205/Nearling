# 05. Interfaces: brain routes, shared types, asks to other roles

Status: **proposal**. Routes marked NEW are not in CLAUDE.md 8.2 yet; per CLAUDE.md 2.1 they need agreement from the affected role before they become [FIXED].

---

## 1. Brain HTTP routes

| Route | Auth | In CLAUDE.md? | Purpose |
|---|---|---|---|
| `GET /auth/nonce` | none | NEW | NEP-413 challenge for `/session` |
| `POST /session` | NEP-413 | yes | Returns session JWT |
| `GET /pets/:id/state` | public | yes | `PetState` (below) |
| `POST /pets/:id/chat` | session or device | yes | JSON `{ text }` or multipart `audio` -> `ChatReply` |
| `GET /pets/:id/inbox?after=<id>` | session or device | yes | `InboxItem[]` |
| `POST /pets/:id/inbox/read` | session or device | NEW | Mark read up to id |
| `GET /pets/:id/stream` | session | NEW | SSE: `state`, `inbox`, `thought_settled`, `thought_verified`, `action_pending` |
| `GET /pets/:id/timeline` | public | NEW | `TimelineItem[]` (nfts track) |
| `GET /pets/:id/thoughts?limit=` | session | NEW | Recent thoughts with cost and verify status (no content) |
| `GET /thoughts/:id/verification` | public | NEW | Verification detail JSON (hashes, signer, attestation) |
| `GET /attestation` | public | NEW | Latest attestation summary for `/privacy` |
| `POST /pets/:id/pair` | session | yes (reshaped, see 3) | `{ code }` -> `{ device_pk }` |
| `POST /devices/hello` | none | NEW (Role 4) | Device announces `device_pk`, gets `{ code, poll_secret }` |
| `POST /devices/claim` | poll secret | yes (reshaped) | Device gets `{ token, pet_id, owner }` once paired |
| `GET /pets/:id/actions` | device | (Role 4 `actions.ts`) | Pending actions for the approve screen |
| `PUT /me/timezone` | session | NEW | Owner timezone for night mode and morning pings |

---

## 2. Shared types (`packages/shared/src/index.ts`)

```ts
// Contract returns PascalCase ("Happy", "Sad", ...); map to these. Sad = fed and awake, mood < 40.
export type LifeState = "happy" | "sad" | "hungry" | "sleepy" | "starving" | "dormant";
export type Stage = "egg" | "baby" | "teen" | "adult";
export type SpriteState =
  | "idle" | "happy" | "petted" | "talking" | "thinking" | "listening" | "eating"
  | "hungry" | "sleepy" | "sleeping" | "dormant" | "sad" | "excited";
export type Traits = { playful: number; curious: number; calm: number; sassy: number; kind: number };

export interface PetState {
  id: string; name: string; owner: string;
  stage: Stage; xp: number; next_stage_xp: number | null;
  traits: Traits; items: number[];
  life_state: LifeState; sprite: SpriteState;
  stats: { fullness: number; mood: number; energy: number };
  budget: {
    credit_micro: string;            // strings for big numbers
    food_yocto: string;
    staked_yocto: string;
    pending_unstake: { amount_yocto: string; unlock_epoch: number } | null;
    daily_burn_micro: string;
    daily_credit_micro: string;      // accrual from stake
    days_left: number;               // computed by brain, same for web and device
    self_sustaining: boolean;
    farm_rate_micro_per_near_day: number;  // for client interpolation
    near_usd_rate_micro: number;
    simulated: boolean;              // true if NEARON fallback is active (CLAUDE.md rule 5)
  };
  streak: number;
  approval_mode: boolean;
  has_device: boolean;
  as_of_ms: number;                  // block time the view was settled to
}

export interface ChatReply {
  thought_id: string | null;        // null for canned
  reply: string;
  canned: boolean;
  sprite_state: SpriteState;
  cost: { estimate_usd: number; source: "credit" | "food" | "mixed" | "free" };
  billing: "queued" | "settled" | "free";
  verify: "pending" | "verified" | "unverified" | "none";
  transcript?: string;              // when audio was sent
  stats_preview: { mood: number; energy: number; xp: number };
}

export interface InboxItem { id: number; trigger: string; text: string; created_at: number; read: boolean; thought_id: string | null }

export interface ThoughtSummary {
  id: string; kind: "chat" | "greeting" | "summary" | "stt";
  model: string; tokens: { prompt: number; completion: number };
  est_cost_nano: string; billed_cost_nano: string | null; charged_micro: string | null;
  charge_status: "queued" | "sent" | "settled" | "failed" | "skipped"; charge_tx: string | null;
  verify_status: "pending" | "verified" | "unverified" | "error";
  created_at: number;
}

export interface TimelineItem {
  kind: "born" | "fed" | "staked" | "unstaked" | "withdrawn" | "credit_swept" | "thoughts_day"
      | "stage_up" | "item_bought" | "dormant" | "revived" | "owner_changed" | "device_registered";
  actor: string | null; amount: string | null; tx: string | null; at: number; detail?: Record<string, unknown>;
}

export const NEP413_MESSAGE = "Sign in to Nearling";
export const NEP413_RECIPIENT = "nearling";
```

Rule: big numbers (yocto, micro, nano) are **strings** on the wire. Firmware parses only the fields it needs (`life_state`, `sprite`, `stats`, `budget.days_left`, `stage`, `items`).

---

## 3. Pairing: two readings in CLAUDE.md, proposal

CLAUDE.md 8.2 says `POST /pets/:id/pair` "returns a 6-digit code" (web shows code). CLAUDE.md 10 says "device shows a 6-digit code, owner enters it on web". These are two different flows.

**Proposal: device shows the code** (section 10 wins), because the web needs the device **public key** to run `AddKey` and `register_device`, and this flow carries it for free:

1. Device boots unpaired -> `POST /devices/hello { device_pk }` -> `{ code: "482913", poll_secret, expires_in: 600 }`. Device shows the code.
2. Owner on `/pet/[id]/device` enters the code -> `POST /pets/:id/pair { code }` (session) -> brain binds code to pet + owner, returns `{ device_pk }`.
3. Device polls `POST /devices/claim { poll_secret }` every 3 s -> once bound, gets `{ token, pet_id, owner }` and stores it.
4. Web runs AddKey + `register_device(pet_id, device_pk)`.

Needs Role 4 sign-off (they own `pairing.ts`).

---

## 4. Asks to other roles

### To Role 1 (contract)

Status from Role 1 (2026-11-09, contract as built on `pets-v5.nearling.testnet`):

| # | Status |
|---|---|
| C1 | **Mostly done.** `get_pet` returns `life_state`, `fullness`, `budget_micro`, `daily_credit_micro`, `self_sustaining`, `staked`, `pending_unstake`, `items`, `device_pk` (big numbers as strings). **Agreed:** `daily_burn_micro` added in M4b |
| C2 | **Agreed (M4b):** a repeated `usage_ref` (among the pet's last 32 charges) is a no-op: no charge, no event. Retry blindly |
| C3 | **Partly.** `thought { pet_id, cost_micro, usage_ref }` where `cost_micro` is the amount actually taken. **Agreed (M4b):** adds `source` = `credit` / `food` / `mixed` / `none` |
| C4 | **Agreed (M4b):** every panic starts with a stable code, e.g. `E_NOT_OWNER: Only the owner`; full list in `CLAUDE.md` 7.2. Current messages (codes will be prefixed): "Only the owner", "Only brain", "Only the pet's device", "Cooldown: try again later", "Pet is asleep", "Unstake and withdraw before transfer", "Stake at least ...", "Unstake already pending", "Unstake still locked" |
| C5 | **Agreed:** no `persona_hash` on chain; the brain keeps the persona |
| C6 | **Agreed (M4b):** same wasm at `pets-demo.nearling.testnet`, about 100× faster rates via config, `config.demo_speed = true` so clients label it "demo speed" |
| C7 | **Yes.** `charge` / `credit` check `predecessor == config.brain`, so any function-call key on the brain account works |
| C8 | **Yes.** NEP-181 `nft_tokens(from_index, limit)` is implemented |
| C9 | **Agreed (M4b):** `sweep_credit` calls `sync_from_farm()` then `claim_and_topup`, since `claimable` only updates after a sync (seen in S6) |


| # | Ask | Why |
|---|---|---|
| C1 | `get_pet` returns `life_state`, `fullness`, `self_sustaining`, `daily_burn_micro`, `daily_credit_micro` as computed fields | Brain and web must not re-implement settlement maths |
| C2 | `charge` rejects (or no-ops) a repeated `usage_ref` | Safe retries, no double charge |
| C3 | `thought` event includes `charged_micro` actually taken and `source` (credit / food / mixed) | Cost chip "paid from credit" |
| C4 | Panic messages start with stable codes (`E_COOLDOWN`, `E_NOT_OWNER`, `E_APPROVAL_MODE`, `E_STAKED`) | Friendly web errors |
| C5 | Who sets `persona_hash`? Proposal: brain-only `set_persona_hash(pet_id, hash)` or set on first `charge` | Unclear in spec |
| C6 | A **demo deployment** `pets-demo.<team>.testnet` with fast metabolism (e.g. 100x) so judges can watch hungry -> starving in minutes, labelled "demo speed" | Judges cannot wait days; mirrors the games prompt "fast-forward mode" |
| C7 | Confirm brain may use several **function-call keys** limited to `charge`, `credit`, `sweep_credit` | Security + nonce throughput |
| C8 | Enumerate all pets: `nft_tokens(from_index, limit)` (NEP-181) is enough | Scheduler |
| C9 | Should `sweep_credit` call `sync_from_farm` first? | NEARON docs list it |

### To Role 3 (device body / art)

- `art/sprites.json` format: `{ "frameW": 64, "frameH": 64, "fps": 6, "stages": { "baby": { "idle": [[x,y],[x,y]], ... } }, "items": { "1": { "anchor": "head", "frames": [...] } } }` or similar; agree by Nov 9.
- Sprite state list = `SpriteState` above.

### To Role 4 (device link)

- Pairing flow in section 3.
- Device auth header `Authorization: Device <token>`.
- `/chat` multipart field name `audio`, WAV 16 kHz mono, ≤ 10 s; reply JSON `ChatReply` (device shows `reply`, uses `sprite_state`).
- Brain gives the device a compact `/state?fields=device` variant if JSON size matters on ESP32.
