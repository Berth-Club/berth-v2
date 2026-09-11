import { hmEpochs, hmItems, hmLaneReads, hmRuleVersions } from "@workspace/db"
import { and, eq, ne } from "drizzle-orm"

import { bindFromItem } from "./bindFromItem.js"

import { makeFomoReader } from "../connectors/fomo.js"
import { makeGithubReader } from "../connectors/github.js"
import { clean, contentHash, looksLikeInjection } from "../connectors/hygiene.js"
import type { LaneReader, LaneResult, LaneSources } from "../connectors/types.js"
import { env } from "../env.js"
import { done, failed, waitFor, type JobContext, type JobOutcome } from "./types.js"

/**
 * Read one lane for one coin for one week, and write down how it went.
 *
 * The job's real product is the `hm_lane_reads` row, not the items. An empty
 * week and an unreadable week produce the same zero items, and publishing the
 * first when the truth was the second pays nobody while looking completely
 * normal. So the status is written every time, and `publish` refuses to run
 * until every lane says `ok` or an operator has said `skipped` with a reason.
 *
 * Items are inserted with `onConflictDoNothing` against the natural key, so a
 * handler that runs twice — which the lease makes possible whenever a worker
 * dies mid-read — converges instead of duplicating a week's work.
 */

/**
 * Most items one lane may contribute to one week.
 *
 * A real limit, not a test knob: a week that returns thousands of items is a
 * coin whose rules point at something far too broad, and scoring all of it
 * would cost more than the week pays out. Hitting it marks the lane partial,
 * so an operator decides rather than the list quietly being short.
 *
 * Lowering it is also how a first paid run on a busy repository stays cheap.
 */
const CAP_PER_LANE = Number(process.env.HM_LANE_CAP ?? 500)

const readers: Record<string, () => LaneReader> = {
  github: () => makeGithubReader({ token: env.githubToken }),
  fomo: () => makeFomoReader({ archiveUrl: env.fomoArchiveUrl }),
}

export async function laneRead(ctx: JobContext): Promise<JobOutcome> {
  const { db, job } = ctx
  const lane = job.key
  const coin = job.coin

  const [epoch] = await db
    .select()
    .from(hmEpochs)
    .where(and(eq(hmEpochs.coin, coin), eq(hmEpochs.epoch, job.epoch)))

  if (!epoch) return failed(new Error(`no epoch row for ${coin} ${job.epoch}`))

  // The window is frozen on the epoch, not recomputed here: a first epoch may
  // reach back to a lookback date, and a rerun must read the same week.
  if (!epoch.windowStart || !epoch.windowEnd) {
    return failed(new Error(`epoch ${job.epoch} has no window`))
  }
  // Reading a week before it has closed would miss whatever lands after.
  if (epoch.windowEnd.getTime() > Date.now()) {
    return waitFor(60, "the week has not closed yet")
  }

  const makeReader = readers[lane]
  if (!makeReader) {
    await recordRead(ctx, lane, "failed", `no reader for lane "${lane}"`, 0)
    return done(`lane ${lane} has no reader`)
  }

  const sources = await frozenSources(ctx, epoch.rulesVersionId)
  if (!sources) {
    await recordRead(ctx, lane, "failed", "the epoch has no frozen rules", 0)
    return done("no frozen rules")
  }

  let result: LaneResult
  try {
    result = await makeReader()({
      window: { start: epoch.windowStart, end: epoch.windowEnd },
      sources,
      cap: CAP_PER_LANE,
      includeOpen: true,
    })
  } catch (error) {
    // An unexpected throw is a retry, not a verdict: the lane may be fine in
    // thirty seconds, and recording `failed` here would need an operator to
    // clear something that cleared itself.
    return failed(error)
  }

  let stored = 0
  let bound = 0
  for (const item of result.items) {
    const cleaned = clean(item.content)
    const flagged = looksLikeInjection(cleaned.text)

    const inserted = await db
      .insert(hmItems)
      .values({
        coin,
        epoch: job.epoch,
        lane,
        platform: item.platform,
        platformUserId: item.platformUserId,
        platformHandle: item.platformHandle,
        externalId: item.externalId,
        link: item.link,
        content: cleaned.text || null,
        contentHash: contentHash(cleaned.text),
        strippedBytes: cleaned.strippedBytes,
        status: item.open ? "open" : "pending",
        createdAt: item.createdAt,
      })
      // The natural key is (coin, epoch, lane, externalId): a second run of the
      // same read is a no-op rather than a doubled payout.
      //
      // The one exception is work that was open and has now merged. Without
      // this, a pull request first seen while open stays `open` forever: the
      // insert conflicts, nothing updates, and it is never scored or paid. The
      // `setWhere` is what keeps it an exception. An item that has already been
      // judged is frozen, because its content hash is what the score was
      // computed over and a later edit must not move it.
      .onConflictDoUpdate({
        target: [hmItems.coin, hmItems.epoch, hmItems.lane, hmItems.externalId],
        set: {
          status: item.open ? "open" : "pending",
          content: cleaned.text || null,
          contentHash: contentHash(cleaned.text),
          strippedBytes: cleaned.strippedBytes,
          // The merge time, which is the moment the work counted.
          createdAt: item.createdAt,
        },
        setWhere: eq(hmItems.status, "open"),
      })
      .returning({ id: hmItems.id })

    if (inserted.length > 0) stored++

    // Bind the author's wallet from what they wrote, if they wrote one. Done
    // here rather than in a later job because the cleaned text is already in
    // hand, and because a contributor who mentions an address in the same
    // pull request that earns should be paid for that week, not the next one.
    const itemId = inserted[0]?.id ?? (await existingItemId(ctx, lane, item.externalId))
    if (itemId != null) {
      const claim = await bindFromItem(ctx, {
        id: itemId,
        platform: item.platform,
        platformUserId: item.platformUserId,
        platformHandle: item.platformHandle ?? null,
        content: cleaned.text,
        coin,
        epoch: job.epoch,
      })
      if (claim.status === "bound") bound++
      else if (claim.status.startsWith("rejected") || claim.status === "ignored_locked") {
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "wallet claim not honoured",
            coin,
            epoch: job.epoch,
            externalId: item.externalId,
            status: claim.status,
          })
        )
      }
    }
    if (flagged) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "item addresses the scorer directly",
          coin,
          epoch: job.epoch,
          lane,
          externalId: item.externalId,
        })
      )
    }
  }

  await recordRead(ctx, lane, result.status, result.reason, result.items.length)
  return done(
      `${lane}: ${result.status}, ${stored} new of ${result.items.length}` +
        (bound > 0 ? `, ${bound} wallet(s) bound` : "")
    )
}

