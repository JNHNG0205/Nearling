# 08. API reference

Base: `https://<brain-host>`. JSON unless noted. Big numbers (yocto) are strings. `:petRef` is URL-encoded `contract:token_id`.

**Auth**
- `S` = session: `Authorization: Bearer <JWT>` from `POST /session`; owner routes also check `get_pet.owner == sub`.
- `D` = device: `Authorization: Device <token>`.
- `P` = public.

**Errors:** `{ "error": { "code": "...", "message": "...", "retry_after_s"?: n } }`. Codes: `unauthorized`, `not_owner`, `not_found`, `rate_limited`, `brain_resting`, `bad_audio`, `expired`, `conflict`, `upstream`, `invalid`. In-character canned replies are 200 with `status: "canned"`.

## Identity

| Method, path | Auth | Body / query | Returns |
|---|---|---|---|
| `GET /auth/nonce` | P | | `{ nonce (base64, 32 bytes), message: "Sign in to Nearling", recipient: "nearling" }` |
| `POST /session` | P | `{ accountId, publicKey, signature, nonce }` | `{ token, accountId, expires_at }` |

## Pets

| Method, path | Auth | Returns |
|---|---|---|
| `GET /pets/:petRef/state` | P | `PetState` (below) |
| `GET /me/pets` | S | owned pets on both contracts with `PetState` |
| `PUT /pets/:petRef/profile` | S | `{ nickname?, owner_tz? }` |
| `GET /pets/:petRef/stream` | S | SSE: `state`, `fuel_charged`, `fuel_added`, `inbox`, `paired`, `approval_ready`, `approval_status`, `evolved` |
| `GET /pets/:petRef/timeline` | P | `TimelineItem[]` |

```ts
interface PetState {
  pet_ref: string; contract: string; token_id: string; demo_speed: boolean;
  name: string; owner: string; stage: "egg"|"baby"|"teen"|"adult"; form: "base"|"winged";
  display_state: "happy"|"sad"|"hungry"|"sleepy"|"starving"|"dormant";
  chain_life_state: string;
  fuel: { left: number; price_micro: number; budget_micro: number; daily_burn_micro: number; low: boolean };
  garden: { staked_yocto: string; credit_micro: number; daily_credit_micro: number;
            self_sustaining: boolean; pending_unstake: { amount: string; unlock_epoch: string } | null };
  soul_version: number; equipped_shirt: string | null;
  care: { mood: number; milestones: { pat: boolean; rock: boolean; sleep: boolean } };
  device: { paired: boolean; last_seen_at: number | null };
  as_of: number;
}
```

## Talk and receipts

| Method, path | Auth | Body | Returns |
|---|---|---|---|
| `POST /pets/:petRef/talk` | D or S | multipart `request_id`, `audio`, `voice` or JSON `{ request_id, text, voice }` | Talk response (03 section 2) |
| `GET /pets/:petRef/turns?limit=20` | S | | turns with text (owner only), fuel and verification status |
| `GET /audio/:key` | P (unguessable key, 24 h) | | `audio/wav` or `audio/mpeg` |
| `GET /receipts/:turnId` | S, or P if published | | Receipt (03 section 7) |
| `POST /receipts/:turnId/publish` | S | | `{ public: true }` |
| `GET /attestation` | P | | latest attestation summary per model |
| `GET /pets/:petRef/inbox?after=<id>` | D or S | | `InboxItem[]` |
| `POST /pets/:petRef/inbox/ack` | D or S | `{ up_to }` | `{ ok }` |

## Feed the Brain

| Method, path | Auth | Body | Returns |
|---|---|---|---|
| `GET /feed/packs` | P | | packs + enabled modes |
| `POST /orders` | P (payer may be anyone) | `{ pet_ref, pack_id, mode, origin_asset? }` | `Order` (live: deposit address, amount, deadline) |
| `GET /orders/:id` | P (unguessable id) | | `Order` with status |
| `POST /orders/:id/direct-tx` | P | `{ tx_hash }` | `Order` (brain verifies the tx) |
| `POST /orders/:id/simulate-pay` | P, only if `INTENTS_MODE` allows simulated | | `Order` |

## Devices and pairing (called by firmware)

| Method, path | Auth | Body | Returns |
|---|---|---|---|
| `POST /devices/hello` | device secret | `{ hw_id, device_secret, fw_version }` | `{ bound: false, pairing: { token, qr_url, expires_at } }` or `{ bound: true, pet_ref, token? }` |
| `GET /devices/pairing` | device secret | | `{ status, pet_name? }` |
| `POST /devices/pairing/confirm` | device secret | | `{ device_token, pet_ref }` |
| `GET /pairings/:token` | P | | `{ status, expires_at }` |
| `POST /pairings/:token/claim` | S | `{ pet_ref }` | `{ status: "awaiting_confirm" }` |
| `POST /pets/:petRef/unpair` | S | | `{ ok }` |
| `POST /pets/:petRef/care` | D or S | `{ events: [{ id, kind, at }] }` | `{ mood, milestones, form, evolved_now }` |
| `GET /pets/:petRef/closet` | D or S | | `{ shirts: [{ token_id, title }], equipped }` |
| `POST /pets/:petRef/closet/equip` | D or S | `{ token_id \| null }` | `{ equipped }` |

## Wallet (P1)

| Method, path | Auth | Body | Returns |
|---|---|---|---|
| `GET /wallet` | D or S | | `{ account_id, liquid_yocto, staked_yocto, validator }` |
| `GET/POST /wallet/recipients` | S (POST), D or S (GET) | `{ label, account_id }` | list |
| `POST /approvals` | D | `{ kind, receiver_id, amount_yocto?, token_id? }` | `Approval` |
| `POST /approvals/:id/approve` | D | | `Approval` |
| `POST /approvals/:id/reject` | D | | `Approval` |
| `GET /approvals/:id` | S (must be `account_id`) or D | | `Approval` |
| `POST /approvals/:id/submitted` | S | `{ tx_hash }` | `Approval` (brain checks the tx) |

## Race

| Method, path | Auth | Returns |
|---|---|---|
| `POST /race/rooms` | D or P | `{ code }` |
| `POST /race/rooms/:code/join` | P | `{ race_token, slot }` |
| `GET /race/ws?code=` | D or race_token | WebSocket (06 section 3) |
| `GET /race/matches/:id` | P | result |

## Ops (team only, basic auth)

`GET /ops`: spend today, charge queue depth and failures, orders by status, feeder balance, attestation status, NEARON claimable, org balance.
