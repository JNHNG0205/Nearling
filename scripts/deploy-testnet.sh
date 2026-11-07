#!/usr/bin/env bash
# Deploys the pets contract to a fresh pets-v$PETS_VERSION.$NEAR_PARENT_ACCOUNT (CLAUDE.md 7: no migrations).
# Needs: cargo-near, near CLI (near-cli-rs), parent account key in ~/.near-credentials (legacy keychain), .env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a

CONTRACT="pets-v${PETS_VERSION}.${NEAR_PARENT_ACCOUNT}"
FUND="${FUND:-3 NEAR}"

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

echo "Done. Set PETS_CONTRACT=$CONTRACT in .env (brain, web, firmware read it)."
near contract call-function as-read-only "$CONTRACT" config json-args '{}' network-config testnet now
