import assert from "node:assert/strict"

import { makeFomoReader, type FomoRow } from "./fomo.js"
import { judgeItem, parseJudge, SCREENED_VENUES } from "../scoring/judge.js"
import type { ModelClient } from "../scoring/model.js"
import type { ReaderContext } from "./types.js"

/**
 * The FOMO venue, against a fake archive rather than a real one.
 *
 * Everything here is a way a callout could be paid to the wrong person or not
 * paid at all, and none of it is reachable by pointing the reader at a live
 * database.
 *
 *   pnpm --filter agent check:fomo
 */

const COIN = "0x00000000000000000000000000000000000000aa"
const TOKEN = "0xdd3b11ef34cd511a2da159034a05fcb94d806686"
const WINDOW = {
  start: new Date("2026-09-07T00:00:00Z"),
  end: new Date("2026-09-14T00:00:00Z"),
}

let n = 0
function row(over: Partial<FomoRow> = {}): FomoRow {
  n++
  return {
    event_id: `ev_${n}`,
    created_at: new Date("2026-09-09T12:00:00Z"),
    username: `caller${n}`,
    subject: `user-${n}`,
    text: "This token is mispriced, the vault pays weekly and nobody has noticed.",
    token_address: TOKEN,
    network_id: 1,
    evm_address: "0x1febe335f384cfab68e98397b526825eb6533022",
    num_likes: 7,
    position_usd: "1250.500000",
    sold_at: null,
    ...over,
  }
}

function ctx(over: Partial<ReaderContext> = {}): ReaderContext {
  return {
    coin: COIN,
    window: WINDOW,
    sources: { fomo: [{ tokenAddress: TOKEN, name: "BERTH" }] },
    cap: 100,
    ...over,
  }
}

/** An archive that returns what it is given, and records how it was asked. */
function fakeArchive(rows: FomoRow[]) {
  const asked: Array<{ tokens: readonly string[]; coin: string; start: Date; end: Date }> = []
  return {
    asked,
    query: async (args: { tokens: readonly string[]; coin: string; start: Date; end: Date }) => {
      asked.push(args)
      return rows
    },
  }
}

