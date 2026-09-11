import {
  hmBindings,
  hmEpochs,
  hmItems,
  hmJobs,
  hmLaneReads,
  hmLeaves,
  hmRules,
  hmRuleVersions,
  hmScores,
  makeDb,
  TABLE_NAMES,
  assertThrowaway,
} from "@workspace/db"
import { and, desc, eq, sql } from "drizzle-orm"

import { epochBounds, lastClosedEpoch } from "../clock.js"
import { env } from "../env.js"
import { runLoop } from "../jobs/loop.js"
import { epochStart } from "../jobs/epochStart.js"
import { laneRead } from "../jobs/laneRead.js"
import { makePublish } from "../jobs/publish.js"
import { makeScoreBatch } from "../jobs/scoreBatch.js"
import { pickClient, type ModelClient } from "../scoring/model.js"
import type { JobContext } from "../jobs/types.js"

/**
 * One real week, against a real repository, printed as a payout list.
 *
 * Not a test. This is the thing you run to see whether the week the agent would
 * have paid out looks like the week that actually happened. Everything is real
 * except the pot, which needs the vault contract, and the wallet bindings,
 * which are seeded here so the split has somewhere to land.
 *
 *   DATABASE_URL=… GITHUB_TOKEN=… pnpm --filter agent demo:week acme/app
 *
 * Set OPENROUTER_API_KEY, ANTHROPIC_API_KEY or DEEPSEEK_API_KEY to score with a
 * real model, HM_SCORER to pick between them, and HM_SCORER_MODEL to name the
 * model, e.g. `deepseek/deepseek-chat` through OpenRouter. With none of them, a
 * local stand-in scores on size alone and says so on every line, so nobody
 * mistakes the output for a judgement.
 *
 * HM_LANE_CAP keeps a first paid run small: HM_LANE_CAP=5 scores five items
 * rather than a whole week of a busy repository.
 */

const COIN = "0x00000000000000000000000000000000000000aa"
const DEPLOYER = "0x00000000000000000000000000000000000000de"
const COIN_POT = BigInt(process.env.HM_COIN_POT ?? "1000000000000000000000") // 1,000 tokens
const USDC_POT = BigInt(process.env.HM_USDC_POT ?? "500000000") // 500 USDC at 6dp

const repoArg = process.argv[2] ?? "vercel/next.js"

// Before anything is created or truncated.
assertThrowaway(process.env.DATABASE_URL)

const db = makeDb(process.env.DATABASE_URL)
if (!db) {
  console.error("DATABASE_URL is not set. Point it at a throwaway database.")
  process.exit(1)
}
if (!env.githubToken) {
  console.error("GITHUB_TOKEN is not set. Try: GITHUB_TOKEN=$(gh auth token)")
  process.exit(1)
}

/**
 * What the model would do, if there were a key.
 *
 * Deliberately crude and deliberately loud about it. A stand-in that quietly
 * produced plausible-looking numbers would be worse than no stand-in at all:
 * someone would screenshot it.
 */
function sizeScorer(): ModelClient {
  return {
    modelId: "no-model-size-only",
    async complete(prompt: string) {
      const body = /<contribution>([\s\S]*?)<\/contribution>/.exec(prompt)?.[1] ?? ""
      const id = /Item id: (\d+)/.exec(prompt)?.[1] ?? ""
      const score = Math.max(1, Math.min(100, Math.round(body.trim().length / 20)))
      return {
        raw: JSON.stringify({
          score,
          reason: `NOT A REAL JUDGEMENT: scored ${score} from description length alone, because no model key is set.`,
          cited: [id],
        }),
      }
    },
  }
}

async function resolveRepoId(nameWithOwner: string): Promise<number> {
  const res = await fetch(`https://api.github.com/repos/${nameWithOwner}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.githubToken}`,
      "user-agent": "berth-harbormaster",
    },
  })
  if (!res.ok) throw new Error(`cannot read ${nameWithOwner}: GitHub returned ${res.status}`)
  return ((await res.json()) as { id: number }).id
}

/** A job context for running a handler directly, outside the loop. */
function ctxFor(key = "", epoch = 0): JobContext {
  return {
    db: db!,
    workerId: "demo",
    job: { id: 1n, type: "demo", coin: COIN, epoch, key, attempts: 0, payload: null },
  }
}

/**
 * Give every author in this week a wallet derived from their GitHub id.
 *
 * Derived, not invented: the address is a function of the numeric id, so the
 * same contributor lands on the same address every run and two of them can
 * never collide. Nothing here claims a real person controls it.
 */
async function bindAuthors(): Promise<number> {
  const authors = await db!
    .selectDistinct({ subject: hmItems.platformUserId, handle: hmItems.platformHandle })
    .from(hmItems)
    .where(eq(hmItems.coin, COIN))
  if (authors.length === 0) return 0
  await db!
    .insert(hmBindings)
    .values(
      authors.map((a) => ({
        platform: "github",
        subject: a.subject,
        handle: a.handle,
        wallet: `0x${BigInt(a.subject).toString(16).padStart(40, "0")}`,
      }))
    )
    .onConflictDoNothing()
  return authors.length
}

