#!/usr/bin/env bash
# Dev cheat (testnet): set a pet's battle level (1 to 20; XP toward the next level back to 0,
# wins and losses kept). Admin only (contract admin_set_battle_level). Skills unlock at 3, 6, 10.
#   ./scripts/dev-battle-level.sh <pet_id> <level> [demo]      e.g. ./scripts/dev-battle-level.sh 10 10
# "demo" targets the demo-speed contract. Needs: near CLI, .env, the admin
# (NEAR_PARENT_ACCOUNT) key in ~/.near-credentials (legacy keychain).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a

PET="${1:?pet id}"
LEVEL="${2:?battle level}"
CONTRACT="$PETS_CONTRACT"
[ "${3:-}" = demo ] && CONTRACT="$DEMO_PETS_CONTRACT"

near contract call-function as-transaction "$CONTRACT" admin_set_battle_level \
  json-args "{\"pet_id\":\"$PET\",\"level\":$LEVEL}" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as "$NEAR_PARENT_ACCOUNT" network-config testnet sign-with-legacy-keychain send 2>&1 \
  | grep -E "Transaction ID|battle_level_up|E_[A-Z_]+" || true
near contract call-function as-read-only "$CONTRACT" get_battle json-args "{\"pet_id\":\"$PET\"}" \
  network-config testnet now 2>/dev/null | grep -E '"level"|"wins"|"losses"'