/** The sources the epoch froze, so a rerun reads the same repositories. */
async function frozenSources(
  ctx: JobContext,
  rulesVersionId: bigint | null
): Promise<LaneSources | null> {
  if (rulesVersionId == null) return null
  const [version] = await ctx.db
    .select({ sources: hmRuleVersions.sources })
    .from(hmRuleVersions)
    .where(eq(hmRuleVersions.id, rulesVersionId))
  return (version?.sources as LaneSources | undefined) ?? null
}

/**
 * Write the lane's verdict for this week.
 *
 * Never overwrites an operator's decision: once someone has skipped a lane or
 * accepted a partial read, a later automatic retry must not silently undo it.
 */
async function recordRead(
  ctx: JobContext,
  lane: string,
  status: string,
  reason: string | undefined,
  itemCount: number
): Promise<void> {
  await ctx.db
    .insert(hmLaneReads)
    .values({
      coin: ctx.job.coin,
      epoch: ctx.job.epoch,
      lane,
      status,
      reason: reason ?? null,
      itemCount,
      readAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [hmLaneReads.coin, hmLaneReads.epoch, hmLaneReads.lane],
      set: { status, reason: reason ?? null, itemCount, readAt: new Date() },
      // An operator's `skipped` is a decision, not a cached value: a later
      // automatic retry must not quietly undo it.
      setWhere: ne(hmLaneReads.status, "skipped"),
    })
}

/**
 * The id of an item that was already stored.
 *
 * `onConflictDoNothing` returns nothing on a repeat, so a re-read would have no
 * id to attach a wallet claim to. Someone who adds their address to a pull
 * request AFTER the first read still gets bound on the next one, which is the
 * common case for anyone who did not know to include it.
 */
async function existingItemId(
  ctx: JobContext,
  lane: string,
  externalId: string
): Promise<bigint | null> {
  const [row] = await ctx.db
    .select({ id: hmItems.id })
    .from(hmItems)
    .where(
      and(
        eq(hmItems.coin, ctx.job.coin),
        eq(hmItems.epoch, ctx.job.epoch),
        eq(hmItems.lane, lane),
        eq(hmItems.externalId, externalId)
      )
    )
  return row?.id ?? null
}
