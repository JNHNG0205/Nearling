#!/usr/bin/env bash
# Deploys the pets contract to a fresh pets-v$PETS_VERSION.$NEAR_PARENT_ACCOUNT (CLAUDE.md 7: no migrations).
# DEMO_SPEED=1 deploys the same wasm to pets-demo.$NEAR_PARENT_ACCOUNT with about 100x rates (CLAUDE.md 7).
# Needs: cargo-near, near CLI (near-cli-rs), parent account key in ~/.near-credentials (legacy keychain), .env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a

if [ "${DEMO_SPEED:-0}" = 1 ]; then
  CONTRACT="pets-demo.${NEAR_PARENT_ACCOUNT}"
else
  CONTRACT="pets-v${PETS_VERSION}.${NEAR_PARENT_ACCOUNT}"
fi
FUND="${FUND:-4.2 NEAR}"   # wasm ~370 KB locks ~3.7 NEAR of storage

echo "Building..."
(cd "$ROOT/contract" && cargo near build non-reproducible-wasm)
WASM="$ROOT/contract/target/near/nearling_pets.wasm"

echo "Creating $CONTRACT (funded $FUND by $NEAR_PARENT_ACCOUNT)..."
near account create-account fund-myself "$CONTRACT" "$FUND" \
  autogenerate-new-keypair save-to-legacy-keychain \
  sign-as "$NEAR_PARENT_ACCOUNT" network-config testnet sign-with-legacy-keychain send

ARGS=$(printf '{"admin":"%s","brain":"%s","treasury":"%s","pool":"%s","org_id":"%s"}' \
  "$NEAR_PARENT_ACCOUNT" "$BRAIN_ACCOUNT" "$TREASURY_ACCOUNT" "$NEARON_POOL" "$NEAR_AI_ORG_ID")

echo "Deploying and calling new..."
near contract deploy "$CONTRACT" use-file "$WASM" \
  with-init-call new json-args "$ARGS" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send

if [ "${DEMO_SPEED:-0}" = 1 ]; then
  echo "Setting demo-speed config..."
  CFG=$(near contract call-function as-read-only "$CONTRACT" config json-args '{}' \
    network-config testnet now 2>/dev/null | sed -n '/^{/,/^}/p')
  DEMO=$(python3 -c '
import json, sys
c = json.loads(sys.argv[1])
c["metabolism_micro_per_day"] *= 100
c["mood_ns_per_point"] //= 100
c["energy_ns_per_point"] //= 100
c["dormant_after_ns"] //= 100
c["starter_food"] = str(5 * 10**21)  # 0.005 NEAR: starving after ~14 min, dormant ~43 min later
c["demo_speed"] = True
print(json.dumps({"config": c}))' "$CFG")
  near contract call-function as-transaction "$CONTRACT" set_config json-args "$DEMO" \
    prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
    sign-as "$NEAR_PARENT_ACCOUNT" network-config testnet sign-with-legacy-keychain send
  echo "Done. Demo-speed contract: $CONTRACT (mint price is now mint_storage + 0.005 NEAR)."
else
  echo "Done. Set PETS_CONTRACT=$CONTRACT in .env (brain, web, firmware read it)."
fi
near contract call-function as-read-only "$CONTRACT" config json-args '{}' network-config testnet now
