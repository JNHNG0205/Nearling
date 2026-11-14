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
| First boot / every boot | `POST /devices/hello` with JSON `{ hw_id, device_secret (16 to 128 chars), fw_version?, device_pk? }`. `device_pk` is the device's ed25519 public key (`ed25519:<base58 of 32 bytes>`, 400 `invalid` otherwise); the brain stores it so the web can add it as a limited access key and `register_device` it. The first call registers the device and stores only `sha256(device_secret)`; later calls with a different secret for the same `hw_id` get 401 `unauthorized` |
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
| `POST /session` | P | `{ accountId, publicKey, signature, nonce }`; `signature` as base64, `ed25519:<base58>` or hex | `{ token, accountId, expires_at }` |

## Pets

| Method, path | Auth | Returns |
|---|---|---|
| `GET /pets/:petRef/state` | P | `PetState` (below) |
| `GET /me/pets` | S | `{ pets: PetState[] }`: pets the session account owns on `PETS_CONTRACT` and `DEMO_PETS_CONTRACT` (`nft_tokens_for_owner`, up to 50 each) |
| `PUT /pets/:petRef/profile` | S (owner) | Body `{ nickname?, owner_tz? }`, at least one. `nickname`: up to 24 letters, digits, spaces or `.'_-`, stored encrypted, used in the talk prompt for this owner only. `owner_tz`: IANA zone (e.g. `Asia/Kuala_Lumpur`), used for greetings and quiet hours. `null` or `""` clears. Returns `{ pet_ref, nickname, owner_tz }` |
| `GET /pets/:petRef/stream` | S | SSE: `state`, `fuel_charged`, `fuel_added`, `inbox`, `paired`, `approval_ready`, `approval_status`, `action_pending`, `evolved`. `action_pending` (`{ actions, approval_mode }`, same items as `GET /devices/actions`) is sent when the pet's on-chain pending action ids change; the brain polls `get_pending_actions` every 10 s for every pet with a bound device. Ownership is re-checked every 60 s; after a transfer the stream sends `event: closed` (`{ reason: "not_owner" }`) and ends |
| `GET /pets/:petRef/timeline?limit=50` | P | `TimelineItem[]`, newest first (below), max 100 |
| `GET /pets/:petRef/metadata` | P | Latest public metadata pinned to IPFS (docs/IPFS.md): `{ version, json_cid, png_cid, gateway_url, image_url, pinned_at, on_chain }`. `gateway_url` / `image_url` are HTTPS gateway links for the JSON and PNG; `on_chain` is true when the NFT's NEP-177 `metadata.reference` is `ipfs://<json_cid>` (pets-v9 `set_metadata`). 404 `not_found` until the first pin (or always, while `PINATA_JWT` is unset) |

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

### Timeline

Source: the pets contract's own `EVENT_JSON` logs, read every 30 s from the FastNEAR transactions API
(`https://tx.test.fastnear.com`, keyless: `POST /v0/account` lists the contract's txs from a per-contract
block-height cursor, `POST /v0/transactions` returns their receipts with logs, 20 per call). Only successful
receipts executed by the pets contract count. Rows are idempotent by (tx_hash, receipt_id, log_index, pet_ref);
a tx is read again on every pass until it is 2 minutes old, so late callback receipts (`staked` lands in
`on_stake`) are not missed. NearBlocks v3 was not used: its account listings carry no logs or args and ignore
`per_page`.

Fallback: when FastNEAR is unreachable, errors, or its newest block is over 5 minutes old, the brain diffs
`get_pet` snapshots for that contract and marks those rows `source: "snapshot"` (no tx hash or payer, amounts
net of metabolism drain, two changes of one kind inside 30 s merge). When the indexer recovers it replays from
its cursor and deletes that contract's snapshot rows.

