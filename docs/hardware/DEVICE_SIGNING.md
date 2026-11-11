# Device signing (ESP32-S3)

How a Nearling signs its own NEAR testnet transactions. The device holds an ed25519 **limited access key** (function-call key) on the owner's account: receiver = the pets contract, methods `play`, `stake_from_food`, `approve_action` and, from `pets-v9`, `feed_from_pantry`. It can never attach NEAR, so it can never send funds anywhere (`CLAUDE.md` 7.6, 10, 14 S5).

Reference implementation: `packages/device/src/index.ts` (TypeScript). Its output is cross-checked against near-api-js 7.4 and pinned by golden vectors in `packages/device/vectors/`. Firmware is correct when it reproduces those vectors byte for byte.

Testnet only. Never log or print the device secret key.

## 1. The flow

```
boot:  seed = NVS("nearling", "ed_seed")  (or generate once, section 5)
       pk   = ed25519_public(seed)        -> show "ed25519:<base58(pk)>" for pairing

each signed call:
  1. RPC query view_access_key(owner_account, pk)  -> nonce, block_hash
  2. tx  = borsh(Transaction{ signer=owner_account, pk, nonce+1, receiver=pets contract,
                              block_hash, [FunctionCall{ method, args_json, gas, deposit=0 }] })
  3. h   = sha256(tx)
  4. sig = ed25519_sign(seed, h)           (sign the 32-byte hash, not the tx bytes)
  5. signed = tx || 0x00 || sig            (SignedTransaction)
  6. RPC send_tx(base64(signed), wait_until = EXECUTED_OPTIMISTIC)
  7. tx hash = base58(h)                    (show it / log it; explorer: https://testnet.nearblocks.io/txns/<hash>)
```

`signer_id` is the **owner's account** (the key lives on it), not a device account. The contract checks `env::signer_account_pk() == pet.device_pk` and `predecessor == owner`.

## 2. Borsh layout of `Transaction` (one FunctionCall)

All integers are little endian. Strings and byte vectors are `u32` length (LE) followed by the bytes. No padding, no version byte (this is the classic `Transaction` V0; do not prepend anything).

| # | Field | Type | Bytes |
|---|---|---|---|
| 1 | `signer_id` | string | `u32 len` + UTF-8 account id |
| 2 | `public_key.key_type` | u8 enum | `0x00` = ED25519 |
| 3 | `public_key.data` | [u8; 32] | raw 32-byte public key |
| 4 | `nonce` | u64 | 8 bytes LE |
| 5 | `receiver_id` | string | `u32 len` + UTF-8 contract id |
| 6 | `block_hash` | [u8; 32] | base58-decoded `block_hash` |
| 7 | `actions` | Vec<Action> | `u32 count` = `01 00 00 00` |
| 8 | `action` tag | u8 enum | `0x02` = FunctionCall |
| 9 | `method_name` | string | `u32 len` + ASCII method name |
| 10 | `args` | Vec<u8> | `u32 len` + JSON bytes exactly as sent |
| 11 | `gas` | u64 | 8 bytes LE |
| 12 | `deposit` | u128 | 16 bytes LE, all zero |

Action enum tags (for reference): 0 CreateAccount, 1 DeployContract, **2 FunctionCall**, 3 Transfer, 4 Stake, 5 AddKey, 6 DeleteKey, 7 DeleteAccount, 8 Delegate.

### `SignedTransaction`

```
SignedTransaction = Transaction bytes || signature.key_type (u8 0x00) || signature.data ([u8; 64])
```

So the signed blob is always `len(tx) + 65` bytes.

### Worked example (`vectors/play.json`)

```
18000000                                    signer_id len = 24
6e6561726c696e672d706c61796572312e746573746e6574   "nearling-player1.testnet"
00                                          key type ED25519
9f3d9dc9ea7f118ca12649e6e5adcbf36a83261103fa99315f6fb1c625eca82c   public key
2ad0dcfde4ab0000                            nonce 189000000000042 (u64 LE)
18000000                                    receiver_id len = 24
706574732d76392e6e6561726c696e672e746573746e6574   "pets-v9.nearling.testnet"
0117721b84362283515e7d05aa7ee5cb061255c890e52a5dc30ea8af60f9ca46   block hash
01000000                                    1 action
02                                          FunctionCall
04000000 706c6179                           "play"
1d000000 7b227065745f6964223a2235222c22616374696f6e223a22706574227d   {"pet_id":"5","action":"pet"}
00e057eb481b0000                            gas 30 Tgas = 30000000000000 (u64 LE)
00000000000000000000000000000000            deposit 0 (u128 LE)
```

### Args JSON

The contract parses the args as JSON; the signature covers the exact bytes. Build them without spaces and send exactly what you signed. Token ids and U64 / U128 values are JSON **strings**:

