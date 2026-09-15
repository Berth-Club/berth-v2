import {
  hmEpochs,
  hmItems,
  hmLeaves,
  hmRules,
  hmRuleVersions,
  hmScores,
  makeDb,
} from "@workspace/db"
import { and, eq } from "drizzle-orm"

import { epochBounds } from "../clock.js"
import { env } from "../env.js"
import { venueRead } from "../jobs/venueRead.js"
import { makePublish } from "../jobs/publish.js"
import { makeScoreBatch } from "../jobs/scoreBatch.js"
import { pickClient } from "../scoring/model.js"
import type { JobContext } from "../jobs/types.js"

/**
 * Watch one repository for one week, and keep the record up to date.
 *
 * Unlike `demo:week` this never truncates. It seeds the coin once if it is not
 * there, then re-reads the venue every minute, scores anything new, and
 * republishes. Editing a pull request description to add a wallet address shows
 * up on the page within a minute without anyone running a command.
 *
 * It is a development tool, not the production worker. The real worker opens
 * whichever week just closed on a timer; this one is pinned to a week you name,
 * so you can watch an older one react to an edit.
 *
 *   HM_DEMO_EPOCH=29 pnpm --filter agent watch Arcane-build/berthdotclub
 */

const COIN = "0x00000000000000000000000000000000000000aa"
const DEPLOYER = "0x00000000000000000000000000000000000000de"
const COIN_POT = BigInt(process.env.HM_COIN_POT ?? "1000000000000000000000")
const USDC_POT = BigInt(process.env.HM_USDC_POT ?? "500000000")
const EVERY_MS = Number(process.env.HM_WATCH_SECONDS ?? 60) * 1000

const repoArg = process.argv[2] ?? "Berth-Club/berth-v2"
const epoch = Number(process.env.HM_DEMO_EPOCH ?? NaN)

const db = makeDb(process.env.DATABASE_URL)
if (!db) {
  console.error("DATABASE_URL is not set.")
  process.exit(1)
}
if (!env.githubToken) {
  console.error("GITHUB_TOKEN is not set.")
  process.exit(1)
}
if (!Number.isInteger(epoch)) {
  console.error("Set HM_DEMO_EPOCH to the week to watch, e.g. HM_DEMO_EPOCH=29")
  process.exit(1)
}

const ctx = (key = ""): JobContext => ({
  db: db!,
  workerId: "watch",
  job: { id: 1n, type: "watch", coin: COIN, epoch, key, attempts: 0, payload: null },
})

async function resolveRepoId(name: string): Promise<number> {
  const res = await fetch(`https://api.github.com/repos/${name}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.githubToken}`,
      "user-agent": "berth-harbormaster",
    },
  })
  if (!res.ok) throw new Error(`cannot read ${name}: GitHub returned ${res.status}`)
  return ((await res.json()) as { id: number }).id
}

/**
 * The window this run reads.
 *
 * Normally the epoch's own bounds. With HM_PREVIEW set, a week still in
 * progress is read up to this moment instead of being refused: useful for
 * watching work land during the week, and honest about what it is, because the
 * record shows the window it actually read rather than the full week.
 *
 * A preview is never a payout. The real run happens after the week closes, over
 * the full window, and that is the one whose numbers count.
 */
function windowFor(): { start: Date; end: Date; preview: boolean } {
  const { start, end } = epochBounds(epoch)
  if (!process.env.HM_PREVIEW || end.getTime() <= Date.now()) {
    return { start, end, preview: false }
  }
  return { start, end: new Date(), preview: true }
}

