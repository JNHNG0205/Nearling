# Device protocol (firmware to brain and chain)

Everything a Nearling (ESP32-S3) calls, in the order it calls it. Source of truth for routes: `AI-brain architectual/08-api-reference.md` and the brain code (`brain/src/identity/devices.ts`, `care.ts`, `closet.ts`, `talk/talk.ts`, `proactive/inbox.ts`, `race/`). On-chain signing: `docs/hardware/DEVICE_SIGNING.md`. A browser device that follows this protocol end to end: web `/device-sim` (`web/app/device-sim/page.tsx`).

Testnet only. Never log chat text or keys (`CLAUDE.md` rules 3 and 4).

## 0. Basics

- Brain: `https://<brain-host>` (HTTPS; `wss://` for the race). Chain RPC: `https://test.rpc.fastnear.com`.
- JSON bodies unless noted. Yocto amounts are strings. `:petRef` = URL-encoded `<contract>:<token_id>`, e.g. `pets.petto.testnet%3A5`.
- Errors: `{ "error": { "code", "message", "retry_after_s"? } }`. Codes: `unauthorized`, `not_owner`, `not_found`, `rate_limited`, `brain_resting`, `bad_audio`, `expired`, `conflict`, `upstream`, `invalid`.

| Auth | Headers | Used for |
|---|---|---|
| device secret | `X-Device-Id: <hw_id>`, `X-Device-Secret: <device_secret>` | pairing poll and confirm |
| device token | `Authorization: Device <device_token>` | everything after pairing, including the race WebSocket |

`hw_id`: stable id, e.g. the eFuse MAC as hex (1 to 64 chars). `device_secret`: 16 to 128 random chars generated once and kept in NVS. The brain stores only `sha256(device_secret)`; a different secret for a known `hw_id` gets 401 forever, so never regenerate it except on factory reset (then use a new `hw_id` too).

## 1. Boot: `POST /devices/hello`

Every power-on and after Wi-Fi reconnects.

```json
{ "hw_id": "f412fa5b3c10", "device_secret": "<16..128 chars>", "fw_version": "0.4.1",
  "device_pk": "ed25519:39UyhHqKHdoRSsrhTWi9yBfbrHCEL5WgvGajMz9716rS" }
```

`device_pk` (optional, new): the device's NEAR public key from `DEVICE_SIGNING.md` section 5, exactly `ed25519:<base58>`. The brain keeps it so the web can offer "Add this device key" without typing.

Responses:

| Body | Device does |
|---|---|
| `{ "bound": true, "pet_ref": "pets.petto.testnet:5" }` | use the stored `device_token`; go to the pet screen |
| `{ "bound": false, "pairing": { "token", "qr_url", "expires_at" } }` | forget any old token; show the pairing screen (section 2). `qr_url` = `PUBLIC_WEB_URL/hatch?t=<token>` |

A bound device whose pet changed owner is revoked here and gets a fresh pairing.

## 2. Pairing

1. Show `qr_url` as a QR code, and advertise it over Bluetooth (section 9). Pairing lasts 10 minutes (`expires_at`, ms).
2. Poll every 2 s: `GET /devices/pairing` with the device secret headers. Response `{ "status", "pet_name"?, "expires_at" }`, status one of `open`, `claimed`, `awaiting_confirm`, `confirmed`, `expired`, `cancelled`.
3. On `awaiting_confirm`: show "Pair <pet_name>?" and wait for the physical button.
4. Button press: `POST /devices/pairing/confirm` (device secret headers, no body) returns `{ "device_token", "pet_ref" }`. Store both in NVS. The token is shown **once**; if lost, the owner unpairs on the web and you pair again. Confirm also hatches the egg (Build Spec 1).
5. On `expired`: call `/devices/hello` again for a new code.

Errors: 401 `unauthorized` (bad secret headers), 404 (call hello first), 409 `conflict` (not waiting / already used), 410 `expired`, 403 `not_owner` (pet moved during pairing).

## 3. Pet screen: `GET /pets/:petRef/state`

Public, no auth needed (send the device token anyway). Poll every 20 s, and every 3 s while an approval is open. Fields the screen uses:

| Field | Type | Use |
|---|---|---|
| `name` | string | header |
| `stage_index` | 0..3 | sprite set: 0 egg, 1 baby, 2 teen, 3 adult (`NL_CLIPS[].stage`) |
| `hatched` | bool | false: draw `egg_idle`; when it turns true, play `egg_hatch` once |
| `form` | `"base"` / `"winged"` | `NL_CLIPS[].winged` |
| `traits` | 5 numbers 0..100 | palette (`nl_build_palette`) and personality (`nl_personality`) |
| `equipped_shirt` | token id string or null | shirt layer colour (`nl_build_shirt_palette`) |
| `display_state` | `happy`, `sad`, `hungry`, `sleepy`, `starving`, `dormant` | state loop clip: happy `idle`, sad `sad`, hungry `hungry`, sleepy `sleep`, starving `starving`, dormant `dormant` |
| `fuel.left` | int | chats left ("fuel"); `fuel.low` = show the fuel warning |
| `care.mood`, `care.milestones` | 0..100, `{pat, rock, sleep}` | care meter, evolution hints |
| `device.paired` | bool | false after an unpair on the web: go back to section 1 |
| `demo_speed` | bool | show a "demo speed" tag |
| `owner` | account id | signer for on-chain calls (section 8) |