| Method | Args | Gas |
|---|---|---|
| `play` | `{"pet_id":"5","action":"pet"}` (`pet`, `play`, `sleep`, `wake`) | 30 Tgas |
| `approve_action` | `{"action_id":"7"}` | 450 Tgas (may run a 400 Tgas NEARON call + callback) |
| `stake_from_food` | `{"pet_id":"5","amount":"1000000000000000000000000"}` | 450 Tgas |
| `feed_from_pantry` (`pets-v9`) | `{"pet_id":"5","amount":"50000000000000000000000"}` | 30 Tgas |

Prepaid gas is reserved against the key's allowance (0.25 to 1 NEAR) and unburnt gas is refunded, so 450 Tgas is safe for approvals. Max per transaction is 1000 Tgas (S6).

## 3. RPC calls (exact JSON)

Endpoint: `https://test.rpc.fastnear.com` (fallback `https://rpc.testnet.near.org`). `POST`, `Content-Type: application/json`.

### 3.1 Nonce and block hash: `view_access_key`

```json
{"jsonrpc":"2.0","id":"nearling-device","method":"query",
 "params":{"request_type":"view_access_key","finality":"final",
           "account_id":"nearling-player1.testnet",
           "public_key":"ed25519:BicKRyBqRfXidZtVVCf1JiBeL2wJCrLAoUbnMKKSYqrj"}}
```

Response (trimmed):

```json
{"jsonrpc":"2.0","id":"nearling-device","result":{
  "nonce":189000000000041,
  "permission":{"FunctionCall":{"allowance":"250000000000000000000000",
    "receiver_id":"pets-v9.nearling.testnet",
    "method_names":["play","stake_from_food","feed_from_pantry","approve_action"]}},
  "block_hash":"5G9JoPqkwhLMgr7Xp6L946PS5FnfWWvgvcTVV6JdAF7","block_height":228000000}}
```

- Use `nonce + 1`. Nonces are large (block height x 10^6), **above 2^53**: parse as `uint64_t` (ArduinoJson: `#define ARDUINOJSON_USE_LONG_LONG 1`, read with `as<uint64_t>()`), never through `double`.
- `block_hash` from the same response is recent enough (a tx is valid for about 24 h of blocks). One call gives both.
- Key missing (not added yet, or added for a different `pets-vN`): `result.error` / `error.cause.name` = `UNKNOWN_ACCESS_KEY`. Show "Add this device on the web".
- Keep the last nonce in RAM and use `max(rpc_nonce, last_used) + 1` when sending two calls quickly.

### 3.2 Send: `send_tx`

```json
{"jsonrpc":"2.0","id":"nearling-device","method":"send_tx",
 "params":{"signed_tx_base64":"<base64 of SignedTransaction>","wait_until":"EXECUTED_OPTIMISTIC"}}
```

Response: `result.status` is `{"SuccessValue":"<base64>"}` or `{"Failure":{...}}`; `result.transaction.hash` = base58(sha256(tx)). Contract panics appear inside `Failure` as `ActionError.kind.FunctionCallError.ExecutionError` text starting with a stable code, e.g. `E_NOT_DEVICE: Only the pet's device`, `E_COOLDOWN: ...`, `E_DEVICE_CAP: ...`, `E_EXPIRED: ...`. Map the code to a screen line.

Transport errors (top-level `error`):

| `error.cause.name` | Meaning | Device does |
|---|---|---|
| `INVALID_TRANSACTION` with `InvalidNonce` | nonce reused | re-query 3.1 and re-sign once |
| `INVALID_TRANSACTION` with `Expired` | block hash too old | re-query and re-sign |
| `INVALID_TRANSACTION` with `NotEnoughAllowance` | key allowance spent | "Top up the device key on the web" |
| `INVALID_TRANSACTION` with `MethodNameMismatch` / `ReceiverMismatch` | key added for another method or contract | "Re-add the device key on the web" |
| `TIMEOUT_ERROR` (HTTP 408) | tx may still land | poll `tx` (below) with the hash you computed; do not re-sign with a new nonce |

Status of a sent tx:

```json
{"jsonrpc":"2.0","id":"nearling-device","method":"tx",
 "params":{"tx_hash":"<base58>","sender_account_id":"<owner account>","wait_until":"EXECUTED_OPTIMISTIC"}}
```

## 4. Libraries for ESP32-S3