```ts
interface TimelineItem {   // packages/shared
  id: number;
  kind: "minted" | "fed" | "thoughts_day" | "staked" | "staked_from_food" | "unstaked" | "unstake_withdrawn"
      | "soul_updated" | "stage_up" | "owner_changed" | "dormant" | "revived" | "credit_swept";
  actor: string | null;    // fed: payer (`by`); staked / unstake_withdrawn: owner; minted / owner_changed: new owner;
                           // others: tx signer; stage_up, dormant, revived, thoughts_day: null
  amount: string | null;   // yocto for fed / staked / staked_from_food / unstaked / unstake_withdrawn;
                           // version for soul_updated; stage index for stage_up; total micro-USD for thoughts_day
  tx_hash: string | null;  // null only on snapshot rows
  at: number;              // ms: block time (event), detection time (snapshot), newest thought (thoughts_day)
  source: "event" | "snapshot";
  count?: number;          // thoughts_day: thoughts that UTC day
  day?: string;            // thoughts_day: "YYYY-MM-DD"
}
```

Events kept: nearling `fed`, `thought`, `staked`, `staked_from_food`, `unstaked`, `unstake_withdrawn`,
`soul_updated` (prompt not copied), `stage_up`, `dormant`, `revived`, `credit_swept` (contract-wide: shown on every
pet of that contract); NEP-171 `nft_mint` (as `minted`) and `nft_transfer` (as `owner_changed`). `thought` events are
folded into one `thoughts_day` row per UTC day so chat does not flood the timeline; its `tx_hash` is the day's latest
charge. `played`, `device_*`, `action_*` and `item_bought` are left out.

## Talk and receipts

| Method, path | Auth | Body | Returns |
|---|---|---|---|
| `POST /pets/:petRef/talk` | D or S | multipart `request_id`, `audio`, `voice` or JSON `{ request_id, text, voice }` | Talk response (03 section 2) |
| `GET /pets/:petRef/turns?limit=20` | S | | turns with text (owner only), fuel and verification status |
| `GET /audio/:key` | P (unguessable key, 24 h) | | `audio/wav` or `audio/mpeg` |
| `GET /receipts/:turnId` | S, or P if published | | Receipt (03 section 7) |
| `POST /receipts/:turnId/publish` | S | | `{ public: true }` |
| `GET /pets/:petRef/receipts?public=1` | P with `public=1`, else S (owner) | | `{ receipts: Receipt[] }`, newest first, at most 20; `public=1` lists only published ones (for `/p/[petRef]`) |
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
| `POST /devices/hello` | device secret | `{ hw_id, device_secret, fw_version?, device_pk? }` | `{ bound: false, pairing: { token, qr_url, expires_at } }` or `{ bound: true, pet_ref, token? }` |
| `GET /devices/pairing` | device secret | | `{ status, pet_name? }` |
| `POST /devices/pairing/confirm` | device secret | | `{ device_token, pet_ref }` |
| `GET /pairings/:token` | P | | `{ status, expires_at }` |
| `POST /pairings/:token/claim` | S | `{ pet_ref }` | `{ status: "awaiting_confirm" }` |
| `POST /pets/:petRef/unpair` | S | | `{ ok }` |
| `GET /pets/:petRef/device` | S (owner) | | `{ paired, device_pk, last_seen_at, chain_device_pk, key_added, approval_mode, pantry_supported }`. `chain_device_pk` = `get_pet.device_pk`. `key_added` = the owner's `view_access_key_list` has a function-call key with `device_pk` and receiver = this pet's contract (`null` if the RPC failed). `pantry_supported` = `get_pet` has `pantry_yocto` (pets-v9, add `feed_from_pantry` to the key) |
| `GET /devices/actions` | D | | `{ pet_ref, contract, pet_id, approval_mode, key_registered, actions: [{ id, pet_id, action, deposit, proposer_pk, expires_at_ns, expires_at, summary }] }`. The pet's on-chain `get_pending_actions(pet_id)` without expired ones; `summary` is one line for the 240x240 screen (`Stake 1 NEAR`, `Unstake 0.5 NEAR`, `Collect unstaked NEAR`, `Turn approvals off`, `Give Mochi to bob.testnet`). `key_registered` = the device's `device_pk` equals `get_pet.device_pk`. The device approves by signing `approve_action(action_id)` with its limited key (450 Tgas for Stake / Unstake / Withdraw / StakeFromFood, `CLAUDE.md` 7.3) |
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

