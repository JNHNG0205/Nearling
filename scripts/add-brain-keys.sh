#!/usr/bin/env bash
# Adds the brain's function-call keys (CONTRACT_CHANGES_V9.md 6.3). The brain generates each
# keypair and keeps the private key; Role 2 sends only the public keys.
# A function-call key works for one receiver, so run once per pets contract:
#   ./scripts/add-brain-keys.sh pets-v9.nearling.testnet ed25519:AAA ed25519:BBB ...
# Needs: near CLI, .env, the BRAIN_ACCOUNT full access key in ~/.near-credentials (legacy keychain).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a

CONTRACT="$1"; shift
ALLOWANCE="${ALLOWANCE:-1 NEAR}"   # gas budget per key; each key can only call the methods below

for PK in "$@"; do
  echo "Adding $PK -> $CONTRACT (charge, credit, sweep_credit, set_metadata)..."
  near account add-key "$BRAIN_ACCOUNT" grant-function-call-access \
    --allowance "$ALLOWANCE" --contract-account-id "$CONTRACT" \
    --function-names 'charge, credit, sweep_credit, set_metadata' \
    use-manually-provided-public-key "$PK" \
    network-config testnet sign-with-legacy-keychain send
done
near account list-keys "$BRAIN_ACCOUNT" network-config testnet now
