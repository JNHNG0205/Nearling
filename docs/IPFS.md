# Pet metadata on IPFS

Each Nearling has a public metadata JSON and a PNG image pinned to IPFS through Pinata. Wallets and
explorers read them from the NFT's NEP-177 metadata once the pets contract has `set_metadata`
(`pets-v9`, `docs/CONTRACT_CHANGES_V9.md` section 2). The Soul's source of truth stays on chain
(`get_soul`); IPFS is a public mirror.

Code: `brain/src/metadata/` (build, Pinata client, sync), `packages/sprites/src/render.ts` (PNG).

## What is pinned

The PNG is the pet's idle frame (256 x 256, brand background), drawn from the same sprites as the
web app and the device.

The JSON has only public fields, all of them already readable on chain or visible on the public pet page:

| Field | Source |
|---|---|
| `name`, `contract`, `token_id` | NFT |
| `description` | First 200 bytes of the Soul (default line when there is no Soul) |
| `soul { version, prompt }` | `get_soul` (already public on chain) |
| `traits { playful, curious, calm, sassy, kind }` | `get_pet` |
| `stage`, `form`, `equipped_shirt` | Public look (stage, wings, Closet shirt NFT id) |
| `image` | `ipfs://<png cid>` |
| `external_url` | `PUBLIC_WEB_URL/p/<petRef>` |
| `attributes` | OpenSea-style list of the above |

## What is never pinned

Chat turns, memories and summaries, the owner nickname, the owner time zone, care stats and mood,
fuel and garden numbers, device and pairing data, receipts, and the owner account. A test
(`brain/src/metadata/metadata.test.ts`) fails if a nickname, time zone or owner account reaches the JSON.

## When it is pinned

- On the bus events `evolved`, `hatched` and `closet_equipped`, and when a 60 s check sees a new
  Soul version, stage, form, shirt or name. Debounced per pet: at most one run per 60 s.
- Only changed bytes are pinned again (compared by sha256). An unchanged pet costs no Pinata call.
- Without `PINATA_JWT` the module logs one warning at start and does nothing.

## Verify a CID

1. `GET <brain>/pets/<petRef>/metadata` returns `json_cid`, `png_cid` and gateway links.
2. Fetch the JSON from any gateway (`https://ipfs.io/ipfs/<json_cid>`) and check it is what the page shows.
3. With `pets-v9`: `nft_token` returns `reference = ipfs://<json_cid>` and
   `reference_hash` = base64 sha256 of the JSON bytes. Check it:
   `curl -s https://ipfs.io/ipfs/<json_cid> | sha256sum | cut -d' ' -f1 | xxd -r -p | base64`
   The same works for `media` / `media_hash` and the PNG.
4. Recompute the CID locally (optional): `ipfs add --only-hash --cid-version 1 pet.json` should
   print the same CID [VERIFY: Pinata's v3 default chunking matches `ipfs add` defaults].

## Pinata API used

`POST https://uploads.pinata.cloud/v3/files` with `Authorization: Bearer <PINATA_JWT>`, multipart
`file`, `network=public`, `name`; the CID is `data.cid` in the response. Both the PNG and the JSON go
through this endpoint so the hashed bytes are exactly the pinned bytes. [VERIFY] live: CIDv1 by
default and `is_duplicate: true` when the same bytes are pinned again.
