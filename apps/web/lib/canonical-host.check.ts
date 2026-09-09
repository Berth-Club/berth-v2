import assert from "node:assert/strict"

import { isOffCanonicalHost } from "./canonical-host"

// The real site — must stay crawlable.
assert.equal(isOffCanonicalHost("berth.club"), false, "apex is canonical")
assert.equal(isOffCanonicalHost("www.berth.club"), false, "www is canonical")
assert.equal(isOffCanonicalHost("BERTH.CLUB"), false, "host match is case-insensitive")
assert.equal(isOffCanonicalHost("berth.club:3000"), false, "a port doesn't change the host")

// The platform hostname and anything else — must not be indexed.
assert.equal(
  isOffCanonicalHost("bridgedotclub-web-production.up.railway.app"),
  true,
  "the Railway host is off-canonical"
)
assert.equal(isOffCanonicalHost("localhost"), true, "localhost is off-canonical")
assert.equal(isOffCanonicalHost("evil.berth.club.attacker.test"), true, "suffix lookalikes don't pass")
assert.equal(isOffCanonicalHost("notberth.club"), true, "prefix lookalikes don't pass")

// Fail open: no readable host must never disallow crawling.
for (const empty of [null, undefined, "", "   ", ":443"]) {
  assert.equal(isOffCanonicalHost(empty), false, `fails open for ${JSON.stringify(empty)}`)
}

console.log("canonical-host.check.ts: all assertions passed")
