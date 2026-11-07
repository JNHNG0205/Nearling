# S6 spike: pets contract as NEARON iNEAR holder

Throwaway. Answers the S6 questions in `CLAUDE.md` section 14 before we build Option A for real. Record results there, then delete this folder or leave it as evidence.

`call_pool(method, args, deposit, gas_tgas)` forwards any call to the pool from the spike contract (the holder) and logs `ok <method>: <result>` or `failed <method>` in a callback.

## Setup

```bash
set -a; source ../../.env; set +a
SPIKE="s6-spike.$NEAR_PARENT_ACCOUNT"
POOL=mw-pool-1024.testnet

cargo near build non-reproducible-wasm
near account create-account fund-myself "$SPIKE" '3 NEAR' autogenerate-new-keypair save-to-legacy-keychain \
  sign-as "$NEAR_PARENT_ACCOUNT" network-config testnet sign-with-legacy-keychain send
near contract deploy "$SPIKE" use-file target/near/s6_nearon_spike.wasm \
  with-init-call new json-args "{\"owner\":\"$NEAR_PARENT_ACCOUNT\",\"pool\":\"$POOL\"}" \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send

# helper: pool_call <method> <args-json> <deposit-yocto> <inner-gas-tgas> <outer-gas>
pool_call() {
  near contract call-function as-transaction "$SPIKE" call_pool \
    json-args "{\"method\":\"$1\",\"args\":$(printf '%s' "$2" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),\"deposit\":\"$3\",\"gas_tgas\":$4}" \
    prepaid-gas "$5" attached-deposit '0 NEAR' \
    sign-as "$NEAR_PARENT_ACCOUNT" network-config testnet sign-with-legacy-keychain send
}
view_account() {
  near contract call-function as-read-only "$POOL" get_account json-args "{\"account_id\":\"$SPIKE\"}" network-config testnet now
}
```

## Steps and what to record

| # | Run | Question it answers |
|---|---|---|
| 1 | `pool_call deposit_and_stake '{}' 1100000000000000000000000 400 '450 Tgas'` then `view_account` | Can a contract stake? First-deposit storage fee? Does 450 Tgas outer fit? If rejected, retry outer `'1000 Tgas'` and note the max |
| 2 | Repeat 1 with inner `300`, `350` | Real minimum inner gas for `deposit_and_stake` |
| 3 | `pool_call unstake '{"amount":"100000000000000000000000"}' 1 400 '450 Tgas'` (needs exactly 1 yocto), then again a few minutes later; `view_account` | Each queued withdrawal keeps its own unlock epoch? |
| 4 | After unlock (about 12 h): `pool_call withdraw '{}' 0 400 '450 Tgas'` | Withdraw pays all matured to the contract |
| 5 | `pool_call claim_and_topup "{\"org_id\":\"$NEAR_AI_ORG_ID\"}" 0 400 '450 Tgas'` (retry deposit `2000000000000000000000` if it wants the 0.002 NEAR fee) | Contract can top up the staging NEAR AI org; Role 2 confirms the org balance |
| 6 | `view_account` over an hour | Real testnet farm rate (claimable growth per NEAR per day) |

Pass: steps 1, 3, 5 succeed from the contract. Then Option A stays; otherwise switch to Option B and record why.