/** Create the coin and the week once. Never destructive: existing rows win. */
async function seed(repoId: number) {
  const { start, end } = windowFor()

  const [rules] = await db!.select().from(hmRules).where(eq(hmRules.coin, COIN))
  if (!rules) {
    const [v] = await db!
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
    await db!
      .insert(hmRules)
      .values({ coin: COIN, deployer: DEPLOYER, currentVersionId: v!.id })
      .onConflictDoNothing()
  }

  const [week] = await db!
    .select()
    .from(hmEpochs)
    .where(and(eq(hmEpochs.coin, COIN), eq(hmEpochs.epoch, epoch)))
  if (!week) {
    const [v] = await db!
      .select({ id: hmRuleVersions.id })
      .from(hmRuleVersions)
      .where(eq(hmRuleVersions.coin, COIN))
    await db!
      .insert(hmEpochs)
      .values({
        coin: COIN,
        epoch,
        state: "reads_pending",
        rulesVersionId: v!.id,
        windowStart: start,
        windowEnd: end,
      })
      .onConflictDoNothing()
  }
}

const scorer = pickClient({
  provider: env.scorerProvider,
  anthropicApiKey: env.anthropicApiKey,
  deepseekApiKey: env.deepseekApiKey,
  openrouterApiKey: env.openrouterApiKey,
  modelId: env.scorerModelId,
})

const scoreBatch = makeScoreBatch({ makeClient: () => scorer })
const publish = makePublish({
  pot: { async potFor() { return { coin: COIN_POT, usdc: USDC_POT } } },
})

/** One pass: read, score what is new, republish. */
async function tick(): Promise<string> {
  const w = windowFor()
  if (w.preview) {
    // Move the end forward so work merged since the last pass is in range.
    await db!
      .update(hmEpochs)
      .set({ windowEnd: w.end })
      .where(and(eq(hmEpochs.coin, COIN), eq(hmEpochs.epoch, epoch)))
  }

  const read = await venueRead(ctx("github"))

  // Scoring only touches items with no score row, so this is cheap on a pass
  // where nothing changed. It is the same batch the production worker runs.
  const scored = await scoreBatch(ctx())

  // Publishing is gated on `publishedAt`, so clear it to recompute the split.
  // A real week would go through a dispute round instead; this is a dev tool
  // and the point is to see an edit take effect.
  await db!
    .update(hmEpochs)
    .set({ state: "scoring", publishedAt: null })
    .where(and(eq(hmEpochs.coin, COIN), eq(hmEpochs.epoch, epoch)))
  await publish(ctx())

  const items = await db!.select().from(hmItems).where(eq(hmItems.coin, COIN))
  const scores = await db!.select().from(hmScores)
  const leaves = await db!.select().from(hmLeaves).where(eq(hmLeaves.coin, COIN))
  const owed = leaves.reduce((s, l) => s + BigInt(l.coinAmount), 0n) / 10n ** 18n

  return (
    `${items.length} contribution(s), ${scores.length} scored, ` +
    `${leaves.length} wallet(s) owed ${owed} tokens` +
    (read.kind === "wait" ? "  [waiting: week not closed]" : "") +
    (scored.kind === "wait" ? "  [waiting to score]" : "")
  )
}

async function main() {
  const repoId = await resolveRepoId(repoArg)
  const { start, end, preview } = windowFor()

  console.log(`watching ${repoArg} (#${repoId})`)
  console.log(
    `week ${epoch}: ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}` +
      (preview ? "  (PREVIEW: week still running, read up to now)" : "")
  )
  console.log(`scorer: ${scorer ? scorer.modelId : "NONE, set OPENROUTER_API_KEY"}`)
  console.log(`checking every ${EVERY_MS / 1000}s. Ctrl-C to stop.\n`)

  await seed(repoId)

  let stop = false
  process.on("SIGINT", () => {
    stop = true
    console.log("\nstopped")
    process.exit(0)
  })

  let last = ""
  while (!stop) {
    try {
      const line = await tick()
      const stamp = new Date().toTimeString().slice(0, 8)
      // Only print when something changed, so a long watch stays readable.
      if (line !== last) {
        console.log(`${stamp}  ${line}`)
        last = line
      }
    } catch (error) {
      console.error(`${new Date().toTimeString().slice(0, 8)}  ${(error as Error).message}`)
    }
    await new Promise((r) => setTimeout(r, EVERY_MS))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
