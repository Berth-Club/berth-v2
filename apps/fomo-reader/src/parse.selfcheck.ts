import assert from "node:assert/strict"

import {
  nextCursor,
  normalise,
  pageUrl,
  parseItems,
  reachedBack,
  timestampOf,
  type ThesisItem,
} from "./parse.js"

/**
 * The feed's two undocumented behaviours, pinned so they cannot regress.
 *
 * No browser, no session, no network.
 *
 *   pnpm --filter fomo-reader check:parse
 */

const TOKEN = {
  networkId: 1399811149,
  tokenAddress: "Ab1sTFNv2tV5DX1XpriwNehXgiJhdq2RQ5LtD5BXpump",
  coin: "0xcoin",
}

const at = (iso: string, over: Partial<ThesisItem> = {}): ThesisItem => ({
  id: `id-${iso}`,
  createdAt: iso,
  userId: "u1",
  userHandle: "someone",
  comment: { comment: "a real thesis about this token" },
  ...over,
})

/* ── the window is a PAIR, in milliseconds, as the app itself sends ───────── */

{
  const u = pageUrl(TOKEN, 1_789_100_000_000, 1_789_161_900_000)
  assert.match(u, /afterTime=1789100000000\b/, "milliseconds, thirteen digits")
  assert.match(u, /beforeTime=1789161900000\b/, "and both bounds, or the feed is unpredictable")
}

{
  // A float is not rejected, it just returns nothing, so it is floored first.
  const u = pageUrl(TOKEN, 1_789_100_000_000.9, 1_789_161_900_000.4)
  assert.match(u, /afterTime=1789100000000\b/)
  assert.match(u, /beforeTime=1789161900000\b/)
}

{
  // Observed live on 2026-09-12: with `threshold` omitted the feed answered
  // `count: 586, items: []` for a token 586 people had written about. Sending
  // zero returned all 586. A silent token and a filtered one look identical.
  const u = pageUrl(TOKEN, 1, 2)
  assert.match(u, /[?&]threshold=0\b/, "threshold=0, or the feed hides most rows")
}

{
  // Solana addresses are case-sensitive base58. Lowercasing one produces a
  // different, invalid address, so the URL must carry it exactly as written.
  assert.ok(
    pageUrl(TOKEN, 1, 2).includes("Ab1sTFNv2tV5DX1XpriwNehXgiJhdq2RQ5LtD5BXpump"),
    "case preserved"
  )
}

/* ── the three signals the feed actually populates ───────────────────────── */

{
  const t = normalise(
    at("2026-09-12T10:00:00.000Z", {
      comment: { comment: "a real thesis", numLikes: 74 },
      authorTrade: { usdValue: 23911.399568561388, closedAt: "2026-09-12T16:38:08.700Z" },
    })
  )!
  assert.equal(t.numLikes, 74)
  assert.equal(t.positionUsd, 23911.399568561388)
  assert.equal(t.soldAt?.toISOString(), "2026-09-12T16:38:08.700Z")
}

{
  // Still holding. Null, not a date, and not zero either: "has not sold" and
  // "sold at the epoch" must not collapse into the same value.
  const t = normalise(
    at("2026-09-12T10:00:00.000Z", {
      comment: { comment: "a real thesis", numLikes: 0 },
      authorTrade: { usdValue: 1.93, closedAt: null },
    })
  )!
  assert.equal(t.soldAt, null)
  assert.equal(t.numLikes, 0, "zero likes is a real answer, not a missing one")
}

{
  // Nothing reported. Null all round, and the callout still counts: a missing
  // signal must not delete a contribution that happened.
  const t = normalise(at("2026-09-12T10:00:00.000Z"))!
  assert.equal(t.numLikes, null)
  assert.equal(t.positionUsd, null)
  assert.equal(t.soldAt, null)
  assert.ok(t.externalId, "the callout survives")
}

/* ── only a thesis is work ───────────────────────────────────────────────── */

