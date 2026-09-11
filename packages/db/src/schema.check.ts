import assert from "node:assert/strict"

import { and, eq, sql } from "drizzle-orm"

import { makeDb } from "./client.js"
import {
  hmBindings,
  hmChallenges,
  hmEpochs,
  hmItems,
  hmJobs,
  hmLeaves,
  hmScores,
  hmTrees,
  hmUsers,
  TABLE_NAMES,
} from "./schema.js"

/**
 * Proves the rules that live in the database rather than in code.
 *
 * Every assertion here is one the application is allowed to rely on: if a
 * uniqueness rule or a freeze trigger stops holding, the code above it is
 * already written as though it does, and the failure would show up as a double
 * payout or an edited history rather than as an error. So they are checked
 * against a real Postgres, not mocked.
 *
 *   DATABASE_URL=postgres://…/throwaway pnpm --filter @workspace/db db:check
 *
 * It TRUNCATEs every table it touches. Point it at a scratch database.
 */

const COIN = "0x00000000000000000000000000000000000000aa"
const W1 = "0x1111111111111111111111111111111111111111"
const W2 = "0x2222222222222222222222222222222222222222"

const db = makeDb(process.env.DATABASE_URL)
if (!db) {
  console.error("DATABASE_URL is not set. Point it at a throwaway database.")
  process.exit(1)
}

async function rejects(what: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch {
    return
  }
  throw new Error(`expected the database to reject: ${what}`)
}

