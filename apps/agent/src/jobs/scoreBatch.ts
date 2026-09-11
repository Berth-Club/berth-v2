import {
  hmAudit,
  hmBindings,
  hmEpochs,
  hmItems,
  hmLaneReads,
  hmRuleVersions,
  hmScores,
} from "@workspace/db"
import { TEAM_WALLETS } from "@workspace/contracts"
import { and, eq, inArray, sql } from "drizzle-orm"

import { env } from "../env.js"
import { DEFAULT_MODEL_ID, pickClient, type ModelClient } from "../scoring/model.js"
import { promptHash } from "../scoring/prompt.js"
import { SCHEMA_HASH } from "../scoring/schema.js"
import { excludedReason, scoreItem } from "../scoring/score.js"
import { done, failed, waitFor, type JobContext, type JobOutcome } from "./types.js"

/**
 * Score every unscored item in one week, one at a time, resumably.
 *
 * Resumable is the whole design. Scoring a busy week is hundreds of paid calls,
 * and a worker that dies two thirds of the way through must not start again
 * from the top: the unique index on (item, round) turns a repeat into a no-op,
 * and the batch only ever picks up items with no score row yet. That is why
 * each item is committed as it finishes rather than the batch being wrapped in
 * one transaction.
 *
 * A lane that failed blocks scoring entirely. Scoring a week whose GitHub read
 * errored would produce a tidy, confident, wrong list, and the point of the
 * lane status is that this never happens quietly.
 */

/** Scored per run. Keeps one job from holding a lease for an hour. */
const BATCH_SIZE = 25
const ROUND = 0

/** Overridable so the batch can be exercised without a key or the network. */
export interface ScoreBatchDeps {
  makeClient?: () => ModelClient | null
}

export function makeScoreBatch(deps: ScoreBatchDeps = {}) {
  const makeClient =
    deps.makeClient ??
    (() =>
      pickClient({
        provider: env.scorerProvider,
        anthropicApiKey: env.anthropicApiKey,
        deepseekApiKey: env.deepseekApiKey,
        openrouterApiKey: env.openrouterApiKey,
        modelId: env.scorerModelId,
      }))

  return async function scoreBatch(ctx: JobContext): Promise<JobOutcome> {
    const { db, job } = ctx
    const coin = job.coin

    const [epoch] = await db
      .select()
      .from(hmEpochs)
      .where(and(eq(hmEpochs.coin, coin), eq(hmEpochs.epoch, job.epoch)))
    if (!epoch) return failed(new Error(`no epoch row for ${coin} ${job.epoch}`))

    // Every lane must have reported before any number is computed. A failed
    // read and an empty week look identical in the items table; only this row
    // tells them apart.
    const lanes = await db
      .select()
      .from(hmLaneReads)
      .where(and(eq(hmLaneReads.coin, coin), eq(hmLaneReads.epoch, job.epoch)))
    if (lanes.length === 0) return waitFor(60, "no lane has reported yet")

    const blocked = lanes.filter((l) => l.status === "failed")
    if (blocked.length > 0) {
      await setState(ctx, "needs_operator")
      return done(
        `lane(s) ${blocked.map((l) => l.lane).join(", ")} failed; an operator must skip or retry them`
      )
    }

    const rules = await frozenRules(ctx, epoch.rulesVersionId)
    if (!rules) {
      await setState(ctx, "needs_operator")
      return done("the epoch has no frozen rules")
    }

    const client = makeClient()
    if (!client) {
      // Degrade the handler, never the boot. The week waits for a key rather
      // than publishing a list of zeroes that looks like a judgement.
      return waitFor(
        300,
        "no scoring model is configured; set ANTHROPIC_API_KEY or DEEPSEEK_API_KEY"
      )
    }

    // Pin the model and prompt for the epoch on first entry, so every item in
    // this week is scored under one contract even if the batch spans restarts.
    const hash = promptHash(rules)
    if (!epoch.promptHash || !epoch.modelId) {
      await db
        .update(hmEpochs)
        .set({ promptHash: hash, modelId: client.modelId, state: "scoring" })
        .where(and(eq(hmEpochs.coin, coin), eq(hmEpochs.epoch, job.epoch)))
    } else if (epoch.promptHash !== hash || epoch.modelId !== client.modelId) {
      await setState(ctx, "needs_operator")
      return done(
        `the rules or model changed mid-epoch (prompt ${epoch.promptHash.slice(0, 8)} -> ` +
          `${hash.slice(0, 8)}, model ${epoch.modelId} -> ${client.modelId})`
      )
    }

    const pending = await db
      .select()
      .from(hmItems)
      .where(
        and(
          eq(hmItems.coin, coin),
          eq(hmItems.epoch, job.epoch),
          eq(hmItems.status, "pending"),
          sql`not exists (select 1 from ${hmScores} s where s.item_id = ${hmItems.id} and s.round = ${ROUND})`
        )
      )
      .limit(BATCH_SIZE)

    if (pending.length === 0) {
      await setState(ctx, "scoring")
      return done("every item in this week is scored")
    }

    const teamSubjects = await teamWalletSubjects(ctx, pending)

    let scored = 0
    let excluded = 0
    let rejected = 0

    for (const item of pending) {
      const skip = excludedReason({
        isTeamWallet: teamSubjects.has(`${item.platform}:${item.platformUserId}`),
        contentRemoved: item.contentRemovedAt != null,
        content: item.content,
      })

      if (skip) {
        await writeScore(ctx, item.id, "excluded", 0, skip, [])
        excluded++
        continue
      }

      const result = await scoreItem(
        {
          id: String(item.id),
          content: item.content!,
          handle: item.platformHandle,
          link: item.link,
        },
        { client, rules }
      )

      // Audit first. A crash between the audit and the score leaves a call
      // that is recorded but not counted, which is recoverable. The reverse
      // leaves a paid score with no evidence behind it, which is not.
      for (const s of result.samples) {
        await db
          .insert(hmAudit)
          .values({
            itemId: item.id,
            round: ROUND,
            sampleIdx: s.index,
            modelId: client.modelId,
            promptHash: hash,
            schemaHash: SCHEMA_HASH,
            contentHash: item.contentHash,
            rulesVersionId: epoch.rulesVersionId,
            rawResponse: s.raw,
            parsed: s.verdict ?? { rejected: s.rejected },
            usage: s.usage ?? null,
            providerRequestId: s.requestId ?? null,
          })
          .onConflictDoNothing()
      }

      await writeScore(ctx, item.id, result.status, result.median, result.reason, result.cited)
      if (result.status === "scored") scored++
      else rejected++
    }

    const remaining = pending.length === BATCH_SIZE
    const summary = `${scored} scored, ${excluded} excluded, ${rejected} rejected`
    if (remaining) return waitFor(1, `${summary}; more items to go`)

    await setState(ctx, "scoring")
    return done(summary)
  }
}

