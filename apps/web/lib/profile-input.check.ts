/**
 * Pure self-check for profile-write validation. No DB, no framework.
 *
 *   node --import tsx lib/profile-input.check.ts
 */
import assert from "node:assert/strict"

import { BIO_MAX, NAME_MAX, httpUrlOrNull, isStorableImage, parseProfileInput } from "@/lib/profile-input"

function ok(raw: unknown) {
  const r = parseProfileInput(raw)
  assert.ok(r.ok, `expected valid, got ${JSON.stringify(r)}`)
  return r.data
}
function bad(raw: unknown, code: string) {
  const r = parseProfileInput(raw)
  assert.ok(!r.ok, `expected invalid (${code}), got ok`)
  assert.equal(r.code, code)
}

// Happy path: all fields trimmed; empties become null.
const d = ok({ name: "  alice ", bio: "gm", social: "https://x.com/a", image: "ipfs://Qm" })
assert.equal(d.name, "alice", "name must be trimmed")
assert.equal(d.bio, "gm")
assert.equal(d.social, "https://x.com/a")
assert.equal(d.image, "ipfs://Qm")

// Everything empty / missing => all null (a wholly-empty profile is valid).
assert.deepEqual(ok({}), { name: null, bio: null, social: null, image: null })
assert.deepEqual(ok({ name: "   " }), { name: null, bio: null, social: null, image: null })
// Non-string junk is ignored, not thrown on.
assert.deepEqual(ok({ name: 42, bio: null, social: undefined, image: {} }), {
  name: null,
  bio: null,
  social: null,
  image: null,
})

// Error paths.
bad({ name: "x".repeat(NAME_MAX + 1) }, "name_too_long")
bad({ name: "check my https://scam.xyz" }, "name_has_link")
bad({ bio: "x".repeat(BIO_MAX + 1) }, "bio_too_long")
bad({ social: "not a url" }, "bad_social")
bad({ social: "ftp://x.com" }, "bad_social") // non-http(s) rejected
bad({ social: "javascript:alert(1)" }, "bad_social") // XSS scheme rejected at write
bad({ image: "https://evil.com/a.png" }, "bad_image") // must be ipfs://

// httpUrlOrNull: the render-time guard against a stored javascript: href.
assert.equal(httpUrlOrNull("javascript:alert(1)"), null, "javascript: must not pass the href guard")
assert.equal(httpUrlOrNull("https://x.com/a"), "https://x.com/a")
assert.equal(httpUrlOrNull(null), null)
assert.equal(httpUrlOrNull("nonsense"), null)

// isStorableImage: accept ipfs:// (legacy/coins) or https on OUR R2 host only.
const R2 = "https://avatars.example.com"
assert.ok(isStorableImage("ipfs://Qmabc", R2), "ipfs:// must be accepted")
assert.ok(isStorableImage(`${R2}/avatars/abc.webp`, R2), "an on-host R2 url must be accepted")
assert.ok(!isStorableImage("https://evil.com/a.png", R2), "an off-host https url must be rejected")
assert.ok(
  !isStorableImage("https://avatars.example.com.evil.com/a", R2),
  "the trailing-slash guard must defeat the host-prefix trick"
)
assert.ok(!isStorableImage(`${R2}/avatars/x.webp`, ""), "with R2 off, only ipfs:// is storable")
assert.ok(!isStorableImage("javascript:alert(1)", R2), "a javascript: scheme is never storable")

// Boundary: exactly at the caps is allowed.
assert.equal(ok({ name: "x".repeat(NAME_MAX) }).name?.length, NAME_MAX)
assert.equal(ok({ bio: "x".repeat(BIO_MAX) }).bio?.length, BIO_MAX)

console.log("profile-input.check.ts: all assertions passed")
