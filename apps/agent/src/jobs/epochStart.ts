import { hmEpochs, hmJobs, hmRules, hmRuleVersions } from "@workspace/db"
import { and, eq, lte, desc } from "drizzle-orm"

import { epochBounds, lastClosedEpoch } from "../clock.js"
import { done, waitFor, type JobContext, type JobOutcome } from "./types.js"

/**
 * Open the week that just closed, for every coin that has rules.
 *
 * This is the only job that creates epochs, and it runs on a repeating global
 * timer rather than per coin, so "which week is it" is asked once and answered
 * once. A per-coin timer would let two coins disagree about the week boundary
 * after a restart, and the vault would only tell us by reverting.
 *
 * Everything it writes is conditional on nothing being there already. The timer
 * fires more than once per week by design, because a timer that only fires once
 * and is missed costs a week's payouts; one that fires often and no-ops costs
 * nothing.
 */

/** Jobs enqueued for each new epoch, in the order they unblock each other. */
// Every venue a week reads. A venue a coin has not opted into costs one
// cheap query that returns nothing, so listing them all here is simpler
// than deriving the list per coin from its rules.
const VENUES_TO_READ = ["github", "fomo"] as const

export async function epochStart(ctx: JobContext): Promise<JobOutcome> {
  const { db } = ctx

  const latest = lastClosedEpoch()
  if (latest == null) return waitFor(3600, "the first epoch has not closed yet")

  // The job row names the week to open. Zero means "whatever just closed",
  // which is what the repeating timer enqueues and what production always
  // does. A non-zero epoch backfills an older week, which is how a coin that
  // joins late gets the week its work actually happened in.
  const epoch = ctx.job.epoch > 0 ? ctx.job.epoch : latest
  if (epoch > latest) {
    // Reading a week still in progress would miss whatever lands after.
    return waitFor(3600, `epoch ${epoch} has not closed yet, newest is ${latest}`)
  }

  const { start, end } = epochBounds(epoch)

  // A coin exists for the Harbormaster once it has a rules row. Anything
  // launched but never configured has nothing to score against, so it is
  // correctly absent here rather than opening empty weeks forever.
  const coins = await db.select({ coin: hmRules.coin }).from(hmRules)
  if (coins.length === 0) return waitFor(3600, "no coins have rules yet")

  let opened = 0
  let skipped = 0

  for (const c of coins) {
    const [existing] = await db
      .select({ epoch: hmEpochs.epoch })
      .from(hmEpochs)
      .where(and(eq(hmEpochs.coin, c.coin), eq(hmEpochs.epoch, epoch)))
    if (existing) {
      skipped++
      continue
    }

    // The rules in force for this week are the newest version confirmed to
    // start on or before it. Freezing the id here is what lets a coin edit its
    // rules on Tuesday without changing how Monday was judged.
    const [rules] = await db
      .select({ id: hmRuleVersions.id })
      .from(hmRuleVersions)
      .where(
        and(
          eq(hmRuleVersions.coin, c.coin),
          lte(hmRuleVersions.effectiveFromEpoch, epoch)
        )
      )
      .orderBy(desc(hmRuleVersions.effectiveFromEpoch))
      .limit(1)

    if (!rules) {
      await db
        .insert(hmEpochs)
        .values({
          coin: c.coin,
          epoch,
          state: "rules_missing",
          windowStart: start,
          windowEnd: end,
        })
        .onConflictDoNothing()
      skipped++
      continue
    }

    await db
      .insert(hmEpochs)
      .values({
        coin: c.coin,
        epoch,
        state: "reads_pending",
        rulesVersionId: rules.id,
        // Frozen on the row. A rerun of this week must read the same window,
        // and a coin's first week may reach back further than seven days.
        windowStart: start,
        windowEnd: end,
      })
      .onConflictDoNothing()

    for (const venue of VENUES_TO_READ) {
      await enqueue(ctx, "venue_read", c.coin, epoch, venue)
    }
    await enqueue(ctx, "score_batch", c.coin, epoch, "")
    await enqueue(ctx, "publish", c.coin, epoch, "")
    opened++
  }

  const note =
    opened > 0
      ? `opened epoch ${epoch} for ${opened} coin(s), ${skipped} already had it`
      : `epoch ${epoch} already open for all ${skipped} coin(s)`

  // A backfill names one week, and once that week is open it is finished.
  if (ctx.job.epoch > 0) return done(note)

  // The repeating timer must NEVER finish. It used to return `done` after
  // opening a week, which marked the only timer row complete, so the next week
  // was never opened by anything. Come back well before the next boundary: the
  // check is cheap and a missed week is not.
  return waitFor(3600, note)
}

/**
 * The identity of the repeating timer row.
 *
 * Global rather than per coin (see above), so it carries no coin and no epoch.
 * `ensureEpochTimer` inserts it at boot; nothing else creates it.
 */
export const EPOCH_TIMER = { type: "epoch_start", coin: "", epoch: 0, key: "" } as const

/**
 * Make sure the repeating timer exists, and is not stuck finished.
 *
 * Without this nothing in production ever enqueued `epoch_start`: only the demo
 * scripts did. A fresh deploy polled an empty queue forever and no week opened.
 * Safe on every boot: the unique job identity makes a second insert a no-op, and
 * a row left `done` by the old behaviour is put back to pending.
 */
export async function ensureEpochTimer(db: JobContext["db"]): Promise<void> {
  await db
    .insert(hmJobs)
    .values({ ...EPOCH_TIMER, status: "pending", runAfter: new Date() })
    .onConflictDoUpdate({
      target: [hmJobs.type, hmJobs.coin, hmJobs.epoch, hmJobs.key],
      set: { status: "pending", runAfter: new Date() },
      setWhere: eq(hmJobs.status, "done"),
    })
}

/**
 * Queue a job unless its identity is already queued.
 *
 * The unique index on (type, coin, epoch, key) is what makes this safe to call
 * on every tick. Ordering comes from each handler waiting on its own
 * preconditions rather than from a dependency graph: `score_batch` waits for
 * venues to report, `publish` waits for every item to be judged. That way a job
 * enqueued too early costs one cheap poll, not a stuck week.
 */
async function enqueue(
  ctx: JobContext,
  type: string,
  coin: string,
  epoch: number,
  key: string
): Promise<void> {
  await ctx.db
    .insert(hmJobs)
    .values({ type, coin, epoch, key, status: "pending", runAfter: new Date() })
    .onConflictDoNothing()
}