async function main() {
  await db!.execute(
    sql.raw(`truncate ${TABLE_NAMES.filter((t) => t.startsWith("hm_")).join(", ")} cascade`)
  )

  /* ── a wallet is pinned once, and only in one shape ───────────────────── */

  await db!.insert(hmUsers).values({ did: "did:privy:a", wallet: W1 })
  await rejects("a second DID claiming the same wallet", () =>
    db!.insert(hmUsers).values({ did: "did:privy:b", wallet: W1 })
  )
  await rejects("a checksummed wallet", () =>
    db!.insert(hmUsers).values({ did: "did:privy:c", wallet: W1.toUpperCase() })
  )

  /* ── one account binds to one wallet, in both directions ──────────────── */

  await db!.insert(hmBindings).values({ platform: "github", subject: "583231", wallet: W1 })
  await rejects("the same GitHub account bound to a second wallet", () =>
    db!.insert(hmBindings).values({ platform: "github", subject: "583231", wallet: W2 })
  )
  await rejects("a second GitHub account on the same wallet", () =>
    db!.insert(hmBindings).values({ platform: "github", subject: "999999", wallet: W1 })
  )
  // A different platform on the same wallet is the whole point of binding.
  await db!.insert(hmBindings).values({ platform: "fomo", subject: "fomo-1", wallet: W1 })

  /* ── the job queue's identity is (type, coin, epoch, key) ─────────────── */

  await db!.insert(hmJobs).values({ type: "lane_read", coin: COIN, epoch: 1, key: "github", status: "pending" })
  // The reason `key` exists: one lane_read per lane, not one per epoch.
  await db!.insert(hmJobs).values({ type: "lane_read", coin: COIN, epoch: 1, key: "fomo", status: "pending" })
  await rejects("a duplicate job", () =>
    db!.insert(hmJobs).values({ type: "lane_read", coin: COIN, epoch: 1, key: "github", status: "pending" })
  )
  await rejects("an unknown job status", () =>
    db!.insert(hmJobs).values({ type: "publish", coin: COIN, epoch: 1, status: "elsewhere" })
  )

  /* ── an epoch's state is from a closed set ────────────────────────────── */

  await db!.insert(hmEpochs).values({ coin: COIN, epoch: 1, state: "collecting" })
  await rejects("an invented epoch state", () =>
    db!.insert(hmEpochs).values({ coin: COIN, epoch: 2, state: "vibes" })
  )

  /* ── one score per item per round, and rounds stop at 1 ───────────────── */

  const [item] = await db!
    .insert(hmItems)
    .values({
      coin: COIN,
      epoch: 1,
      lane: "github",
      platform: "github",
      platformUserId: "583231",
      externalId: "PR_1",
      status: "pending",
      createdAt: new Date(),
    })
    .returning({ id: hmItems.id })

  await db!.insert(hmScores).values({ itemId: item!.id, round: 0, median: 80, reason: "core fix", status: "scored" })
  await rejects("a second verdict for the same round", () =>
    db!.insert(hmScores).values({ itemId: item!.id, round: 0, median: 10, reason: "again", status: "scored" })
  )
  await rejects("a third round", () =>
    db!.insert(hmScores).values({ itemId: item!.id, round: 2, median: 10, reason: "x", status: "scored" })
  )
  await rejects("a score above 100", () =>
    db!.insert(hmScores).values({ itemId: item!.id, round: 1, median: 101, reason: "x", status: "scored" })
  )
  // Round 1 is the rescore, and it does not overwrite round 0.
  await db!.insert(hmScores).values({ itemId: item!.id, round: 1, median: 0, reason: "pulled", status: "pulled" })
  const rounds = await db!.select().from(hmScores).where(eq(hmScores.itemId, item!.id))
  assert.equal(rounds.length, 2, "both rounds survive, so the record shows what changed")

  /* ── an item is carried into a later epoch at most once ───────────────── */

  await db!.insert(hmEpochs).values({ coin: COIN, epoch: 2, state: "collecting" })
  await db!.insert(hmItems).values({
    coin: COIN, epoch: 2, lane: "github", platform: "github", platformUserId: "583231",
    externalId: "PR_1", status: "pending", originItemId: item!.id, createdAt: new Date(),
  })
  await db!.insert(hmEpochs).values({ coin: COIN, epoch: 3, state: "collecting" })
  await rejects("carrying the same item a second time", () =>
    db!.insert(hmItems).values({
      coin: COIN, epoch: 3, lane: "github", platform: "github", platformUserId: "583231",
      externalId: "PR_1", status: "pending", originItemId: item!.id, createdAt: new Date(),
    })
  )

  /* ── a leaf that pays nothing is a claim that reverts ─────────────────── */

  await db!.insert(hmTrees).values({
    coin: COIN, epoch: 1, root: "0xroot1", dump: {}, coinTotal: "1000", usdcTotal: "0",
  })
  await rejects("a leaf paying zero of both", () =>
    db!.insert(hmLeaves).values({
      coin: COIN, epoch: 1, wallet: W1, coinAmount: "0", usdcAmount: "0", leafIndex: 0,
    })
  )
  await db!.insert(hmLeaves).values({
    coin: COIN, epoch: 1, wallet: W1, coinAmount: "1000", usdcAmount: "0", leafIndex: 0,
  })
  await rejects("two leaves for the same wallet in one epoch", () =>
    db!.insert(hmLeaves).values({
      coin: COIN, epoch: 1, wallet: W1, coinAmount: "5", usdcAmount: "0", leafIndex: 1,
    })
  )

  // A uint256 has 78 digits. This is the number bigint could not hold.
  const huge = "115792089237316195423570985008687907853269984665640564039457584007913129639935"
  await db!.insert(hmLeaves).values({
    coin: COIN, epoch: 1, wallet: W2, coinAmount: huge, usdcAmount: "0", leafIndex: 1,
  })
  const [big] = await db!
    .select({ amount: hmLeaves.coinAmount })
    .from(hmLeaves)
    .where(and(eq(hmLeaves.coin, COIN), eq(hmLeaves.wallet, W2)))
  assert.equal(big!.amount, huge, "a full uint256 survives the round trip")

  /* ── once paid, the record is frozen, except the erasable text ────────── */

  await db!.update(hmEpochs).set({ postedAt: new Date() })
    .where(and(eq(hmEpochs.coin, COIN), eq(hmEpochs.epoch, 1)))

  await rejects("editing a paid epoch's leaf", () =>
    db!.update(hmLeaves).set({ coinAmount: "999999" })
      .where(and(eq(hmLeaves.coin, COIN), eq(hmLeaves.epoch, 1), eq(hmLeaves.wallet, W1)))
  )
  await rejects("editing a paid epoch's tree", () =>
    db!.update(hmTrees).set({ root: "0xdifferent" })
      .where(and(eq(hmTrees.coin, COIN), eq(hmTrees.epoch, 1)))
  )
  await rejects("editing a paid epoch's score", () =>
    db!.update(hmScores).set({ median: 5 }).where(eq(hmScores.itemId, item!.id))
  )
  await rejects("deleting a paid epoch's leaf", () =>
    db!.delete(hmLeaves).where(and(eq(hmLeaves.coin, COIN), eq(hmLeaves.epoch, 1)))
  )

  // The carve-out: a takedown must still work on a paid epoch.
  await db!.update(hmItems).set({ content: null, contentRemovedAt: new Date() })
    .where(eq(hmItems.id, item!.id))
  const [scrubbed] = await db!.select().from(hmItems).where(eq(hmItems.id, item!.id))
  assert.equal(scrubbed!.content, null, "content is erasable after payout")
  assert.ok(scrubbed!.contentRemovedAt, "and the erasure is recorded")

  await rejects("renaming a paid epoch's item under cover of a takedown", () =>
    db!.update(hmItems).set({ platformUserId: "someone-else" }).where(eq(hmItems.id, item!.id))
  )

  // The other carve-out: a rescore in flight at the deadline still records.
  const [ch] = await db!
    .insert(hmChallenges)
    .values({ itemId: item!.id, coin: COIN, epoch: 2, wallet: W2, body: "evidence", status: "open" })
    .returning({ id: hmChallenges.id })
  await db!.update(hmEpochs).set({ postedAt: new Date() })
    .where(and(eq(hmEpochs.coin, COIN), eq(hmEpochs.epoch, 2)))
  await db!.update(hmChallenges)
    .set({ status: "answered_after_settlement", verdictReason: "too late", answeredAt: new Date() })
    .where(eq(hmChallenges.id, ch!.id))
  await rejects("moving a challenge to another wallet after payout", () =>
    db!.update(hmChallenges).set({ wallet: W1 }).where(eq(hmChallenges.id, ch!.id))
  )

  /* ── one open dispute per wallet per line, but not one forever ────────── */

  await db!.insert(hmEpochs).values({ coin: COIN, epoch: 4, state: "published" })
  const [item4] = await db!
    .insert(hmItems)
    .values({
      coin: COIN, epoch: 4, lane: "github", platform: "github", platformUserId: "583231",
      externalId: "PR_4", status: "pending", createdAt: new Date(),
    })
    .returning({ id: hmItems.id })

  await db!.insert(hmChallenges)
    .values({ itemId: item4!.id, coin: COIN, epoch: 4, wallet: W2, body: "a", status: "open" })
  await rejects("a second open dispute from the same wallet on the same line", () =>
    db!.insert(hmChallenges)
      .values({ itemId: item4!.id, coin: COIN, epoch: 4, wallet: W2, body: "b", status: "open" })
  )
  // Once the first is answered, the same wallet may argue again.
  await db!.update(hmChallenges).set({ status: "rejected" })
    .where(and(eq(hmChallenges.itemId, item4!.id), eq(hmChallenges.wallet, W2)))
  await db!.insert(hmChallenges)
    .values({ itemId: item4!.id, coin: COIN, epoch: 4, wallet: W2, body: "c", status: "open" })

  console.log("schema check passed")
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
