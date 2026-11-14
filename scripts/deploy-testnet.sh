#!/usr/bin/env bash
# Deploys the pets contract to a fresh pets-v$PETS_VERSION.$NEAR_PARENT_ACCOUNT (CLAUDE.md 7: no migrations).
# DEMO_SPEED=1 deploys the same wasm to pets-demo-v$PETS_VERSION.$NEAR_PARENT_ACCOUNT with about
# 100x rates (CLAUDE.md 7). Both read NEARON's live unstake_deposit into config (pets-v9).
# Needs: cargo-near, near CLI (near-cli-rs), parent account key in ~/.near-credentials (legacy keychain), .env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a

if [ "${DEMO_SPEED:-0}" = 1 ]; then
  CONTRACT="pets-demo-v${PETS_VERSION}.${NEAR_PARENT_ACCOUNT}"
else
  CONTRACT="pets-v${PETS_VERSION}.${NEAR_PARENT_ACCOUNT}"
fi
FUND="${FUND:-4.5 NEAR}"   # wasm ~400 KB locks ~4.0 NEAR of storage
HOUSE="${HOUSE:-0.2 NEAR}"  # register_pool: absorbs NEARON's one-time first-deposit fee

# The parent pays FUND and HOUSE, and near-cli pre-checks 450 Tgas of register_pool gas (~0.45 NEAR).
NEED=$(python3 -c "import sys; print(float(sys.argv[1].split()[0]) + float(sys.argv[2].split()[0]) + 0.5)" "$FUND" "$HOUSE")
HAVE=$(near account view-account-summary "$NEAR_PARENT_ACCOUNT" network-config testnet now 2>/dev/null \
  | grep -i "native account balance" | grep -oE '[0-9]+(\.[0-9]+)?' | head -1)
if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) >= float(sys.argv[2]) else 1)" "$HAVE" "$NEED"; then :; else
  echo "$NEAR_PARENT_ACCOUNT has $HAVE NEAR, needs about $NEED NEAR. Top it up first." >&2; exit 1
fi

echo "Building..."
(cd "$ROOT/contract" && cargo near build non-reproducible-wasm)
WASM="$ROOT/contract/target/near/petto_pets.wasm"

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

echo "Registering with the NEARON pool (house deposit $HOUSE)..."
near contract call-function as-transaction "$CONTRACT" register_pool json-args '{}' \
  prepaid-gas '450 Tgas' attached-deposit "$HOUSE" \
  sign-as "$NEAR_PARENT_ACCOUNT" network-config testnet sign-with-legacy-keychain send

# The pool asks each holder for its own unstake_deposit (C6), so read it for this contract.
ACCOUNT=$(near contract call-function as-read-only "$NEARON_POOL" get_account \
  json-args "{\"account_id\":\"$CONTRACT\"}" network-config testnet now 2>/dev/null | sed -n '/^{/,/^}/p')
CFG=$(near contract call-function as-read-only "$CONTRACT" config json-args '{}' \
  network-config testnet now 2>/dev/null | sed -n '/^{/,/^}/p')
NEW=$(python3 -c '
import json, sys
c = json.loads(sys.argv[1])
c["pool_unstake_deposit"] = json.loads(sys.argv[2])["unstake_deposit"]
if sys.argv[3] == "1":
    c["metabolism_micro_per_day"] *= 100
    c["mood_ns_per_point"] //= 100
    c["energy_ns_per_point"] //= 100
    c["dormant_after_ns"] //= 100
    c["starter_food"] = str(5 * 10**21)  # 0.005 NEAR: starving after ~14 min, dormant ~43 min later
    c["demo_speed"] = True
print(json.dumps({"config": c}))' "$CFG" "$ACCOUNT" "${DEMO_SPEED:-0}")
echo "Setting config (pool_unstake_deposit from the pool$([ "${DEMO_SPEED:-0}" = 1 ] && echo ', demo speed'))..."
near contract call-function as-transaction "$CONTRACT" set_config json-args "$NEW" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as "$NEAR_PARENT_ACCOUNT" network-config testnet sign-with-legacy-keychain send

if [ "${DEMO_SPEED:-0}" = 1 ]; then
  echo "Done. Demo-speed contract: $CONTRACT (mint price is now mint_storage + 0.005 NEAR)."
  echo "Set DEMO_PETS_CONTRACT=$CONTRACT in .env."
else
  echo "Done. Set PETS_CONTRACT=$CONTRACT in .env (brain, web, firmware read it)."
fi
near contract call-function as-read-only "$CONTRACT" config json-args '{}' network-config testnet now