async function main() {
  const epoch = lastClosedEpoch()
  if (epoch == null) throw new Error("no epoch has closed yet")
  const { start, end } = epochBounds(epoch)
  const repoId = await resolveRepoId(repoArg)

  console.log(`repo    ${repoArg} (#${repoId})`)
  console.log(`epoch   ${epoch}`)
  console.log(`window  ${start.toISOString()} -> ${end.toISOString()}`)
  const scorer = pickClient({
    provider: env.scorerProvider,
    anthropicApiKey: env.anthropicApiKey,
    deepseekApiKey: env.deepseekApiKey,
    openrouterApiKey: env.openrouterApiKey,
    modelId: env.scorerModelId,
  })
  console.log(`scorer  ${scorer ? scorer.modelId : "SIZE ONLY, no API key set"}`)
  console.log()

  await db!.execute(
    sql.raw(`truncate ${TABLE_NAMES.filter((t) => t.startsWith("hm_")).join(", ")} cascade`)
  )

  const [version] = await db!
    .insert(hmRuleVersions)
    .values({
      coin: COIN,
      versionNo: 1,
      body:
        "Merged pull requests to this repository count. Judge the change on what it " +
        "does for the project, not on how many lines it touches. Typos, version " +
        "bumps and formatting count for very little.",
      sources: { github: [{ repoId, name: repoArg }] },
      effectiveFromEpoch: epoch,
      confirmedAt: new Date(),
    })
    .returning({ id: hmRuleVersions.id })
  await db!.insert(hmRules).values({ coin: COIN, deployer: DEPLOYER, currentVersionId: version!.id })

  await db!
    .insert(hmJobs)
    .values({ type: "epoch_start", coin: COIN, epoch, key: "", status: "pending" })

  const client = scorer ?? sizeScorer()

  // Read the lane once up front, then bind a wallet per author, BEFORE the loop
  // starts. Doing it inside the polling loop was a race the demo lost on a
  // small week: scoring and publishing both finished inside the first poll, so
  // the list published with nobody bound and no money moved. In production the
  // binding happens days earlier, when the contributor connects a wallet, so
  // seeding it first is also the more honest simulation.
  await epochStart(ctxFor("", epoch))
  await laneRead(ctxFor("github", epoch))
  const boundCount = await bindAuthors()
  console.log(`  bound ${boundCount} author wallet(s) before scoring`)


  const controller = new AbortController()
  const loop = runLoop({
    db: db!,
    handlers: {
      epoch_start: epochStart,
      lane_read: laneRead,
      score_batch: makeScoreBatch({ makeClient: () => client }),
      publish: makePublish({ pot: { async potFor() { return { coin: COIN_POT, usdc: USDC_POT } } } }),
    },
    leaseSeconds: { lane_read: 600, score_batch: 1200 },
    workerId: "demo",
    pollSeconds: 1,
    signal: controller.signal,
    log: (level, msg, meta) =>
      console.log(`  [${level}] ${msg}${meta ? " " + JSON.stringify(meta) : ""}`),
  })

  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 500))

    const [e] = await db!
      .select({ state: hmEpochs.state })
      .from(hmEpochs)
      .where(and(eq(hmEpochs.coin, COIN), eq(hmEpochs.epoch, epoch)))
    if (e && ["published", "needs_operator", "rules_missing"].includes(e.state)) break
  }
  controller.abort()
  await loop.catch(() => {})

  await report(epoch)
  process.exit(0)
}

async function report(epoch: number) {
  const [e] = await db!
    .select()
    .from(hmEpochs)
    .where(and(eq(hmEpochs.coin, COIN), eq(hmEpochs.epoch, epoch)))
  const lanes = await db!.select().from(hmLaneReads).where(eq(hmLaneReads.coin, COIN))
  const leaves = await db!
    .select()
    .from(hmLeaves)
    .where(eq(hmLeaves.coin, COIN))
    .orderBy(desc(hmLeaves.coinAmount))

  console.log(`\n─── week ───`)
  console.log(`  state ${e?.state}   published ${e?.publishedAt?.toISOString() ?? "no"}`)
  for (const l of lanes) {
    console.log(`  lane ${l.lane}: ${l.status}, ${l.itemCount} item(s)${l.reason ? ` (${l.reason})` : ""}`)
  }

  const top = await db!
    .select({
      handle: hmItems.platformHandle,
      link: hmItems.link,
      median: hmScores.median,
      reason: hmScores.reason,
    })
    .from(hmItems)
    .innerJoin(hmScores, and(eq(hmScores.itemId, hmItems.id), eq(hmScores.round, 0)))
    .where(eq(hmItems.coin, COIN))
    .orderBy(desc(hmScores.median))
    .limit(8)

  console.log(`\n─── highest scored work ───`)
  for (const t of top) {
    console.log(`  ${String(t.median).padStart(3)}  ${t.handle}  ${t.link}`)
    console.log(`       ${t.reason.slice(0, 100)}`)
  }

  console.log(`\n─── payout list: ${leaves.length} wallet(s) ───`)
  for (const l of leaves.slice(0, 10)) {
    console.log(
      `  ${l.wallet}  ${fmt(l.coinAmount, 18)} tokens   ${fmt(l.usdcAmount, 6)} USDC`
    )
  }
  const coinTotal = leaves.reduce((s, l) => s + BigInt(l.coinAmount), 0n)
  const usdcTotal = leaves.reduce((s, l) => s + BigInt(l.usdcAmount), 0n)
  console.log(`\n  paid ${fmt(coinTotal.toString(), 18)} of ${fmt(COIN_POT.toString(), 18)} tokens`)
  console.log(`  paid ${fmt(usdcTotal.toString(), 6)} of ${fmt(USDC_POT.toString(), 6)} USDC`)
  console.log(
    `  exact: ${coinTotal === COIN_POT && usdcTotal === USDC_POT ? "yes, to the last unit" : "NO"}`
  )
}

/** Base units to a readable decimal, without floats. */
function fmt(raw: string, decimals: number): string {
  const v = BigInt(raw)
  const unit = 10n ** BigInt(decimals)
  const whole = v / unit
  const frac = (v % unit).toString().padStart(decimals, "0").slice(0, 2)
  return `${whole.toString()}.${frac}`
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