The full type is `PetState` in `packages/shared/src/index.ts`. A 403 `not_owner` on any pet route means the pet moved: drop the token and call hello.

## 4. Talk: `POST /pets/:petRef/talk`

Hold-to-talk. `multipart/form-data` with:

- `request_id`: a UUID you generate; reuse it on retry so you are never charged twice.
- `audio`: WAV, 16 kHz, mono, 16-bit PCM, at most 12 s.
- `voice`: `1` to get a spoken reply.

Response 200: `{ turn_id, status: "done"|"canned"|"failed", transcript?, reply, emotion, fuel: { left, charged? }, audio_url, receipt_url, soul_version? }`. Play `audio_url` (relative to the brain; WAV or MP3) if present, scroll `reply`, play the `talk` clip, then the emotion. `status: "canned"` with `fuel.left: 0` = Low Fuel line, nothing charged.

Timeout 25 s; retry once with the same `request_id`. 429 `rate_limited`: wait `retry_after_s`. 503 `brain_resting`: show sleepy.

## 5. Inbox: the pet reaches out first

- `GET /pets/:petRef/inbox?after=<last id>` (device token): array of `{ id, trigger, canned, text, turn_id, created_at, delivered_device_at, read_at }`.
- Show new items with bounce + chime, then `POST /pets/:petRef/inbox/ack` `{ "up_to": <highest id shown> }` marks them delivered on the device. Keep `after` in RAM (or NVS) so a reboot does not replay.

## 6. Offline care: `POST /pets/:petRef/care`

Pat, rock, shake and sleep happen instantly on the device and are synced in batches (when online, at most every 30 s, and on wake):

```json
{ "events": [ { "id": "c-000123", "kind": "pat", "at": 1794356123575 } ] }
```

`kind`: `pat`, `rock`, `shake`, `sleep`. `id`: unique per device (a counter in NVS is fine; replays are ignored). `at`: ms since epoch (from SNTP). Max 500 per call. Response `{ mood, milestones, form, evolved_now }`; on `evolved_now: true` play `evolve` and switch to the winged clips.

Care is off chain. The device may also sign an on-chain `play(pet, "pet")` (section 8) at most once per 5 minutes; that is the "the device signs its own transactions" demo.

## 7. Closet

- `GET /pets/:petRef/closet` (device token): `{ shirts: [{ token_id, title }], equipped }`.
- `POST /pets/:petRef/closet/equip` `{ "token_id": "0" }` or `{ "token_id": null }` returns `{ equipped }`. The next `/state` shows `equipped_shirt`.

## 8. Approvals and on-chain calls

### 8.1 Pending approvals: `GET /devices/actions` (new)

Device token. Returns the on-chain pending actions (`propose_action`, `CLAUDE.md` 7.3) for the device's bound pet, with a line to show:

```json
{ "pet_ref": "pets.petto.testnet:5",
  "actions": [ { "id": "7", "action": { "Stake": { "amount": "1000000000000000000000000" } },
                 "deposit": "1000000000000000000000000", "expires_at": 1794356723575,
                 "summary": "Stake 1 NEAR into the Brain Garden" } ] }
```

`id` is the contract's action id (U64 as a string). Shape owned by the brain engineer; `/device-sim` also accepts the contract's raw `PendingAction` (`id`, `action`, `expires_at_ns`) and falls back to the public view `get_pending_actions({"pet_id":"5"})` on the pets contract if the route is not deployed yet.

Poll every 20 s, every 3 s while the web shows "Approve on your Nearling" (SSE `approval_ready` on the web side). Show `summary` and the exact amount; the owner holds Approve for 2 s; then sign `approve_action`.

### 8.2 Device-signed contract calls

Signed with the device key, signer = `owner` from `/state`, receiver = the pet's contract (from `pet_ref`). Byte layout and RPC: `DEVICE_SIGNING.md`.

| Method | Args | Gas | When | Contract checks |
|---|---|---|---|---|
| `play` | `{"pet_id":"5","action":"pet"}` (`pet`/`play`/`sleep`/`wake`) | 30 Tgas | pat (at most once per 5 min) | owner, cooldowns (`E_COOLDOWN`), `play` rejected asleep (`E_ASLEEP`) |
| `approve_action` | `{"action_id":"7"}` | 450 Tgas | Approve held 2 s | signer key = `pet.device_pk` (`E_NOT_DEVICE`), proposer key differs, not expired (`E_EXPIRED`), approval mode on |
| `stake_from_food` | `{"pet_id":"5","amount":"<1..2 NEAR yocto>"}` | 450 Tgas | Food screen "Save food" | device key, 1 to 2 NEAR per call, 5 NEAR per day (`E_DEVICE_CAP`), keeps a day of food (`E_FOOD_RESERVE`) |
| `feed_from_pantry` (`pets-v9`) | `{"pet_id":"5","amount":"<yocto>"}` | 30 Tgas | Feed button, only when `get_pet` shows `pantry_yocto > 0` | device key or owner wallet, at most `config.device_feed_max_per_day` per UTC day (`E_DEVICE_CAP`); moves pantry NEAR into food, mood +5, revives; emits `fed { source: "pantry" }` |

