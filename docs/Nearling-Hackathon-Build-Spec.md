# Nearling | Hackathon Build Spec

Nearling is a physical AI Tamagotchi. You hatch and own a pet on NEAR, talk to it, refill its AI fuel, care for it offline, dress it, race a friend, and start wallet actions from the device. This spec captures the agreed feature scope and proposes implementation details where choices are still open.

## Scope

| Priority | Features |
|---|---|
| Core | 1. Hatch & Pair · 2. Soul & Verified Talk · 3. Feed the Brain · 4. Pat, Rock & Sleep · 5. Closet & Evolutions · 6. Battle Arena: Nearling Run · 7. Nearling Wallet |
| Stretch | 8. Approve on Nearling for pet transfers · 9. Brain Garden |
| Future | Dedicated signing chip, friend visits and postcards, Dream Journal, agent quests, advanced chat modes, and Arena prizes or paid entry |

## System layout

| Part | Responsibilities |
|---|---|
| **Nearling firmware** | Wi-Fi setup, display, buttons, audio capture and playback, local care reactions, race controls and rendering, and transaction review. |
| **Phone web app** | Wallet connection, pet and shirt claims, checkout, verification receipts, wallet signature prompts, and transaction status. |
| **Backend** | Device pairing and access, pet profiles, fuel accounting, payment reconciliation, AI and voice calls, race rooms and results, and wallet approval requests. |
| **NEAR** | Pet and shirt NFT ownership, the public personality and its version, and finalized wallet transactions. |
| **External services** | NEAR AI for transcription and replies, a speech engine for spoken playback, NEAR Intents for checkout, and Meteor for wallet signing. |

## Hardware reference for the coding agent

**Use this section whenever you implement or review a device-facing feature.** Check that its layout, input, audio, and sensor behavior work with the parts below. Preview the device UI at the real screen size and keep hardware settings in one board configuration. Verify the received board's pinout before assigning GPIOs. Use the same feature logic with simulated inputs in the browser and real inputs in firmware. [Shopping list and part links](Nearling-Shopping-List.md)

| Selected hardware | What to account for in code |
|---|---|
| **QQ ESP32-S3 camera development board** | Wi-Fi and device firmware run here. Leave the camera disconnected. Confirm the USB-C programming port and exposed pins on the actual unit. Plan pins together for the SPI display, I²S audio, I²C sensors, touch sensor, and buttons. |
| **1.3-inch square ST7789 TFT, 240 × 240** | Design pet sprites, menus, the two-lane race, and text at 240 × 240. Test QR scans at actual size with a clear border. Wrap or page long wallet destinations so the player can review every character. |
| **INMP441 I²S mic, MAX98357 I²S amp, QQ 45 mm 8 Ω speaker rated 0.4 W peak** | Record on press and stop on release. Play replies and game sounds at a fixed, bench-verified output limit below the speaker rating. Start with low gain and check loud sounds at the configured limit. Keep reply text available if playback fails. |
| **Three momentary tactile buttons and TTP223 touch sensor** | Debounce clicks and holds. Use one click to switch lanes immediately. Keep touch input separate for pats, and test it through the assembled shell. A vibration motor is optional and absent from this shopping list. |
| **GY-521 / MPU6050 motion and GY-30 / BH1750 light sensors** | Use motion for rocking and shaking. Use sustained darkness for sleep. Share the I²C bus if the verified module setup allows it, and tune the thresholds with the sensors mounted in the case. |
| **802535 800 mAh LiPo, protected TP4056 USB-C charger, MT3608 5 V booster, on/off rocker** | Test Wi-Fi, display, and audio together on battery power and verify boot and reconnect behavior. Keep the AI fuel meter distinct from battery charge. Show a battery percentage only if battery telemetry is implemented and calibrated. See the shopping list for the charging checks. |
| **Jumper wires, MB-102 breadboard, 5 × 7 cm perfboard, 2.54 mm headers, existing USB-A to USB-C data cable** | Use these for bench bring-up and assembly. Verify programming and power on the finished wiring before testing device features. |

## Core features

### 1. Hatch & Pair

**What and why.** Turn a new box into the home for a pet the player owns. The same owner can bring that pet to a replacement Nearling.

**User flow.** First boot shows **Connect to Wi-Fi**. The player joins Nearling’s temporary setup network on their phone and opens its local setup page. They enter their home Wi-Fi details. After Nearling reaches the backend, the display shows an egg and the **Hatch & Pair** QR. The player scans it, connects Meteor, picks and names a pet, then approves the mint. Nearling displays **Pair Mochi?** and a button press makes the egg hatch. A returning owner can select an existing pet.

