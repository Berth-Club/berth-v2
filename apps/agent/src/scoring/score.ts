import type { ModelClient } from "./model.js"
import { buildUserPrompt, systemPromptFor } from "./prompt.js"
import { parseVerdict, RejectedOutput, type Verdict } from "./schema.js"

/**
 * Score one item: sample the model, keep every reply, take the median.
 *
 * One sample by default. More than one is how a borderline score stops being a
 * coin flip, and the count belongs in config rather than here, set from a dry
 * run that scores real items repeatedly and records how often they disagree.
 *
 * The median, not the mean: one sample that misreads the item and answers 5
 * drags a mean down, and the whole point of sampling more than once is that a
 * single bad read should not decide what someone is paid.
 *
 * Every sample is returned whether it parsed or not. The caller writes them all
 * to the audit table, because "the model replied with nonsense three times" is
 * exactly what someone disputing a zero needs to be able to see.
 */

export interface ScoreItem {
  id: string
  content: string
  handle?: string | null
  link?: string | null
  /** Which venue's rules to judge under. Defaults to the GitHub ones. */
  venue?: string
  /** Numbers the venue knows and the text does not say. FOMO only, so far. */
  signals?: {
    numLikes?: number | null
    positionUsd?: number | null
    soldAt?: Date | string | null
  }
}

export interface Sample {
  index: number
  raw: string
  verdict: Verdict | null
  /** Why this sample was thrown away. Null when it parsed. */
  rejected: string | null
  usage?: { inputTokens?: number; outputTokens?: number }
  requestId?: string
}

export type ScoreStatus = "scored" | "rejected_output" | "excluded"

export interface ScoreResult {
  status: ScoreStatus
  median: number
  reason: string
  cited: string[]
  samples: Sample[]
  /** True when no model was called, so the caller can skip the audit rows. */
  skippedModel: boolean
}

export interface ScoreOptions {
  client: ModelClient
  rules: string
  samples?: number
  signal?: AbortSignal
}

/**
 * The exclusions that must never reach the model.
 *
 * Deciding these first is not an optimisation. A team member's pull request
 * scores zero because of who submitted it, and asking a model to confirm that
 * invites it to disagree. The rule is the rule; the model is for judging work
 * whose value is actually in question.
 */
export function excludedReason(opts: {
  isTeamWallet?: boolean
  contentRemoved?: boolean
  content?: string | null
}): string | null {
  if (opts.isTeamWallet) {
    return "Excluded: the author is a team wallet. The vault pays people other than the team."
  }
  if (opts.contentRemoved) {
    return "Excluded: the contribution's text was removed, so it cannot be judged."
  }
  if (!opts.content || opts.content.trim().length === 0) {
    return "Excluded: the contribution has no text to judge."
  }
  return null
}

export async function scoreItem(item: ScoreItem, opts: ScoreOptions): Promise<ScoreResult> {
  const n = Math.max(1, opts.samples ?? 1)
  const allowed = new Set([item.id])
  const userPrompt = buildUserPrompt({
    rules: opts.rules,
    itemId: item.id,
    content: item.content,
    handle: item.handle,
    link: item.link,
    venue: item.venue,
    signals: item.signals,
  })
  // The rules a callout is judged under are not the rules a pull request is
  // judged under, and the same process scores both in one week.
  const system = systemPromptFor(item.venue ?? "github")

  const samples: Sample[] = []
  for (let i = 0; i < n; i++) {
    let reply
    try {
      reply = await opts.client.complete(userPrompt, opts.signal, system)
    } catch (error) {
      // A transport failure is not a verdict. Throwing lets the job retry the
      // whole item rather than recording a zero someone would have to dispute.
      throw error
    }
    try {
      samples.push({
        index: i,
        raw: reply.raw,
        verdict: parseVerdict(reply.raw, allowed),
        rejected: null,
        usage: reply.usage,
        requestId: reply.requestId,
      })
    } catch (error) {
      if (!(error instanceof RejectedOutput)) throw error
      samples.push({
        index: i,
        raw: reply.raw,
        verdict: null,
        rejected: error.message,
        usage: reply.usage,
        requestId: reply.requestId,
      })
    }
  }

  const good = samples.filter((s) => s.verdict !== null)
  if (good.length === 0) {
    const why = samples[0]?.rejected ?? "no usable reply"
    return {
      status: "rejected_output",
      median: 0,
      reason: `Scored zero: the scorer's reply could not be used (${why}). This line is flagged for review.`,
      cited: [],
      samples,
      skippedModel: false,
    }
  }

  const scores = good.map((s) => s.verdict!.score).sort((a, b) => a - b)
  const median = medianOf(scores)
  // The reason must come from a sample that actually scored the median, so the
  // published number and the published sentence describe the same judgement.
  const chosen = good.find((s) => s.verdict!.score === median) ?? good[0]!

  return {
    status: "scored",
    median,
    reason: chosen.verdict!.reason,
    cited: chosen.verdict!.cited,
    samples,
    skippedModel: false,
  }
}

/** An even count takes the lower middle, so a median is always a real sample. */
export function medianOf(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor((sorted.length - 1) / 2)
  return sorted[mid]!
}