| Need | Recommended | Notes |
|---|---|---|
| ed25519 | **libsodium** (ESP-IDF component `espressif/libsodium`): `crypto_sign_seed_keypair(pk, sk64, seed)`, `crypto_sign_detached(sig, NULL, h, 32, sk64)` | RFC 8032 ed25519 with SHA-512. Matches NEAR |
| ed25519 (small) | **Monocypher 4** with its optional `monocypher-ed25519.c`: `crypto_ed25519_key_pair(sk64, pk, seed)`, `crypto_ed25519_sign(sig, sk64, h, 32)` | Use the **`crypto_ed25519_*`** functions. Monocypher's default `crypto_eddsa_*` uses BLAKE2b and produces signatures NEAR rejects |
| sha256 | mbedTLS (in ESP-IDF, hardware accelerated): `mbedtls_sha256(tx, len, h, 0)` | `0` = SHA-256, not SHA-224 |
| base64 | mbedTLS `mbedtls_base64_encode` | for `signed_tx_base64` |
| base58 | a 40-line encoder/decoder (bitcoin alphabet `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`) | public key string, block hash decode, tx hash display |
| JSON | ArduinoJson 7 with `ARDUINOJSON_USE_LONG_LONG 1` | u64 nonce |
| HTTPS | `esp_http_client` or `HTTPClient` + `esp_crt_bundle_attach` | RPC and brain are public HTTPS hosts |

The NEAR "secret key" format `ed25519:<base58 64 bytes>` is `seed (32) || public key (32)`, the same 64-byte layout libsodium and Monocypher call the secret key. Store only the 32-byte seed and derive the rest at boot.

## 5. Key generation and storage

1. First boot (after Wi-Fi/RF is up so `esp_fill_random` uses the hardware RNG): `esp_fill_random(seed, 32)`, derive the keypair, write the seed to NVS namespace `nearling`, key `ed_seed` (blob, 32 bytes).
2. Enable **flash encryption** and **NVS encryption** (and secure boot) for the demo build, so the seed is not readable from a dumped flash.
3. Never print the seed or the 64-byte secret, never send it to the brain. Only `ed25519:<base58(pk)>` leaves the device: in `POST /devices/hello` (`device_pk`), the BLE `device_pk` characteristic and the pairing screen.
4. Factory reset (Menu > Unpair, long press) erases `ed_seed`; the owner then removes the old key on the web and adds the new one.
5. Honest limit: an ESP32 is not a secure element. That is why the key is a capped, function-call-only key and the contract limits everything it can do.

Owner setup (web, once per device and per contract): `AddKey` on the owner's account with `FunctionCall { receiver_id: <pets contract>, method_names: [play, stake_from_food, feed_from_pantry, approve_action], allowance: 0.25 to 1 NEAR }`, then `register_device(pet_id, public_key)` from the wallet. A function-call key is bound to one receiver, so a new `pets-vN` needs a new AddKey.

## 6. Verify with the vectors

`packages/device/vectors/approve_action.json` and `play.json` hold every input and every intermediate output:

| Field | Check |
|---|---|
| `test_seed_hex` | load as your seed |
| `public_key_hex`, `public_key` | your derived public key (raw and `ed25519:<base58>`) |
| `signer_id`, `receiver_id`, `nonce`, `block_hash_base58` / `block_hash_hex`, `method_name`, `args_json`, `gas` | inputs to your Borsh writer |
| `tx_borsh_hex` | your Borsh output, byte for byte |
| `sha256_hex` / `tx_hash_base58` | sha256 of the tx, and its base58 (the tx hash) |
| `signature_hex` | ed25519 is deterministic: your signature must be identical |
| `signed_tx_hex` / `signed_tx_base64` | the blob you send |

**The test seed is a public, throwaway, test-only value.** It is registered on no account. Never use it on a real device and never add its public key to any NEAR account.

A unit test on the device (or a host build of the same C file) can embed the hex strings and compare. Regenerate the vectors after changing inputs: `pnpm --filter @nearling/device vectors`; `pnpm --filter @nearling/device test` fails if the files drift from the reference code, and also checks the reference against near-api-js's own signer and a hand-written Borsh encoder that follows section 2.

## 7. Live proof (2026-11-11, `pets-v8.nearling.testnet`, pet #5)

`pnpm --filter @nearling/device live <accounts.env> <key file>` generated a device key, added it to the pet owner's account as a function-call key (receiver `pets-v8`, methods `play, stake_from_food, approve_action`, allowance 0.25 NEAR), registered it with `register_device`, then signed `play("5", "pet")` with the device key through the exact flow above:

| Step | Tx |
|---|---|
| AddKey (wallet key) | `BKnjfbJCzKHuWc6jHRXkKpohd4sAmHyeJuCS4UDGi3rT` |
| `register_device` (wallet key) | `FiJNksXJcp3C94Nf5P1RWa132qsK97oXXPrN9KLWq64D` |
| `play` signed by the device key | `EbdUo7DKDWRZ5mWHnj2aWFEotTqv28p7CB6NvPijRunv` (signer key `ed25519:39UyhHqKHdoRSsrhTWi9yBfbrHCEL5WgvGajMz9716rS`, emitted `played`) |