async function main() {
  /* ── the ordinary read ──────────────────────────────────────────────────── */

  {
    const a = fakeArchive([row(), row(), row()])
    const res = await makeFomoReader({ query: a.query })(ctx())
    assert.equal(res.status, "ok")
    assert.equal(res.items.length, 3)
    assert.ok(res.items.every((i) => i.platform === "fomo"))
    assert.match(res.items[0]!.link!, /fomo\.family\/profile\//)
  }

  /* ── the window is the archive's job, and it must be asked correctly ────── */

  {
    const a = fakeArchive([])
    await makeFomoReader({ query: a.query })(ctx())
    assert.equal(a.asked.length, 1, "one query per read, not one per callout")
    assert.equal(a.asked[0]!.start.toISOString(), WINDOW.start.toISOString())
    assert.equal(a.asked[0]!.end.toISOString(), WINDOW.end.toISOString())
    assert.deepEqual(a.asked[0]!.tokens, [TOKEN], "lowercased, because the column is too")
  }

  {
    // A mixed-case address in the rules must still match a lowercased column.
    const a = fakeArchive([])
    await makeFomoReader({ query: a.query })(
      ctx({ sources: { fomo: [{ tokenAddress: "0xDD3B11EF34CD511A2DA159034A05FCB94D806686" }] } })
    )
    assert.deepEqual(a.asked[0]!.tokens, [TOKEN], "or a real week would look empty")
  }

  {
    // A Solana address is case-sensitive base58. Lowercasing is only safe here
    // because the column is lowercased too; the check pins that both sides
    // move together, since matching one side only looks like a quiet week.
    const SOL = "Ab1sTFNv2tV5DX1XpriwNehXgiJhdq2RQ5LtD5BXpump"
    const a = fakeArchive([])
    await makeFomoReader({ query: a.query })(
      ctx({ sources: { fomo: [{ tokenAddress: SOL, networkId: 1399811149 }] } })
    )
    assert.deepEqual(a.asked[0]!.tokens, [SOL.toLowerCase()])
  }

  /* ── the signals the scorer cannot get from the text ─────────────────────── */

{
  const a = fakeArchive([row()])
  const [item] = (await makeFomoReader({ query: a.query })(ctx())).items
  const m = item!.meta as Record<string, unknown>
  assert.equal(m.numLikes, 7)
  assert.equal(m.positionUsd, 1250.5, "numeric comes back a string and must become a number")
  assert.equal(m.soldAt, null, "null means asked and still holding")
}

{
  // Sold. The sharpest signal in the feed: 207 of 298 callout authors on a live
  // token had already closed their position, so this is the common case.
  const sold = new Date("2026-09-12T16:38:08.700Z")
  const a = fakeArchive([row({ sold_at: sold })])
  const [item] = (await makeFomoReader({ query: a.query })(ctx())).items
  assert.equal((item!.meta as Record<string, unknown>).soldAt, sold.toISOString())
}

/* ── the wallet FOMO holds, which is the only way a callout gets paid ───── */

  {
    const a = fakeArchive([row()])
    const [item] = (await makeFomoReader({ query: a.query })(ctx())).items
    assert.equal(
      item!.platformWallet,
      "0x1febe335f384cfab68e98397b526825eb6533022",
      "carried through, or a scored callout pays nobody"
    )
  }

  {
    // An author the reader has not looked up yet. The callout still counts: a
    // pending lookup is not a contribution that did not happen, and dropping it
    // here would lose it for good once the week's window closes.
    const a = fakeArchive([row({ evm_address: null })])
    const res = await makeFomoReader({ query: a.query })(ctx())
    assert.equal(res.items.length, 1, "kept on the record")
    assert.equal(res.items[0]!.platformWallet, undefined, "with nothing to pay yet")
  }

  /* ── the author is the immutable id, because handles get renamed ────────── */

  {
    const a = fakeArchive([row({ subject: "user-abc", username: "someone" })])
    const [item] = (await makeFomoReader({ query: a.query })(ctx())).items
    assert.equal(item!.platformUserId, "user-abc", "keyed on the id")
    assert.equal(item!.platformHandle, "someone", "the handle is carried for display only")
  }

  {
    // The bot's feed returns anonymous aggregates until its account follows
    // people. Rows with no author id cannot be paid and must be reported, not
    // swallowed, because the fix is to follow the list rather than to retry.
    const a = fakeArchive([row(), row({ subject: null }), row({ subject: null })])
    const res = await makeFomoReader({ query: a.query })(ctx())
    assert.equal(res.items.length, 1)
    assert.equal(res.status, "partial")
    assert.match(res.reason!, /no author id/)
  }

  /* ── one person cannot flood the venue ───────────────────────────────────── */

  {
    const spammer = () => row({ subject: "flooder", username: "flooder" })
    const a = fakeArchive([...Array.from({ length: 12 }, spammer), row({ subject: "honest" })])
    const res = await makeFomoReader({ query: a.query })(ctx())
    const byFlooder = res.items.filter((i) => i.platformUserId === "flooder")
    assert.equal(byFlooder.length, 5, "capped per author, because a callout costs nothing")
    assert.ok(
      res.items.some((i) => i.platformUserId === "honest"),
      "and the cap must not starve everyone behind them"
    )
    assert.match(res.reason!, /per author cap/)
  }

  /* ── what is not a callout ──────────────────────────────────────────────── */

  {
    const a = fakeArchive([
      row({ text: null }),
      row({ text: "   " }),
      row({ created_at: null }),
      row({ text: "a real thesis about the token" }),
    ])
    const res = await makeFomoReader({ query: a.query })(ctx())
    assert.equal(res.items.length, 1, "empty text and undated rows are not work")
  }

  /* ── the archive is another service, and its failures are named ─────────── */

  {
    const failing = async () => {
      throw new Error('column "raw" does not exist')
    }
    const res = await makeFomoReader({ query: failing })(ctx())
    assert.equal(res.status, "failed", "a schema change blocks the week rather than paying short")
    assert.match(res.reason!, /schema changed/, "and says so, because the fix is a conversation")
  }

  {
    const res = await makeFomoReader({})(ctx())
    assert.equal(res.status, "failed")
    assert.match(
      res.reason!,
      /not readable/,
      "no database handle is a venue failure, not a crash"
    )
  }

  {
    const a = fakeArchive([row()])
    const res = await makeFomoReader({ query: a.query })(ctx({ sources: {} }))
    assert.equal(res.status, "ok", "a coin naming no tokens is not an error")
    assert.equal(res.items.length, 0)
  }

  /* ── the judge, which GitHub does not need and FOMO does ────────────────── */

  assert.ok(SCREENED_VENUES.has("fomo"))
  assert.ok(!SCREENED_VENUES.has("github"), "a merged pull request was already filtered by a human")

  const judge = (raw: string): ModelClient => ({
    modelId: "test",
    async complete() {
      return { raw }
    },
  })

  {
    const v = await judgeItem(
      { content: "real thesis" },
      { client: judge(JSON.stringify({ counts: false, reason: "Ticker spam with no claim." })) }
    )
    assert.equal(v.counts, false)
    assert.match(v.reason, /Ticker spam/)
  }

  {
    // The judge failing must never zero honest work. It is a filter on obvious
    // noise, not an authority, so a reply it cannot read passes the item
    // through to the scorer to be judged on its merits.
    for (const bad of ["not json", "{}", '{"counts":"yes"}', ""]) {
      assert.equal(parseJudge(bad).counts, true, `"${bad}" must pass through, not fail closed`)
    }
  }

  {
    const v = parseJudge(JSON.stringify({ counts: false, reason: "x".repeat(400) }))
    assert.ok(v.reason.length <= 200, "a reason is a sentence, not an essay")
  }

  {
    const v = parseJudge('```json\n{"counts":true,"reason":"A real take."}\n```')
    assert.equal(v.counts, true, "the envelope is forgiven, the shape is not")
  }

  console.log("fomo check passed")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