/** Default wiring, used by the registry. */
export const scoreBatch = makeScoreBatch()

async function writeScore(
  ctx: JobContext,
  itemId: bigint,
  status: string,
  median: number,
  reason: string,
  cited: string[]
): Promise<void> {
  await ctx.db
    .insert(hmScores)
    .values({ itemId, round: ROUND, median, reason, cited, status })
    // A rerun after a crash must not double-write or overwrite: the first
    // verdict recorded for an item is the one that was paid on.
    .onConflictDoNothing()

  // The item is judged either way. Why it got the number it did lives on the
  // score row, which is what the public list reads.
  await ctx.db.update(hmItems).set({ status: "scored" }).where(eq(hmItems.id, itemId))
}

async function frozenRules(ctx: JobContext, rulesVersionId: bigint | null): Promise<string | null> {
  if (rulesVersionId == null) return null
  const [v] = await ctx.db
    .select({ body: hmRuleVersions.body })
    .from(hmRuleVersions)
    .where(eq(hmRuleVersions.id, rulesVersionId))
  return v?.body ?? null
}

/**
 * Which of these items were written by a bound team wallet.
 *
 * Keyed on `platform:subject` because that is what an item carries. An unbound
 * author cannot be a known team member, which is correct: the exclusion is
 * about who gets paid, and an unbound author is not getting paid yet anyway.
 */
async function teamWalletSubjects(
  ctx: JobContext,
  items: readonly { platform: string; platformUserId: string }[]
): Promise<Set<string>> {
  const team = TEAM_WALLETS.map((w) => w.toLowerCase())
  if (team.length === 0 || items.length === 0) return new Set()

  const subjects = [...new Set(items.map((i) => i.platformUserId))]
  const rows = await ctx.db
    .select({ platform: hmBindings.platform, subject: hmBindings.subject, wallet: hmBindings.wallet })
    .from(hmBindings)
    .where(inArray(hmBindings.subject, subjects))

  return new Set(
    rows.filter((r) => team.includes(r.wallet.toLowerCase())).map((r) => `${r.platform}:${r.subject}`)
  )
}

async function setState(ctx: JobContext, state: string): Promise<void> {
  await ctx.db
    .update(hmEpochs)
    .set({ state })
    .where(and(eq(hmEpochs.coin, ctx.job.coin), eq(hmEpochs.epoch, ctx.job.epoch)))
}

export { DEFAULT_MODEL_ID }
