# 08. API reference

Base: `https://<brain-host>`. JSON unless noted. Big numbers (yocto) are strings. `:petRef` is URL-encoded `contract:token_id`.

**Auth**
- `S` = session: `Authorization: Bearer <JWT>` from `POST /session`; owner routes also check `get_pet.owner == sub`.
- `D` = device: `Authorization: Device <token>`.
- `P` = public.
- `device secret` = headers `X-Device-Id: <hw_id>` and `X-Device-Secret: <device_secret>` (the same pair sent in the `POST /devices/hello` body).

### Device auth in detail (firmware)

| Stage | How the device authenticates |
|---|---|
| First boot / every boot | `POST /devices/hello` with JSON `{ hw_id, device_secret (16 to 128 chars), fw_version? }`. The first call registers the device and stores only `sha256(device_secret)`; later calls with a different secret for the same `hw_id` get 401 `unauthorized` |
| While pairing | `GET /devices/pairing` and `POST /devices/pairing/confirm` with headers `X-Device-Id` and `X-Device-Secret`. Missing or wrong headers: 401 `unauthorized` |
| After pairing | Every other device call sends `Authorization: Device <device_token>` (returned once by `/devices/pairing/confirm`; the brain stores only its hash, so a lost token means unpair and pair again). The race WebSocket uses the same header |
| Owner changed | On every `/pets/:petRef/*` call the brain re-checks `get_pet.owner`; if the pet moved, the device is revoked (403 `not_owner`) and must pair again. `/devices/hello` also revokes and returns a fresh pairing |
| Wrong pet | A device token only works for its bound `pet_ref` (403 `not_owner` otherwise) |

All device traffic is HTTPS (and `wss://` for the race) to the hosted brain; see `docs/DEPLOY.md` section 4.

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
| `GET /race/ws?code=` | D or `&race_token=` | WebSocket (06 section 3, additions below) |
| `GET /race/matches/:id` | P | result |

### Race WebSocket as built (additions to 06 section 3)

Upgrade: `GET /race/ws?code=ABC123&race_token=...` (browser) or `GET /race/ws?code=ABC123` with `Authorization: Device <token>` (device). Before the upgrade the brain answers plain HTTP errors: 401 `unauthorized` (no token, or join first), 404 `not_found` (no such room), 409 `conflict` (room full or already started). Messages are JSON text frames up to 64 KB; send `hello` first.

Client to server: `hello { rules_version, name?, pet_ref? }`, `ready`, `ping { t_client }`, `lane { tick, lane: 0|1 }`, `crash { tick | null, inputs: number[] }` (`tick: null` = still alive, used to answer `request_inputs`).

Server to client (new or changed fields in bold):

| Message | Fields | When |
|---|---|---|
| `room` | `code`, `state` (`lobby`, `running`, `finished`, `interrupted`), `you` (your slot), `players[]` (`slot`, `kind`, `name`, `pet_ref`, `traits`, `stage`, `ready`, `connected`, `crashed`) | any change |
| `start` | `seed`, `start_at`, `rules_version`, **`match_id`** | both ready; again after a reconnect + `hello` |
| `opp_lane` | `slot`, `tick`, `lane` | opponent switched lanes (render only) |
| **`opp_crash`** | `slot`, `tick` (`null` = survived) | the opponent's result is known; also resent after a reconnect |
| **`request_inputs`** | | the opponent crashed 2 s of race clock ago (or 120 s ran out) and you have not reported: reply with `crash` (your crash tick or `null`) and all your lane-switch ticks. No reply within the wait: the brain replays the inputs it relayed and marks your report invalid |
| `result` | **`match_id`**, `winner_slot` (or `null`), `draw`, `crash_ticks` `[c0, c1]`, **`valid`** `[bool, bool]`, `reason` (`crash`, `time`, `same_tick`) | both results known; resent on reconnect |
| `interrupted` | `reason` (`disconnect`) | a player without a result was gone for more than 5 s |
| `pong` | `t_client`, `t_server` | reply to `ping` |
| **`error`** | `code`, `message`, `rules_version?` | `bad_message` (not JSON, unknown type, too big, crash without tick/inputs), `hello_first`, `rules_version` (then closed with 4001) |

Close codes from the server:

| Code | Reason | Client should |
|---|---|---|
| 4001 | `rules_version`: client rules differ from the room's | update firmware / reload the page |
| 4004 | `gone`: the room or slot no longer exists | go back to the lobby |
| 4009 | `replaced`: the same slot connected again elsewhere | stop reconnecting from this connection |
| 4010 | `room closed`: room expired (10 min after creation, never mid-race) | create a new room |

A dropped connection may reconnect to the same slot: re-send `hello`, then the brain resends `room`, `start` (if running), `opp_crash` (if known) or the final `result`.

## Ops (team only, basic auth)

`GET /ops`: spend today, charge queue depth and failures, orders by status, feeder balance, attestation status, NEARON claimable, org balance.
