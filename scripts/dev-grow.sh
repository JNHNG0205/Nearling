#!/usr/bin/env bash
# Dev cheat (testnet): give a pet XP past the daily cap so it grows now. Admin only
# (contract admin_add_xp). Baby 10, Teen 100, Adult 500 XP.
#   ./scripts/dev-grow.sh <pet_id> <xp> [demo]      e.g. ./scripts/dev-grow.sh 7 100
# "demo" targets the demo-speed contract. Needs: near CLI, .env, the admin
# (NEAR_PARENT_ACCOUNT) key in ~/.near-credentials (legacy keychain).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a

PET="${1:?pet id}"
XP="${2:?xp to add}"
CONTRACT="$PETS_CONTRACT"
[ "${3:-}" = demo ] && CONTRACT="$DEMO_PETS_CONTRACT"

near contract call-function as-transaction "$CONTRACT" admin_add_xp \
  json-args "{\"pet_id\":\"$PET\",\"xp\":$XP}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as "$NEAR_PARENT_ACCOUNT" network-config testnet sign-with-legacy-keychain send 2>&1 \
  | grep -E "Transaction ID|stage_up|E_[A-Z_]+" || true
near contract call-function as-read-only "$CONTRACT" get_pet json-args "{\"pet_id\":\"$PET\"}" \
  network-config testnet now 2>/dev/null | grep -E '"name"|"stage"|"xp"'