**How to build it.** Host a password-protected local Wi-Fi setup page, with a manual way to open it if the phone does not prompt. Keep Wi-Fi credentials on the device. Once online, issue a short-lived pairing session tied to an authenticated device. Use NEAR Connect and a signed ownership challenge to link the wallet session, verify the mint or existing ownership on-chain, and complete the binding after physical confirmation. Store pet state by NFT identity. Revoke the old binding when replacing a device and recheck access after ownership changes. [Espressif local setup example](https://github.com/espressif/esp-idf/blob/master/examples/protocols/http_server/captive_portal/README.md) · [NEAR Connect](https://docs.near.org/tools/near-connect) · [NEAR NFT standard](https://docs.near.org/primitives/nft/standard)

**Done when.** A fresh device can complete the phone flow, reboot into the same pet, and pair an existing pet to a replacement without minting it again. An expired or already-used pairing code cannot establish another binding.

### 2. Soul & Verified Talk

**What and why.** Talk to a pet that replies in its own character. Its **Soul** is a short, public, versioned personality prompt. A receipt lets a judge or player inspect what was verified about a reply.

**User flow.** Hold the button to record. The display shows **Listening**, then **Thinking** on release. The pet’s reply appears as text and plays through the speaker. The owner can open the receipt on their phone. One completed short chat spends one fuel. The text remains available if audio playback fails.

**How to build it.** Send a capped recording to the backend. Transcribe with Whisper on NEAR AI, fetch the pet’s current prompt from NEAR, and send both to one configured, verification-capable chat model. GLM Flash is a candidate. Send the reply text to ElevenLabs for the first playback test, with self-hosted Kokoro as the other voice option. The chat model generates dialogue only. Keep voice and chat off-chain, and keep provider credentials on the backend. Reserve one fuel before processing. Save the completed text reply and debit the reservation together so the device can retrieve the same reply after a retry. Release the reservation if generation fails. Track provider spend separately. [NEAR AI transcription](https://docs.near.ai/cloud/guides/specialized-endpoints#audio-transcription) · [NEAR AI model pricing](https://near.ai/pricing) · [ElevenLabs](https://elevenlabs.io/text-to-speech-api) · [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M)

For the receipt, verify the relevant attestation before the model call, retain the exact request and response bytes for the verification window, and verify the signature against those bytes. Use a canonical model ID and a nonstreaming request for the initial verification test. Display the prompt version and the result **Model verified**, **Gateway verified**, or **Unverified**. Publish independently inspectable evidence only for an opt-in demo exchange. [NEAR AI response verification](https://docs.near.ai/cloud/verification/cloud-api/response-signatures)

**Done when.** A single press-and-release creates one reply, one fuel debit, and an honest receipt. Retrying the same request produces no additional debit. When fuel is empty, the device shows **Low Fuel** and local care still works.

### 3. Feed the Brain

**What and why.** Refill the pet’s chat allowance with a one-time payment. The owner and a friend use the same checkout. A friend can gift fuel from a different supported chain.

**User flow.** Open **Feed** on Nearling and scan the QR. The phone shows the pet, pack size, and quoted payment. The payer approves in their own wallet. Nearling shows **Payment pending**. After settlement, the meter increases and the pet celebrates once.

**How to build it.** The QR identifies the pet. Each purchase creates a separate order bound to that pet and a fresh NEAR Intents quote. Store the expected settlement asset, amount, destination, and quote reference on the backend. Confirm delivery to the project account, then mark the order paid and grant fuel in one database transaction with a unique credit per order. Show clear outcomes for expired quotes, refunds, or failed payments. Provider bills still come from the project’s accounts. Start by testing one pack and one route, with Solana USDC as a candidate. Confirm the route minimum and fees before setting a price. [NEAR Intents quote and settlement guide](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request)

**Done when.** A simulated order and a small live settlement each move the same meter. Duplicate settlement notifications and page refreshes add fuel once. Pending, failed, and refunded payments leave the prior balance intact. The pet can spend the new fuel on the next reply.

### 4. Pat, Rock & Sleep

**What and why.** Give the pet physical reactions that work offline and use zero AI fuel.

**User flow.** Tap the touch pad and the pet perks up. Rock the box gently and it gets drowsy. A quick shake makes it dizzy. After the room stays dark briefly, the pet yawns and falls asleep.

**How to build it.** Drive a small local animation state machine from touch, motion, and ambient light. Debounce taps, distinguish rocking from shaking with thresholds and cooldowns, and require sustained darkness to ignore a hand briefly covering the sensor. Record meaningful care milestones locally for evolution and sync them when the device reconnects.

**Done when.** All reactions work with Wi-Fi off. Ordinary handling gives consistent responses, and one gesture cannot repeatedly award the same milestone.

### 5. Closet & Evolutions

**What and why.** The Closet lets players wear a collectible shirt they own. Evolution rewards care with a lasting change to the same pet.

**User flow.** Claim one **NEAR NFT shirt** in the phone app with the linked wallet. Open **Closet** on Nearling and equip it with a button. Pat the pet, rock it gently, and put it to sleep. Completing all three shows an evolution animation and unlocks the winged form.

**How to build it.** Mint a shirt collectible and verify current ownership when the Closet syncs. The device draws the shirt as a sprite layer and the app stores the equipped choice. On the next successful sync after a transfer, remove the shirt from the previous owner’s Closet and clear it if equipped. Store the winged stage in the pet profile keyed to its existing NFT. Sync the three care milestones idempotently. [NEAR NFT ownership and transfers](https://docs.near.org/primitives/nft/standard)

**Done when.** The shirt appears after a confirmed claim, can be equipped with the device controls, and follows wallet ownership on sync. The pet earns wings once, and a replacement device loads the same evolved form.

### 6. Battle Arena: Nearling Run

**What and why.** Two players race live on **two physical Nearlings**. The first prototype also supports a browser opponent so the live demo can run with one physical unit. It is a continuous, two-lane obstacle game with one tactile control. Both pets appear in the same race view on each client.

**User flow.** One player creates an online room and shares the code. The other joins from their own Nearling or the demo browser client. Both press **Ready**, see a shared countdown, and start the same course. One button press switches lanes on Nearling, and one key press does the same in the browser. Obstacles get faster. The first pet to crash loses, and both screens show the result.

**How to build it.** The server assigns a course seed, rules version, and start time after both devices are ready. Both devices use the same deterministic obstacle generator, speed schedule, and fixed simulation step. Move the local pet immediately on button press and relay lane changes so the other device can render it. Compare validated crash ticks on the shared race clock to decide the outcome. For the prototype, replay reported inputs against the shared course to verify the result. Proposed defaults are a draw for the same crash tick and an interrupted match for a sustained disconnect. Match entry is free for the first build. Fuel prizes and paid entry remain separate decisions.

**Done when.** The prototype can race a physical Nearling against a browser client. Test two physical units when both are available. Both clients can join from separate networks, see both pets, and get the same result even when messages arrive late or out of order. A disconnect clears the match without declaring a winner. The local button stays responsive while the opponent’s display updates catch up.

### 7. Nearling Wallet

**What and why.** Give Nearling a native **Wallet** menu for balance, send, and ordinary NEAR staking. The player starts and reviews the action on the Tamagotchi. Meteor holds the keys and signs on the phone.

**User flow.** Open **Wallet** to see available and staked NEAR. For **Send**, choose a saved recipient and amount. For **Stake**, choose a validator and amount. Review the action, full destination, and amount on Nearling, then hold the button to approve. Open the matching request in the linked phone session, review and sign in Meteor, and see the resulting status on Nearling.

**How to build it.** Read liquid balance from the linked NEAR account and staked balance from its staking pools. Use an expiring, one-use approval request bound to the network, account, paired device, action, destination, and exact amount. The phone constructs the transaction from that approved request. Start on testnet with a saved recipient and a verified testnet staking pool. Track the transaction to finality and refresh the account display. The testnet UI can hand off through the phone web app or a QR if a wallet deep link is unavailable. The signing chip stays future work. [NEAR transaction actions](https://docs.near.org/protocol/transactions/transaction-anatomy#actions) · [NEAR staking and delegation](https://near-nodes.io/validator/staking-and-delegation) · [NEAR Connect](https://docs.near.org/tools/near-connect)

**Done when.** A testnet send and stake each begin on the device, require a matching physical approval and wallet signature, and refresh balances after finality. Changing the amount or destination requires a new approval. Expired, rejected, or replayed requests cannot proceed through Nearling’s flow.

## Stretch features

### 8. Approve on Nearling for pet transfers

**What and why.** Add a deliberate physical check before giving away a pet. This extends the Wallet approval mechanism to an NFT action. The extra check applies to transfers started inside Nearling’s app.

**User flow.** Start **Transfer Mochi** on the phone and choose a recipient. The paired device shows the exact pet and recipient. Hold to approve, review and sign in Meteor, then see the finalized transfer.

**How and done when.** Reuse the one-time approval request with the NFT contract and token identity bound to it. Verify current ownership before signing, and invalidate the former owner’s device access after the confirmed transfer. The recipient can then pair the pet with their device. [NEAR NFT transfer interface](https://docs.near.org/primitives/nft/standard)

### 9. Brain Garden

**What and why.** Use staking rewards to help a pet earn inference fuel over time. This differs from the Wallet’s ordinary validator staking and from buying a one-time fuel pack.

**User flow.** Open **Brain Garden** and see **Credit growing** and **Fuel ready**. For the first test, the team allocates a team-funded stake. When earned credit reaches the intended NEAR AI account, Nearling adds the corresponding allowance to the right pet.

**How and done when.** Test one stake-to-credit route end to end. NEAR AI has an inference staking flow, and the earlier plan identified NEARON as a candidate for routing credit per pet. Confirm availability, beneficiary binding, and delivery before choosing an integration. Keep accrued, pending, and spendable balances distinct. Credit the pet once after delivery. The voice provider has its own bill. The demo starts with prepaid fuel while this is tested. [Staking for NEAR AI](https://near.ai/blog/staking-for-near-ai)

## Future additions

| Feature | What it does, how it works, and user flow |
|---|---|
| **Dedicated signing chip** | Create a restricted key inside an Ed25519-capable secure element and use it for one testnet action. Review the action on the device, press to approve, and return the signature. A hardware-wallet-grade approval flow also needs a trusted screen and button path. The selected NXP chip is deferred for this submission. [NXP signing configurations](https://www.nxp.com/docs/en/application-note/AN12436.pdf) |
| **Friend Visits & Postcards** | Show a visit code, let a friend scan it, and have both pets react. Record ordinary visits in the app and optionally issue a collectible event postcard. |
| **Dream Journal** | Summarize a small set of care events into a short diary entry. The device shows one line, and the phone shows the full private entry. |
| **Send My Pet on a Quest** | Pick a preset quest such as a story or puzzle, confirm the job and cost on the phone, then show the result on Nearling. Evaluate the existing NEAR Agent Market for job dispatch and settlement. [NEAR Agent Market](https://docs.market.near.ai/) |
| **Chat and Deep Think modes** | Let the player choose everyday chat or a harder reasoning turn. Show its fuel cost before sending and use a model and output cap appropriate to the mode. Evaluate automatic routing after measuring both modes. |
| **Arena prizes and paid entry** | An optional prize can credit the winner’s existing fuel balance. A team-funded reward can be tested separately. A paid match would require clear funding, settlement, draw and disconnect rules, and a local rules review before collecting real money. |

## Build order and handoff

1. **Browser first.** Make a simulated Nearling screen and a phone view. Prove pairing, a mocked voice exchange, the fuel meter, and payment reconciliation. Test Nearling Run in two browser clients using the same race rules that firmware will use.
2. **Verify external integrations.** Test Meteor on the target phone, mint one pet and one shirt on testnet, verify a real NEAR AI reply, and test spoken playback. Validate a dry payment quote before running a small live settlement. Verify the native send and stake paths on testnet.
3. **Bring up one physical Nearling.** Use the hardware reference above to validate display, Wi-Fi onboarding, buttons, microphone, speaker, sensors, and battery operation. Port the device UI and race rules. Test a full race with a browser opponent across different networks, then repeat with two physical units when available.
4. **Rehearse a single end-to-end demo.** Hatch Mochi, talk and open a receipt, top up fuel, show an offline reaction, equip the shirt and evolve, race the browser opponent or a second device, and finish with one testnet wallet action. Keep the two stretch features independently testable.

**Shared records to implement.** Device and pairing session, pet and prompt version, care and outfit state, fuel balance and ledger entries, chat turn and receipt, payment order, match and result, and wallet approval request. Use durable IDs so mint callbacks, chat retries, payment checks, match result delivery, and wallet polling can safely repeat.

**Decisions to validate during the build.** Exact reply model, voice, clip and reply limits, and starter fuel amount. Supported payment route, minimum and fees, pack size and price. Race speed, button response, disconnect grace, and tie behavior. The first testnet validator and the phone signing handoff. Treat proposed defaults as adjustable after bench tests.