## Battle (replaced Race, 2026-11-14)

| Method, path | Auth | Body | Returns |
|---|---|---|---|
| `POST /battle/rooms` | S (owner of the pet) | `{ pet_ref }` | `{ code }` |
| `POST /battle/rooms/:code/join` | S (owner of the pet) | `{ pet_ref }` | `{ ok: true }` |
| `GET /battle/ws?code=&token=` | S (session token in the query) | | WebSocket |

Errors: 404 `not_found`; 409 `full`, `same_owner`, `same_pet`, `other_contract` (pets on different contracts), `daily_limit` (3 battles per pair of pets per day), `pet_busy` (the pet is fighting in another battle; joining or starting a room otherwise drops the pet's other waiting room); 422 `pet_unavailable` (starving or dormant); 429 `rate_limited`. The socket upgrade answers 401 before joining.

Messages (types in `packages/battle/src/protocol.ts`). Client: `ready`, `move { move: { kind: "attack" } | { kind: "skill", skill } | { kind: "defend" } | { kind: "dodge" } | { kind: "run" } }` (Defend and Dodge: rules version 2, not twice in a row, else `illegal_move`). Server: `room { you, code, pets, ready }`, `start { state, turnEndsAt }`, `turn { events, state, turnEndsAt }`, `end { winner, reason: ko|run|turns|forfeit, battleId, xp, levels }` (`xp` with the daily cap applied, `levels` = [before, after] per pet; resent on reconnect), `saved { tx }`, `save_failed`, `error { code: illegal_move|already_moved|bad_message|not_started }`. Turns last 20 s (a missing move becomes Attack); a player gone for 30 s forfeits. The result is queued as one `record_battle` job (table `battle_job`, retried with backoff, 8 attempts).

## Brain signing keys (config)

A function-call key works for one receiver contract, so the brain has one key set per pets contract: `BRAIN_KEYS_PETS` (falls back to `BRAIN_KEYS`) for `PETS_CONTRACT` and `BRAIN_KEYS_DEMO` for `DEMO_PETS_CONTRACT`, all comma-separated keys of `BRAIN_ACCOUNT_ID`. One signer per contract is built at start (`deps.brain.forContract`) and shared by the charge worker and the hourly garden sweep, so they share nonce lanes. Charges for a contract without keys stay queued (`last_error = no_signer`). The feeder (`FEEDER_ACCOUNT_ID`, `FEEDER_KEY`) is likewise one shared signer (`deps.feeder`).

### Pet metadata on IPFS (module `brain/src/metadata/`)

Bus events `evolved`, `hatched` and `closet_equipped` (new, from `POST /pets/:petRef/closet/equip`, `{ equipped }`), plus a 60 s check of each known pet's look (name, Soul version, stage, form, shirt, traits), trigger a re-pin, debounced per pet to one run per 60 s. The PNG and the JSON are pinned only when their sha256 changed; each new JSON is a new row in `pet_metadata` (migration 700). If the pets contract has `set_metadata` (pets-v9; detected with a free view call, missing method = skip and log once, rechecked every 10 min), the brain signer calls it with `media`, `media_hash`, `reference`, `reference_hash` (base64 sha256). The brain function-call key needs `set_metadata` in its method list.

## Ops (team only, basic auth)

`GET /ops`: spend today, charge queue depth and failures, orders by status, feeder balance, attestation status, NEARON claimable, org balance.
