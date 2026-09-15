import assert from "node:assert/strict"

import { handleUrl, parseWallets, userUrl } from "./wallets.js"

/**
 * The wallet lookup, pinned to a real response.
 *
 * The envelope below is copied from a live call on 2026-09-12, against a user
 * picked out of the Maple feed. Everything here is pure, so it runs with no
 * browser, no session and no network.
 *
 *   pnpm --filter fomo-reader check:wallets
 */

const LIVE = {
  success: true,
  message: "User found",
  responseObject: {
    id: "72722279-f235-5398-a194-9a15ad09c074",
    address: "C6NtA1wBaW1EQ8aEmmVvjqP31cAFP9R39YDPXWbHihUa",
    evmAddress: "0x1febe335f384cfab68e98397b526825eb6533022",
    userHandle: "postrich",
    displayName: "postrich",
    verified: false,
    private: false,
  },
  statusCode: 200,
}

/* ── the URL is keyed on the id, because a handle is rented ──────────────── */

{
  const u = userUrl("72722279-f235-5398-a194-9a15ad09c074")
  assert.equal(u, "https://prod-api.fomo.family/v2/users/72722279-f235-5398-a194-9a15ad09c074")
  // FOMO lets people rename. A binding keyed on a name someone can change is a
  // binding someone else can inherit, so `/v2/users/userHandle/...` is not used
  // even though it returns the same record.
  assert.ok(!u.includes("userHandle"), "never the handle")
}

{
  // An id is data from someone else's system, so it is escaped rather than
  // trusted to be tidy.
  assert.ok(userUrl("a/b?c=d").endsWith("a%2Fb%3Fc%3Dd"))
}

/* ── a handle search is always lowercased ────────────────────────────────── */

{
  // FOMO stores handles lowercased: asked for `Wiredhikari` it answers
  // `userHandle: "wiredhikari"`. Lowercasing the search is what matches on the
  // first try whatever a person typed.
  assert.equal(
    handleUrl("Wiredhikari"),
    "https://prod-api.fomo.family/v2/users/userHandle/wiredhikari"
  )
  assert.equal(handleUrl("  WIREDHIKARI  "), handleUrl("wiredhikari"), "trimmed too")
  assert.equal(handleUrl("Wiredhikari"), handleUrl("wIrEdHiKaRi"), "any spelling, one URL")
}

{
  // The folding stops at handles. An id is matched exactly and a Solana address
  // is case-sensitive base58, so neither may be lowercased anywhere.
  const ID = "72722279-F235-5398-A194-9A15AD09C074"
  assert.ok(userUrl(ID).endsWith(ID), "an id goes out exactly as given")
}

/* ── the reply must be for the user we asked for ─────────────────────────── */

{
  // Real behaviour, seen on 2026-09-12: asking `/userHandle/Wiredhikari`
  // returned the account whose handle is `wiredhikari`. FOMO's matching is not
  // exact, so the identifier that comes back can differ from the one that went
  // out, and a lookup that trusted the reply would bind a stranger's wallet to
  // our author. Compared on the FULL id, character for character.
  const ID = "72722279-f235-5398-a194-9a15ad09c074"
  assert.equal(parseWallets(LIVE, ID)!.id, ID, "the right user passes")
  assert.equal(parseWallets(LIVE, "72722279-f235-5398-a194-9a15ad09c075"), null, "a near miss")
  assert.equal(parseWallets(LIVE, ID.toUpperCase()), null, "no case folding")
  assert.equal(parseWallets(LIVE, ID.slice(0, 8)), null, "a prefix is not a match")
  assert.equal(parseWallets(LIVE, ID + "x"), null, "nor is a longer string")
  // Handles are carried for display, in FOMO's spelling rather than ours,
  // because a handle is what gets renamed and an id is not.
  assert.equal(parseWallets(LIVE, ID)!.handle, "postrich")
}

/* ── both addresses, each with the casing its chain requires ─────────────── */

{
  const w = parseWallets(LIVE)!
  assert.equal(w.evmAddress, "0x1febe335f384cfab68e98397b526825eb6533022")
  // Base58 is case-SENSITIVE. Lowercasing a Solana address produces a
  // different, invalid address, so this one is stored exactly as returned.
  assert.equal(w.solAddress, "C6NtA1wBaW1EQ8aEmmVvjqP31cAFP9R39YDPXWbHihUa")
}

{
  // EVM hex is case-insensitive and the mixed-case form is only a checksum. One
  // canonical spelling, or the same wallet becomes two rows.
  const w = parseWallets({
    responseObject: { id: "u", evmAddress: "0x1FEBE335F384CFAB68E98397B526825EB6533022" },
  })!
  assert.equal(w.evmAddress, "0x1febe335f384cfab68e98397b526825eb6533022")
}

/* ── nothing is not the same as not understood ───────────────────────────── */

{
  // A real account with no EVM wallet. Answered, and the answer is none.
  const w = parseWallets({ responseObject: { id: "u", address: "SoLaNa", evmAddress: "" } })!
  assert.equal(w.evmAddress, null)
  assert.equal(w.solAddress, "SoLaNa")
}

{
  // Not a user record. Null so the caller retries instead of writing down
  // "this person has no wallet", which would be permanent and wrong.
  assert.equal(parseWallets(null), null)
  assert.equal(parseWallets("nope"), null)
  assert.equal(parseWallets({}), null, "no envelope")
  assert.equal(parseWallets({ responseObject: {} }), null, "no id, so not a user")
  assert.equal(
    parseWallets({ responseObject: { evmAddress: "0x1febe335f384cfab68e98397b526825eb6533022" } }),
    null,
    "an address with no id is some other shape that happened to parse"
  )
}

console.log("wallets check passed")