{
  // Every live row is a thesis today, so this is a guard rather than a filter
  // that fires. It exists because the feed carries a `type` and a day when it
  // starts returning trades or replies should read as nothing, not as payable.
  const iso = "2026-09-12T10:00:00.000Z"
  assert.equal(normalise(at(iso, { type: "thesis" }))?.externalId, `id-${iso}`)
  assert.equal(normalise(at(iso, { type: "swap" })), null)
  assert.equal(normalise(at(iso, { type: "reply" })), null)
  // Absent is not the same as wrong: a field that stops being sent must not
  // silently zero the venue.
  assert.equal(normalise(at(iso, { type: undefined }))?.externalId, `id-${iso}`)
}

/* ── the envelope, and the difference between empty and not understood ────── */

assert.deepEqual(parseItems({ responseObject: { items: [{ id: "1" }] } }), [{ id: "1" }])
assert.deepEqual(parseItems({ responseObject: { theses: [{ id: "2" }] } }), [{ id: "2" }])
assert.deepEqual(parseItems({ responseObject: [{ id: "3" }] }), [{ id: "3" }])
assert.deepEqual(parseItems({ items: [{ id: "4" }] }), [{ id: "4" }])

// The real response for a token with no recent theses: understood, and empty.
assert.deepEqual(
  parseItems({ success: true, responseObject: { items: [], hasNextPage: false, count: 510 } }),
  [],
  "an empty week is an empty list"
)

// Not understood is NULL, never []. Collapsing the two would turn a shape
// change into a token that silently stops paying.
assert.equal(parseItems({ responseObject: { wat: 1 } }), null)
assert.equal(parseItems({}), null)
assert.equal(parseItems(null), null)
assert.equal(parseItems("nope"), null)

/* ── paging backwards, and never repeating a page ─────────────────────────── */

{
  const page = [at("2026-08-24T01:45:12.297Z"), at("2026-08-22T18:52:10.078Z")]
  const c = nextCursor(page)!
  const oldestMs = timestampOf(page[1]!)! * 1000
  assert.ok(c < oldestMs, "strictly past the oldest row, or the bound is inclusive and loops")
  assert.equal(c, Math.floor(oldestMs) - 1, "one millisecond, not one second")
}

assert.equal(nextCursor([]), null, "nothing to advance on stops the loop")
assert.equal(nextCursor([at("not a date")]), null, "and so does an unparseable page")

{
  // The boundary is judged on the OLDEST row. A page straddling it still holds
  // rows we want, and stopping on the newest would drop them.
  const since = Date.parse("2026-08-23T00:00:00Z")
  const straddling = [at("2026-08-24T00:00:00Z"), at("2026-08-22T00:00:00Z")]
  assert.equal(reachedBack(straddling, since), true, "this page reached past the window")

  const allNewer = [at("2026-08-25T00:00:00Z"), at("2026-08-24T00:00:00Z")]
  assert.equal(reachedBack(allNewer, since), false, "this one has not, so keep paging")
}

/* ── what is worth storing ────────────────────────────────────────────────── */

{
  const n = normalise(at("2026-08-24T01:45:12.297Z", { id: "abc", userId: "u9" }))!
  assert.equal(n.externalId, "abc")
  assert.equal(n.subject, "u9", "the immutable id, because handles get renamed")
  assert.equal(n.handle, "someone", "carried for display only")
  assert.equal(n.text, "a real thesis about this token")
  assert.equal(n.createdAt.toISOString(), "2026-08-24T01:45:12.297Z")
}

// Anything that cannot be paid is dropped rather than stored, so a payout list
// never contains rows that could not pay anyone.
assert.equal(normalise(at("2026-08-24T00:00:00Z", { id: "" })), null, "no id")
assert.equal(normalise(at("2026-08-24T00:00:00Z", { userId: "" })), null, "no author")
assert.equal(normalise(at("2026-08-24T00:00:00Z", { comment: null })), null, "no text")
assert.equal(
  normalise(at("2026-08-24T00:00:00Z", { comment: { comment: "   " } })),
  null,
  "whitespace is not text"
)
assert.equal(normalise({ id: "x", userId: "u", comment: { comment: "t" } }), null, "no date")

{
  // A handle is optional; being unable to show a name must not cost a payout.
  const n = normalise(at("2026-08-24T00:00:00Z", { userHandle: undefined }))!
  assert.equal(n.handle, null)
  assert.equal(n.subject, "u1")
}

console.log("parse check passed")
