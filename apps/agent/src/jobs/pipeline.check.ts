import assert from "node:assert/strict"

import {
  hmBindings,
  hmEpochs,
  hmItems,
  hmJobs,
  hmLeaves,
  hmRules,
  hmRuleVersions,
  hmScores,
  makeDb,
  TABLE_NAMES,
  assertThrowaway,
} from "@workspace/db"
import { and, eq, sql } from "drizzle-orm"

import { epochBounds, lastClosedEpoch } from "../clock.js"
import type { ModelClient } from "../scoring/model.js"
import { epochStart } from "./epochStart.js"
import { laneRead } from "./laneRead.js"
import { makePublish } from "./publish.js"
import { makeScoreBatch } from "./scoreBatch.js"
import { runLoop } from "./loop.js"
import type { JobContext } from "./types.js"

/**
 * A whole week, from an empty database to a payout list, through the real loop.
 *
 * GitHub and the model are fakes; everything between them is the code that runs
 * in production. The point is the joins and the ordering, which no unit check
 * can reach: that a week opens once, that the scorer waits for the lane, that
 * the publisher waits for the scorer, and that running the lot twice changes
 * nothing.
 *
 *   DATABASE_URL=postgres://…/throwaway pnpm --filter agent check:pipeline
 */

const COIN = "0x00000000000000000000000000000000000000aa"
const DEPLOYER = "0x00000000000000000000000000000000000000de"
const WALLET_A = "0x000000000000000000000000000000000000aaaa"
const WALLET_B = "0x000000000000000000000000000000000000bbbb"

assertThrowaway(process.env.DATABASE_URL)

const db = makeDb(process.env.DATABASE_URL)
if (!db) {
  console.error("DATABASE_URL is not set. Point it at a throwaway database.")
  process.exit(1)
}

const EPOCH = lastClosedEpoch()!
const { start } = epochBounds(EPOCH)
const MERGED_AT = new Date(start.getTime() + 3600_000).toISOString()

let prId = 0
function pull(login: string, userId: number, title: string, body = "does a thing") {
  prId++
  return {
    number: prId,
    node_id: `PR_${prId}`,
    title,
    body,
    html_url: `https://github.com/acme/app/pull/${prId}`,
    merged_at: MERGED_AT,
    updated_at: MERGED_AT,
    user: { id: userId, login },
  }
}

function serveGithub(pages: unknown[][]) {
  return (async (url: string) => {
    const page = Number(/[?&]page=(\d+)/.exec(String(url))?.[1] ?? 1)
    return Response.json(pages[page - 1] ?? [])
  }) as unknown as typeof fetch
}

function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const saved = globalThis.fetch
  globalThis.fetch = impl
  return fn().finally(() => {
    globalThis.fetch = saved
  })
}

/** Scores by a keyword in the title, so the expected numbers are predictable. */
function scoringModel(): ModelClient & { calls: number } {
  const self = {
    modelId: "test-model",
    calls: 0,
    async complete(prompt: string) {
      self.calls++
      const score = prompt.includes("MAJOR") ? 80 : prompt.includes("TYPO") ? 10 : 50
      return {
        raw: JSON.stringify({
          score,
          reason: `scored ${score} because of what the change did`,
          cited: [/Item id: (\d+)/.exec(prompt)?.[1] ?? ""],
        }),
        requestId: `req_${self.calls}`,
      }
    },
  }
  return self
}

async function reset() {
  await db!.execute(
    sql.raw(`truncate ${TABLE_NAMES.filter((t) => t.startsWith("hm_")).join(", ")} cascade`)
  )
}

async function seedCoin() {
  const [v] = await db!
    .insert(hmRuleVersions)
    .values({
      coin: COIN,
      versionNo: 1,
      body: "Merged pull requests count. Typos count for very little.",
      sources: { github: [{ repoId: 10, name: "acme/app" }] },
      effectiveFromEpoch: EPOCH,
      confirmedAt: new Date(),
    })
    .returning({ id: hmRuleVersions.id })
  await db!.insert(hmRules).values({ coin: COIN, deployer: DEPLOYER, currentVersionId: v!.id })
  return v!.id
}

const ctxFor = (type: string, key = "", id = 1n): JobContext => ({
  db: db!,
  workerId: "pipeline",
  job: { id, type, coin: COIN, epoch: EPOCH, key, attempts: 0, payload: null },
})

