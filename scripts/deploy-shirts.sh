#!/usr/bin/env bash
# Deploys the shirts NFT collection (CLAUDE.md 5.6) to shirts.$NEAR_PARENT_ACCOUNT.
# Needs: cargo-near, near CLI (near-cli-rs), parent account key in ~/.near-credentials (legacy keychain), .env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a

CONTRACT="shirts.${NEAR_PARENT_ACCOUNT}"
FUND="${FUND:-2.3 NEAR}"   # wasm ~195 KB locks ~2 NEAR of storage

echo "Building..."
(cd "$ROOT/shirts" && cargo near build non-reproducible-wasm)
WASM="$ROOT/shirts/target/near/nearling_shirts.wasm"

echo "Creating $CONTRACT (funded $FUND by $NEAR_PARENT_ACCOUNT)..."
near account create-account fund-myself "$CONTRACT" "$FUND" \
  autogenerate-new-keypair save-to-legacy-keychain \
  sign-as "$NEAR_PARENT_ACCOUNT" network-config testnet sign-with-legacy-keychain send

echo "Deploying and calling new..."
near contract deploy "$CONTRACT" use-file "$WASM" \
  with-init-call new json-args '{}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send

echo "Done. Set SHIRTS_CONTRACT=$CONTRACT in .env (brain and web read it)."
near contract call-function as-read-only "$CONTRACT" nft_metadata json-args '{}' network-config testnet now
