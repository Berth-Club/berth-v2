import { hmBindings, hmEpochs, hmItems, hmLaneReads, hmLeaves, hmScores } from "@workspace/db"
import { and, eq, inArray } from "drizzle-orm"

import { splitPot, type Contribution } from "../epoch/split.js"
import { done, failed, waitFor, type JobContext, type JobOutcome } from "./types.js"

/**
 * Turn a scored week into the list of who is owed what.
 *
 * Publishing is the last point where a mistake is cheap. After this the list
 * goes up, people read it, and a correction means arguing with the public
 * record. So the gates here are deliberately blunt: every lane must have
 * reported, every item must be judged, and a week with nothing in it publishes
 * as an empty week rather than as an error to be cleared.
 *
 * An author with no wallet bound is scored and listed, but gets no leaf. Their
 * work still counts and still shows on the record, which is what lets someone
 * bind a wallet after seeing their own name. What it does not do is invent an
 * address to pay.
 */

/**
 * The weekly pot, in base units.
 *
 * OPEN DECISION. The plan has this as the 1% per-epoch cap measured against the
 * vault's balance net of unclaimed, which needs the vault contract to exist
 * before it can be read. Until then it comes from config, so the pipeline is
 * exercisable end to end and the number is obviously a placeholder rather than
 * quietly wrong.
 */
export interface PotSource {
  potFor(coin: string, epoch: number): Promise<{ coin: bigint; usdc: bigint }>
}

export const configuredPot: PotSource = {
  async potFor() {
    return {
      coin: BigInt(process.env.HM_COIN_POT ?? "0"),
      usdc: BigInt(process.env.HM_USDC_POT ?? "0"),
    }
  },
}

export function makePublish(deps: { pot?: PotSource } = {}) {
  const pot = deps.pot ?? configuredPot

  return async function publish(ctx: JobContext): Promise<JobOutcome> {
    const { db, job } = ctx
    const coin = job.coin

    const [epoch] = await db
      .select()
      .from(hmEpochs)
      .where(and(eq(hmEpochs.coin, coin), eq(hmEpochs.epoch, job.epoch)))
    if (!epoch) return failed(new Error(`no epoch row for ${coin} ${job.epoch}`))

    if (epoch.publishedAt) return done("already published")

    // Same gate as scoring, repeated on purpose. A lane could be marked failed
    // by an operator between the two, and publishing is the expensive mistake.
    const lanes = await db
      .select()
      .from(hmLaneReads)
      .where(and(eq(hmLaneReads.coin, coin), eq(hmLaneReads.epoch, job.epoch)))
    if (lanes.length === 0) return waitFor(60, "no lane has reported yet")
    const bad = lanes.filter((l) => l.status === "failed")
    if (bad.length > 0) {
      return done(`cannot publish: lane(s) ${bad.map((l) => l.lane).join(", ")} failed`)
    }

    const rows = await db
      .select({
        itemId: hmItems.id,
        platform: hmItems.platform,
        subject: hmItems.platformUserId,
        handle: hmItems.platformHandle,
        status: hmItems.status,
        median: hmScores.median,
        scoreStatus: hmScores.status,
      })
      .from(hmItems)
      // Left join, not inner: an item with no score row must show up here as
      // unjudged and hold the week, not vanish from the count and let a short
      // list publish as if it were complete.
      .leftJoin(hmScores, and(eq(hmScores.itemId, hmItems.id), eq(hmScores.round, 0)))
      .where(and(eq(hmItems.coin, coin), eq(hmItems.epoch, job.epoch)))

    const unjudged = rows.filter((r) => r.median == null)
    if (unjudged.length > 0) {
      return waitFor(30, `${unjudged.length} item(s) are still unscored`)
    }

    const { coin: coinPot, usdc: usdcPot } = await pot.potFor(coin, job.epoch)

    // Resolve authors to wallets. One lookup, keyed the way items carry it.
    const subjects = [...new Set(rows.map((r) => r.subject))]
    const bindings =
      subjects.length > 0
        ? await db
            .select({
              platform: hmBindings.platform,
              subject: hmBindings.subject,
              wallet: hmBindings.wallet,
            })
            .from(hmBindings)
            .where(inArray(hmBindings.subject, subjects))
        : []
    const walletOf = new Map(bindings.map((b) => [`${b.platform}:${b.subject}`, b.wallet]))

    const contributions: Contribution[] = []
    const unbound: string[] = []
    for (const r of rows) {
      if (!r.median || r.median <= 0) continue
      const wallet = walletOf.get(`${r.platform}:${r.subject}`)
      if (!wallet) {
        unbound.push(r.handle ?? r.subject)
        continue
      }
      contributions.push({ wallet, score: r.median })
    }

    const split = splitPot(contributions, coinPot, usdcPot)

    await db.delete(hmLeaves).where(and(eq(hmLeaves.coin, coin), eq(hmLeaves.epoch, job.epoch)))
    if (split.shares.length > 0) {
      await db.insert(hmLeaves).values(
        split.shares.map((s, i) => ({
          coin,
          epoch: job.epoch,
          wallet: s.wallet,
          coinAmount: s.coinAmount.toString(),
          usdcAmount: s.usdcAmount.toString(),
          leafIndex: i,
        }))
      )
    }

    const now = new Date()
    await db
      .update(hmEpochs)
      .set({
        state: "published",
        publishedAt: now,
        // 48 hours to argue, then it settles. The clock is what makes the list
        // a proposal rather than a verdict.
        clockEnd: new Date(now.getTime() + 48 * 3600 * 1000),
        deadlineAt: new Date(now.getTime() + 72 * 3600 * 1000),
      })
      .where(and(eq(hmEpochs.coin, coin), eq(hmEpochs.epoch, job.epoch)))

    const unboundNote =
      unbound.length > 0 ? `; ${unbound.length} author(s) unpaid, no wallet bound` : ""
    return done(
      `published ${split.shares.length} leaf/leaves, ` +
        `${split.coinTotal} coin and ${split.usdcTotal} USDC base units${unboundNote}`
    )
  }
}

export const publish = makePublish()