async function main() {
  assert.ok(process.env.GITHUB_TOKEN, "run this through `pnpm --filter agent check:pipeline`")

  /* ── a week opens, once, and queues its own work ────────────────────────── */

  await reset()
  await seedCoin()

  await epochStart(ctxFor("epoch_start"))
  const [opened] = await db!
    .select()
    .from(hmEpochs)
    .where(and(eq(hmEpochs.coin, COIN), eq(hmEpochs.epoch, EPOCH)))
  assert.ok(opened, "the closed week is opened")
  assert.equal(opened!.state, "reads_pending")
  assert.ok(opened!.rulesVersionId, "with the rules frozen onto it")
  assert.equal(
    opened!.windowStart!.toISOString(),
    epochBounds(EPOCH).start.toISOString(),
    "and the window frozen, so a rerun reads the same week"
  )

  const queued = await db!.select().from(hmJobs).where(eq(hmJobs.coin, COIN))
  assert.deepEqual(
    queued.map((j) => j.type).sort(),
    ["lane_read", "publish", "score_batch"],
    "the whole week's work is queued at once; each job waits on its own preconditions"
  )

  // The timer fires more than once a week on purpose. It must no-op.
  await epochStart(ctxFor("epoch_start"))
  assert.equal(
    (await db!.select().from(hmJobs).where(eq(hmJobs.coin, COIN))).length,
    3,
    "a second tick queues nothing and opens nothing twice"
  )

  /* ── the scorer refuses to run before the lane has reported ─────────────── */

  const model = scoringModel()
  const scoreBatch = makeScoreBatch({ makeClient: () => model })

  const early = await scoreBatch(ctxFor("score_batch"))
  assert.equal(early.kind, "wait", "scoring a week whose lane has not reported would invent a list")
  assert.equal(model.calls, 0, "and it costs nothing to refuse")

  /* ── the lane reads, the scorer scores, the publisher publishes ─────────── */

  // One fixed payload, reused by the rerun below. Generating fresh pull
  // requests there would prove nothing about idempotency: they would be new
  // work, and scoring them again would be correct.
  const WEEK = [
    pull("alice", 1001, "MAJOR: rewrite the fee engine"),
    pull("alice", 1001, "fix a rounding bug"),
    pull("bob", 1002, "TYPO: fix a comment"),
  ]

  await withFetch(serveGithub([WEEK]), async () => {
    const out = await laneRead(ctxFor("lane_read", "github"))
    assert.equal(out.kind, "done")
  })
  assert.equal((await db!.select().from(hmItems).where(eq(hmItems.coin, COIN))).length, 3)

  const scored = await scoreBatch(ctxFor("score_batch"))
  assert.equal(scored.kind, "done", JSON.stringify(scored))
  const scores = await db!
    .select({ median: hmScores.median, status: hmScores.status, reason: hmScores.reason })
    .from(hmScores)
  assert.equal(scores.length, 3, "every item is judged")
  assert.deepEqual(scores.map((s) => s.median).sort((a, b) => a - b), [10, 50, 80])
  assert.ok(scores.every((s) => s.reason.length > 0), "and every score carries a reason")
  assert.ok(scores.every((s) => s.status === "scored"))

  const [frozen] = await db!
    .select()
    .from(hmEpochs)
    .where(and(eq(hmEpochs.coin, COIN), eq(hmEpochs.epoch, EPOCH)))
  assert.ok(frozen!.promptHash, "the prompt is pinned to the epoch")
  assert.equal(frozen!.modelId, "test-model", "and so is the model")

  /* ── an author with no wallet is judged but not paid ────────────────────── */

  const publish = makePublish({ pot: { async potFor() { return { coin: 1000n, usdc: 140n } } } })
  await publish(ctxFor("publish"))

  let leaves = await db!.select().from(hmLeaves).where(eq(hmLeaves.coin, COIN))
  assert.equal(leaves.length, 0, "nobody has bound a wallet, so nobody is owed anything yet")
  const [afterFirst] = await db!
    .select()
    .from(hmEpochs)
    .where(and(eq(hmEpochs.coin, COIN), eq(hmEpochs.epoch, EPOCH)))
  assert.equal(afterFirst!.state, "published", "the week still publishes, as an empty list")
  assert.ok(afterFirst!.clockEnd, "and the dispute clock starts")

  /* ── once wallets are bound, the same week pays them ────────────────────── */

  await db!.delete(hmEpochs).where(eq(hmEpochs.coin, COIN))
  await db!.insert(hmEpochs).values({
    coin: COIN, epoch: EPOCH, state: "scoring", rulesVersionId: frozen!.rulesVersionId,
    promptHash: frozen!.promptHash, modelId: frozen!.modelId,
    windowStart: frozen!.windowStart, windowEnd: frozen!.windowEnd,
  })
  await db!.insert(hmBindings).values([
    { platform: "github", subject: "1001", handle: "alice", wallet: WALLET_A },
    { platform: "github", subject: "1002", handle: "bob", wallet: WALLET_B },
  ])

  await publish(ctxFor("publish"))
  leaves = await db!.select().from(hmLeaves).where(eq(hmLeaves.coin, COIN))

  const byWallet = new Map(leaves.map((l) => [l.wallet, l]))
  assert.equal(leaves.length, 2)
  // alice scored 80 + 50 = 130, bob scored 10, of 140 total. Neither divides
  // 1000 evenly: the floors are 928 and 71, and the leftover unit goes to the
  // larger remainder, which is alice's.
  assert.equal(byWallet.get(WALLET_A)!.coinAmount, "929", "alice's share of 1000 is 130/140")
  assert.equal(byWallet.get(WALLET_B)!.coinAmount, "71", "bob's is 10/140")
  assert.equal(
    BigInt(byWallet.get(WALLET_A)!.coinAmount) + BigInt(byWallet.get(WALLET_B)!.coinAmount),
    1000n,
    "and the pot is paid out to the last unit"
  )
  assert.equal(byWallet.get(WALLET_A)!.usdcAmount, "130", "the USDC pot splits on the same scores")
  assert.equal(byWallet.get(WALLET_B)!.usdcAmount, "10")
  assert.deepEqual(
    leaves.map((l) => l.leafIndex).sort((a, b) => a - b),
    [0, 1],
    "leaf indexes are dense, which the tree depends on"
  )

  /* ── running the whole thing again changes nothing ──────────────────────── */

  const callsBefore = model.calls
  await withFetch(serveGithub([WEEK]), async () => {
    await laneRead(ctxFor("lane_read", "github"))
  })
  await scoreBatch(ctxFor("score_batch"))
  assert.equal(model.calls, callsBefore, "already-scored items are never paid for twice")
  assert.equal(
    (await db!.select().from(hmScores)).length,
    3,
    "and no second verdict is written for an item that already has one"
  )

  /* ── the real loop claims and runs these types end to end ───────────────── */

  await reset()
  await seedCoin()
  await db!.insert(hmBindings).values([
    { platform: "github", subject: "1001", handle: "alice", wallet: WALLET_A },
    { platform: "github", subject: "1002", handle: "bob", wallet: WALLET_B },
  ])
  await db!
    .insert(hmJobs)
    .values({ type: "epoch_start", coin: COIN, epoch: EPOCH, key: "", status: "pending" })

  const controller = new AbortController()
  await withFetch(
    serveGithub([[pull("alice", 1001, "MAJOR: a real feature"), pull("bob", 1002, "TYPO: a comma")]]),
    async () => {
      const loop = runLoop({
        db: db!,
        handlers: {
          epoch_start: epochStart,
          lane_read: laneRead,
          score_batch: makeScoreBatch({ makeClient: () => scoringModel() }),
          publish: makePublish({ pot: { async potFor() { return { coin: 500n, usdc: 0n } } } }),
        },
        leaseSeconds: {},
        workerId: "pipeline-loop",
        pollSeconds: 1,
        signal: controller.signal,
        log: () => {},
      })
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250))
        const done = await db!
          .select()
          .from(hmEpochs)
          .where(and(eq(hmEpochs.coin, COIN), eq(hmEpochs.state, "published")))
        if (done.length > 0) break
      }
      controller.abort()
      await loop.catch(() => {})
    }
  )

  const [end] = await db!.select().from(hmEpochs).where(eq(hmEpochs.coin, COIN))
  assert.equal(end!.state, "published", "the loop drove the week all the way to a published list")
  const finalLeaves = await db!.select().from(hmLeaves).where(eq(hmLeaves.coin, COIN))
  assert.equal(finalLeaves.length, 2, "with a leaf for each bound author")
  assert.equal(
    finalLeaves.reduce((s, l) => s + BigInt(l.coinAmount), 0n),
    500n,
    "and the pot fully allocated"
  )
  const failedJobs = await db!.select().from(hmJobs).where(eq(hmJobs.status, "failed"))
  assert.equal(failedJobs.length, 0, "no job failed on the way")

  console.log("pipeline check passed")
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
