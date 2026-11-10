#!/usr/bin/env bash
# Seeds demo pets in each state on $PETS_CONTRACT, plus one on pets-demo that goes dormant within
# about an hour (CLAUDE.md 7 demo speed, README "do X, see Y").
# Needs: near CLI, .env, the SEED_OWNER and BRAIN_ACCOUNT keys in ~/.near-credentials (legacy keychain).
# The owner pays about 3.2 NEAR (4 mints, a 2 NEAR stake, the demo mint, gas).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a

OWNER="${SEED_OWNER:-nearling-seed.testnet}"
DEMO="pets-demo.${NEAR_PARENT_ACCOUNT}"
RUN="$(date +%s)"   # makes usage_refs unique per run (charge is idempotent on usage_ref)

call() { # signer contract method args gas deposit
  near contract call-function as-transaction "$2" "$3" json-args "$4" \
    prepaid-gas "$5" attached-deposit "$6" \
    sign-as "$1" network-config testnet sign-with-legacy-keychain send 2>&1
}

mint() { # contract price name soul -> prints the token id
  call "$OWNER" "$1" nft_mint_pet "{\"name\":\"$3\",\"soul\":\"$4\"}" '50 Tgas' "$2" \
    | grep -E '^"[0-9]+"$' | tr -d '"'
}

spend() { # pet micro-USD: the brain bills chats of at most 5_000 (the per-call cap)
  local pet=$1 left=$2 n=0 cost
  while [ "$left" -gt 0 ]; do
    cost=$(( left < 5000 ? left : 5000 ))
    call "$BRAIN_ACCOUNT" "$PETS_CONTRACT" charge \
      "{\"pet_id\":\"$pet\",\"cost_micro_usd\":$cost,\"usage_ref\":\"seed-$RUN-$pet-$n\",\"trait_deltas\":null,\"xp_gain\":1,\"mood_delta\":0}" \
      '50 Tgas' '0 NEAR' >/dev/null
    left=$(( left - cost )); n=$(( n + 1 ))
  done
}

state() { # contract pet
  near contract call-function as-read-only "$1" get_pet json-args "{\"pet_id\":\"$2\"}" \
    network-config testnet now 2>/dev/null \
    | python3 -c 'import json,sys; t=sys.stdin.read(); p=json.loads(t[t.index("{"):t.rindex("}")+1]); print("%-7s %-9s budget $%.4f  fullness %3d  self_sustaining %s" % (p["name"], p["life_state"], p["budget_micro"]/1e6, p["fullness"], p["self_sustaining"]))'
}

echo "Seeding $PETS_CONTRACT as $OWNER..."
HAPPY=$(mint "$PETS_CONTRACT" '0.2 NEAR' Sunny 'A sunny, chatty sprite who loves morning walks.')
HUNGRY=$(mint "$PETS_CONTRACT" '0.2 NEAR' Crumb 'A snack-obsessed fox who measures life in crumbs.')
STARVING=$(mint "$PETS_CONTRACT" '0.2 NEAR' Echo 'A quiet echo spirit who repeats your best jokes.')
RICH=$(mint "$PETS_CONTRACT" '0.2 NEAR' Sprout 'A patient sprout who grows on staking yield.')

# Starter food is 0.1 NEAR = $0.02 = 20_000 micro-USD at the testnet rate.
spend "$HUNGRY" 19000      # leaves $0.001: under 40 fullness, Hungry
spend "$STARVING" 20000    # empty: Starving (Low Fuel), dormant 72 h later
call "$OWNER" "$PETS_CONTRACT" stake "{\"pet_id\":\"$RICH\"}" '450 Tgas' '2 NEAR' >/dev/null  # 1_314 µ$/day >= burn

echo "Seeding $DEMO (demo speed)..."
DORMANT=$(mint "$DEMO" '0.105 NEAR' Blink 'A sleepy comet who naps between galaxies.')

echo
echo "$PETS_CONTRACT"
for id in "$HAPPY" "$HUNGRY" "$STARVING" "$RICH"; do echo "  #$id $(state "$PETS_CONTRACT" "$id")"; done
echo "$DEMO (Starving in ~14 min, Dormant in ~58 min)"
echo "  #$DORMANT $(state "$DEMO" "$DORMANT")"
