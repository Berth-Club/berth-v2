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
const LANES_TO_READ = ["github"] as const

export async function epochStart(ctx: JobContext): Promise<JobOutcome> {
  const { db } = ctx

  const epoch = lastClosedEpoch()
  if (epoch == null) return waitFor(3600, "the first epoch has not closed yet")

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

    for (const lane of LANES_TO_READ) {
      await enqueue(ctx, "lane_read", c.coin, epoch, lane)
    }
    await enqueue(ctx, "score_batch", c.coin, epoch, "")
    await enqueue(ctx, "publish", c.coin, epoch, "")
    opened++
  }

  // Come back well before the next boundary. The check is cheap and a missed
  // week is not.
  return opened > 0
    ? done(`opened epoch ${epoch} for ${opened} coin(s), ${skipped} already had it`)
    : waitFor(3600, `epoch ${epoch} already open for all ${skipped} coin(s)`)
}

/**
 * Queue a job unless its identity is already queued.
 *
 * The unique index on (type, coin, epoch, key) is what makes this safe to call
 * on every tick. Ordering comes from each handler waiting on its own
 * preconditions rather than from a dependency graph: `score_batch` waits for
 * lanes to report, `publish` waits for every item to be judged. That way a job
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