Pantry (`pets-v9`, `docs/CONTRACT_CHANGES_V9.md` section 3): function-call keys cannot attach NEAR, so the owner stocks a per-pet pantry from the wallet (`stock_pantry`) and the device moves it into food. Read `pantry_yocto` with the public view `get_pet` on the pets contract (RPC `call_function`), until `/state` carries it.

Owner setup the device depends on (web, once per device and contract): AddKey with methods `play, stake_from_food, feed_from_pantry, approve_action` (leave out `feed_from_pantry` on `pets-v8`), then `register_device(pet_id, device_pk)`. If `view_access_key` says the key is unknown, show "Add this device on the web".

## 9. Bluetooth pairing (GATT)

While the pairing screen is up, the device advertises a BLE peripheral so a phone (Chrome / Android Web Bluetooth on `/start`) can read the pairing link without scanning the QR. Constants are exported from `packages/device/src/ble.ts`; `web/lib/ble.ts` imports them.

| Item | UUID | Properties | Value |
|---|---|---|---|
| Service | `6e6c0001-8a3c-4b5e-9f2a-6e6561726c67` | primary, included in the advertisement | |
| `pairing_url` | `6e6c0002-8a3c-4b5e-9f2a-6e6561726c67` | read, notify | UTF-8, no NUL: `PUBLIC_WEB_URL/hatch?t=<token>`, the same string as `qr_url`. Token 4 to 128 chars `[A-Za-z0-9_-]` |
| `device_pk` | `6e6c0003-8a3c-4b5e-9f2a-6e6561726c67` | read | UTF-8: `ed25519:<base58>` |

- Advertised name: `Nearling-` + last 4 hex chars of `hw_id` (e.g. `Nearling-3F2A`). Put the 128-bit service UUID in the advertisement (or scan response) so `requestDevice({ filters: [{ services: [SERVICE] }] })` finds it.
- When `/devices/hello` gives a new token, update `pairing_url` and send a notify. Stop advertising once paired.
- No secrets over BLE: the token alone cannot bind a pet; the owner still signs in on the web and presses Pair on the device.
- The web keeps only the token and navigates on its own origin, so the host part of the URL is not trusted.
- NimBLE-Arduino (or ESP-IDF NimBLE) fits: one service, two characteristics, no bonding needed.

## 10. Battles (Race was removed)

Petto Run is gone. The device hosts turn-based battles (`firmware/petto`, menu Battle): `POST /battle/rooms` with the device token (the brain uses the bound pet), show the QR `https://mypetto.xyz/battle/<code>` for the other player, then `GET /battle/ws?code=<code>` with the header `Authorization: Device <token>`. Messages are in `packages/battle/src/protocol.ts`; send `{"type":"ready"}`, then one `{"type":"move","move":{...}}` per turn. The other player must be a different account. Details: `docs/hardware/BATTLE.md`.

## 11. Sprites: `art/nearling_sprites.h`

Generated by `packages/sprites/scripts/export.ts` (do not edit; re-run `pnpm --filter @petto/sprites export`). Same sprites as the web.

- Frames are 32x32, 4 bits per pixel (`NL_FRAME_BYTES` 512, high nibble = left pixel, index 0 transparent). Scale by an integer (x6 = 192 px, x7 = 224 px on the 240x240 screen).
- `nl_build_palette(traits, grey, out[16])` gives RGB565 colours (swap bytes if the display driver wants it). `grey` comes from the clip (`starving`, `dormant`).
- `NL_CLIPS[]`: `{ name, stage, winged, personality, fps, loop, grey, frame_count, frames, shirt }`. Pick by `name` + `stage_index` + `form`, preferring the clip whose `personality == nl_personality(traits)`, else personality 0.
- Shirt: draw `nl_frame(shirt[i])` over the body frame with `nl_build_shirt_palette(equipped_shirt, grey, out[4])`.
- One-shot clips (`loop == 0`: `pat`, `eat`, `celebrate`, `evolve`, `egg_hatch`) return to the state loop when done.

## 12. Cadence summary

| What | When |
|---|---|
| `/devices/hello` | boot, Wi-Fi reconnect, after any 403 `not_owner` |
| `/devices/pairing` | every 2 s while pairing |
| `/state`, `/inbox`, `/devices/actions` | every 20 s; every 3 s while an approval is open |
| `/care` | batched, at most every 30 s |
| `view_access_key` + `send_tx` | per signed action only |
