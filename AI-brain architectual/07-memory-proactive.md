# 07. Memory and the pet reaching out first

## 1. Memory (`talk/memory.ts`)

Per `(pet_ref, owner_account)`:

| Part | Size | Updated |
|---|---|---|
| Last turns | 10 loaded into the prompt | every turn |
| Summary | one paragraph | every 20 turns |
| Facts | up to 30, each ≤ 120 chars, optional `follow_up_on` date | at summary time |

Summary job (every 20 turns, async, not charged as fuel; provider cost logged): one private-model call that returns JSON `{ summary, facts: [{ fact, follow_up_on|null }] }` from the old summary + last 20 turns. Facts with a date drive follow-ups ("You said your exam was today. How did it go?").

Encryption: `key = HKDF-SHA256(MEMORY_MASTER_KEY, salt "nearling-mem-v1", info pet_ref)`, AES-256-GCM, random 12-byte IV per field. Honest limit (README): the brain operator can read memories.

Transfer: when `get_pet.owner != pet_profile.owner_account`: archive memory, reset nickname, revoke devices, clear `equipped_shirt` ownership check on next sync, new owner starts fresh; inbox "Hi! I'm Mochi. I don't know you yet." `form` (winged) stays with the pet, like traits on chain.

## 2. Scheduler (`proactive/scheduler.ts`)

One process, `setInterval` with an overlap guard per job.

| Job | Every | Work |
|---|---|---|
| Proactive | 15 min | Rules below for each known pet (`pet_profile` rows, plus `nft_tokens` paging for new ones) |
| Charge worker | continuous | 04 section 2 |
| Order watcher | 10 s | Live orders: 1Click status; settled orders: feeder `feed` |
| Verify worker | continuous | Signatures for new turns |
| Attestation refresh | 30 min | Per chat model |
| Garden sweep | 1 h | Claimable check, `sweep_credit` |
| Cost reconcile | 5 min | `/v1/billing/costs` for recent inference ids |
| Cleanup | 1 h | Expire pairings, approvals, quotes, audio blobs |

## 3. Proactive rules (`CLAUDE.md` 5.5, adapted to fuel)

| Trigger | Condition | Text | Fuel |
|---|---|---|---|
| `fuel_low` | fuel left crosses below 5 | canned | free |
| `fuel_empty` | life state becomes Starving | canned "My brain is out of fuel" + feed QR hint | free |
| `dormant` / `revived` | life state change | canned | free |
| `evolved` | `form` becomes winged | canned | free |
| `lonely` | `care_mood` < 30 | canned | free |
| `missed_you` | no owner turn for 24 h | inference with memory | 1 fuel |
| `morning` | owner local 07:00 to 10:00, once a day | inference | 1 fuel |
| `follow_up` | fact due today (owner tz) | inference | 1 fuel |

Limits: max 3 per pet per UTC day; one per pass; billed ones skipped when fuel left < 5 or at night (22:00 to 07:00 owner tz); threshold ones fire once per crossing (`proactive_day.fired`). Billed proactive messages are normal turns (`channel = proactive`), so they get a `charge_job` and a receipt.

Delivery: `inbox` row; SSE `inbox` to open web sessions; device polls `GET /pets/:petRef/inbox?after=` every 20 s, plays bounce + chime, marks delivered.
