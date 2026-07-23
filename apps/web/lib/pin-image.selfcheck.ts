// Checks for lib/pin-image.ts validateAndReencode (network-free half).
// Run: node --experimental-strip-types lib/pin-image.selfcheck.ts
//
// This is the security-critical surface: it must reject SVG/polyglots, corrupt
// and empty files, and oversized uploads, and it must re-encode deterministically
// (the pinned bytes are what the on-chain CID addresses).

import assert from "node:assert/strict"

import sharp from "sharp"

import { MAX_BYTES, PinImageError, validateAndReencode } from "./pin-image.ts"

const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#a3e635" } })
  .png()
  .toBuffer()
const jpeg = await sharp(png).jpeg().toBuffer()
const tall = await sharp({ create: { width: 40, height: 4000, channels: 3, background: "#f00" } })
  .png()
  .toBuffer()

async function rejectsWith(code: string, input: Buffer, label: string) {
  await assert.rejects(
    () => validateAndReencode(input),
    (e: unknown) => e instanceof PinImageError && e.code === code,
    label
  )
}

// Happy path: a real PNG -> webp bytes.
const out = await validateAndReencode(png)
assert.equal(out.contentType, "image/webp", "output is webp")
assert.ok(out.bytes.length > 0, "produced bytes")
assert.equal((await sharp(out.bytes).metadata()).format, "webp", "bytes decode as webp")

// JPEG also accepted (raster allowlist).
assert.equal((await validateAndReencode(jpeg)).contentType, "image/webp", "jpeg accepted")

// Oversized image is downsized to fit MAX_DIM (1024) — never upscaled.
const tallOut = await sharp((await validateAndReencode(tall)).bytes).metadata()
assert.ok(tallOut.height! <= 1024, "tall image capped to <=1024 on the long edge")

// SVG must be rejected (stored-XSS vector) — whether sharp throws OR decodes it
// as format "svg", the allowlist refuses it.
await rejectsWith(
  "not_image",
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  "svg rejected"
)
// A .png name doesn't help: gate is on decoded bytes, not the name/mime.
await rejectsWith("not_image", Buffer.from("not an image at all"), "garbage bytes rejected")
await rejectsWith("empty", Buffer.alloc(0), "empty rejected")
await rejectsWith("too_large", Buffer.alloc(MAX_BYTES + 1), "oversized rejected (before decode)")

// Determinism: same input + fixed encode settings -> byte-identical output.
const a = await validateAndReencode(png)
const b = await validateAndReencode(png)
assert.ok(a.bytes.equals(b.bytes), "re-encode is deterministic")

console.log("pin-image.ts validateAndReencode: all checks passed")
