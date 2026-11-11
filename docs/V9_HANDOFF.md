# pets-v9 hand-off (Role 1 to Role 2, 2026-11-11)

`pets-v9` is live on testnet. Every method name, argument and JSON shape is exactly as written in `docs/CONTRACT_CHANGES_V9.md`. Full reference: `docs/CONTRACT_INTERFACE.md`. Testnet results and tx ids: `CLAUDE.md` 14 ("pets-v9 on testnet").

## Contracts

```
PETS_CONTRACT=pets-v9.nearling.testnet
DEMO_PETS_CONTRACT=pets-demo-v9.nearling.testnet
SHIRTS_CONTRACT=shirts.nearling.testnet          # unchanged
```

`pets-v8` and `pets-demo` still run the old code (unstake fails there, C6). Do not mint new pets on them.

## Seeded pets (owner `nearling-seed.testnet`)

| Contract | Pet | State |
|---|---|---|
| `pets-v9` | #0 Smoke | Role 1 smoke-test pet: 0.5 NEAR staked, 0.5 NEAR unstake pending (unlock epoch 5438), pantry 0.4 NEAR, device key, metadata set |
| `pets-v9` | #1 Sunny | Happy |
| `pets-v9` | #2 Crumb | Hungry (`budget_micro` 1000) |
| `pets-v9` | #3 Echo | Starving (Low Fuel) |
| `pets-v9` | #4 Sprout | Happy, self-sustaining (2 NEAR staked) |
| `pets-demo-v9` | #0 Blink | Demo speed: starving about 14 min after the seed, dormant about 43 min later |

## What is new for the clients

| Feature | Contract | Client note |
|---|---|---|
| Unstake deposit | `unstake` is payable; attach `config().pool_unstake_deposit` (0.00772 NEAR now), excess refunded. `pending_unstake.deposit`; `withdraw` pays `amount + deposit`; `unstake_withdrawn` has `deposit` | An `Unstake` proposal must hold at least the deposit |
| NFT metadata | `set_metadata(pet_id, media, media_hash, reference, reference_hash)`, brain only, `ipfs://` links ≤ 256 bytes, 32-byte sha256 hashes (base64), one update per pet per 60 s. `description` = first 200 bytes of the Soul (also set by `set_soul` and at mint) | View-call detection works: `set_metadata` with `{}` fails on deserialize, not `MethodNotFound` |
| Pantry | `stock_pantry(pet_id)` payable (direct even in approval mode); `feed_from_pantry(pet_id, amount)` from the wallet or the device key (device ≤ `config().device_feed_max_per_day`, 1 NEAR per UTC day); `empty_pantry(pet_id, amount)` (rejected in approval mode) | `get_pet` has `pantry_yocto`. Device key methods: `play, stake_from_food, feed_from_pantry, approve_action` |
| Transfer | Refunds the whole pantry to the old owner and emits `pantry_emptied` (with `pantry: "0"`) | Timeline can show it |
| Events | New: `metadata_updated`, `pantry_stocked`, `pantry_emptied`. `fed` gains `source` (`wallet` / `pantry`) | |
| Errors | New: `E_METADATA`, `E_PANTRY` | Add both to `web/lib/errors.ts` |

## What Role 1 needs from Role 2

1. **Brain function-call keys: public keys only.** The brain generates the keypairs and keeps the private keys. Send 4 public keys per contract (`pets-v9` and `pets-demo-v9`, 8 in total). Role 1 adds them with:
   ```bash
   ./scripts/add-brain-keys.sh pets-v9.nearling.testnet ed25519:AAA ed25519:BBB ed25519:CCC ed25519:DDD
   ./scripts/add-brain-keys.sh pets-demo-v9.nearling.testnet ed25519:EEE ...
   ```
   Methods `charge, credit, sweep_credit, set_metadata`, allowance 1 NEAR each. Today `brain.nearling.testnet` has only Role 1's full access key, so the brain cannot sign yet.
2. **NEAR AI org id** for `config.org_id` (CREDIT sweeps), if it is not the one already in Role 1's `.env`.

## Role 2 files still pointing at pets-v8 / pets-demo

- `.env.example` (`PETS_CONTRACT`, `DEMO_PETS_CONTRACT`, `NEXT_PUBLIC_*`), `fly.toml`, `docs/DEPLOY.md`
- `README.md` web step 2 (`/adopt`)
- `scripts/e2e-chain.ts` (`DEMO`, `V8`)
- `AI-brain architectual/`, `web-app architectual/`, `docs/hardware/DEVICE_PROTOCOL.md` examples
- `docs/LIMITATIONS.md` C6: fixed on `pets-v9`

## Open items

- **Withdraw after unlock (epoch 5438, 12 to 24 h):** Role 1 withdraws pet #0 and records whether the pool's `withdraw` returns the unstake deposit. If it does not, the contract pays the deposit from its own balance.
- **Unstake deposit is per holder:** after the first unstake the pool asked `pets-v9` for only 0.00183 NEAR (`unstake_storage_paid` 0.00772). The contract keeps attaching `config.pool_unstake_deposit` (0.00772), which is enough; the web should keep reading it from `config()`.
- **`empty_pantry` in approval mode:** there is no proposal action; the owner turns approval mode off first (device approval), then empties.
- **Deploy note:** `PETS_VERSION=9 ./scripts/deploy-testnet.sh` does not override `.env` (the script sources it); set `PETS_VERSION` in `.env`.
