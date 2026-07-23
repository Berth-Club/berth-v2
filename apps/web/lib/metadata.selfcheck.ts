// Checks for lib/metadata.ts. Run: node --experimental-strip-types lib/metadata.selfcheck.ts
//
// The property under test is determinism: metadataURI feeds the CREATE2 initcode
// hash, so the same inputs MUST produce byte-identical output, and an uploaded
// ipfs:// image must land in the `image` field verbatim (a wrong image field =>
// a different predicted address than the one the user signed for).

import assert from "node:assert/strict"

import { buildMetadataURI, normalizeTicker } from "./metadata.ts"

// normalizeTicker: uppercase, strip non-alphanumeric, cap at 8.
assert.equal(normalizeTicker("my coin!"), "MYCOIN", "lowercases, strips punctuation/space")
assert.equal(normalizeTicker("abcdefghij"), "ABCDEFGH", "caps at 8")
assert.equal(normalizeTicker("a-b_c.d"), "ABCD", "strips separators")

// Determinism: identical inputs -> byte-identical string, both with and without
// an uploaded image. This is the property predict/deploy rely on.
const a1 = buildMetadataURI("Kraken Szn", "kraken", "deep one", "🐙", "ipfs://QmABC")
const a2 = buildMetadataURI("Kraken Szn", "kraken", "deep one", "🐙", "ipfs://QmABC")
assert.equal(a1, a2, "same inputs (with image) -> byte-identical")

const b1 = buildMetadataURI("Kraken Szn", "kraken", "deep one", "🐙")
const b2 = buildMetadataURI("Kraken Szn", "kraken", "deep one", "🐙")
assert.equal(b1, b2, "same inputs (no image) -> byte-identical")

// The uploaded ipfs:// CID must land in `image` verbatim.
const parsed = JSON.parse(decodeURIComponent(a1.replace("data:application/json,", "")))
assert.equal(parsed.image, "ipfs://QmABC", "uploaded CID is the image field")
assert.equal(parsed.name, "Kraken Szn")
assert.equal(parsed.symbol, "KRAKEN", "symbol is the normalized ticker")
assert.equal(parsed.emoji, "🐙")

// Without an upload, image falls back to the (non-ipfs) DiceBear placeholder —
// which toCoin nulls, so the coin renders its emoji. It must NOT be ipfs://.
const noImg = JSON.parse(decodeURIComponent(b1.replace("data:application/json,", "")))
assert.ok(!noImg.image.startsWith("ipfs://"), "no-upload image is not treated as an upload")

// URL-unsafe characters (in lore/name) must still round-trip and stay deterministic.
const weird = buildMetadataURI("A & B", "t", "50% off, \"quoted\" #1", "🚢", "ipfs://QmZ")
assert.equal(
  weird,
  buildMetadataURI("A & B", "t", "50% off, \"quoted\" #1", "🚢", "ipfs://QmZ"),
  "special chars stay deterministic"
)
const w = JSON.parse(decodeURIComponent(weird.replace("data:application/json,", "")))
assert.equal(w.description, "50% off, \"quoted\" #1", "special chars survive the round-trip")

console.log("metadata.ts: all checks passed")
