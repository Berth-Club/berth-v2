import "server-only"

import {
  hmBindings,
  hmEpochs,
  hmItems,
  hmLaneReads,
  hmLeaves,
  hmRuleVersions,
  hmScores,
  hmRules,
  hmWalletClaims,
} from "@workspace/db/schema"
import { and, desc, eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { serverEnv } from "@/lib/server-env"

/**
 * The public record, read-only.
 *
 * The web app never writes a Harbormaster row. The agent owns every table here
 * and is the single writer; this file exists so a person can read what the
 * agent decided and argue with it. Keeping the write path out of the
 * internet-facing process is most of what bounds the damage if it is ever
 * compromised.
 *
 * A missing database degrades to an empty record rather than a crash, the same
 * rule the comments table follows. The page then shows what it always showed,
 * which is the honest answer when there is nothing to report.
 */

/**
 * The web app's own connection, not the agent's `makeDb`.
 *
 * Two reasons. The package's barrel entry re-exports the client with NodeNext
 * `.js` specifiers, which Turbopack will not resolve to the `.ts` files, so
 * importing it at all breaks the build. And the agent's pool is sized for one
 * long-lived worker; a web process wants a small pool it can share with the
 * comments table. Importing the schema by subpath keeps both out of each
 * other's way.
 */
let cached: ReturnType<typeof drizzle> | null = null

function db() {
  if (!serverEnv.databaseUrl) return null
  if (!cached) {
    const client = postgres(serverEnv.databaseUrl, {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
    })
    cached = drizzle(client)
  }
  return cached
}

export interface RecordLine {
  handle: string | null
  link: string | null
  score: number
  reason: string
  status: string
  /** Null when the author never bound a wallet, which is why they are unpaid. */
  wallet: string | null
  strippedBytes: number
  /**
   * Why an address they wrote was not used, when one was written and refused.
   * A contributor who is unpaid deserves the reason on the same line as the
   * score, not in a log only we can read.
   */
  claimNote: string | null
}

export interface RecordPayout {
  wallet: string
  coinAmount: string
  usdcAmount: string
  leafIndex: number
}

export interface RecordLane {
  lane: string
  status: string
  reason: string | null
  itemCount: number
}

export interface WeekRecord {
  coin: string
  epoch: number
  state: string
  windowStart: Date | null
  windowEnd: Date | null
  publishedAt: Date | null
  clockEnd: Date | null
  modelId: string | null
  promptHash: string | null
  rules: string | null
  lanes: RecordLane[]
  lines: RecordLine[]
  payouts: RecordPayout[]
  /** Work still open. Read and shown, never scored, never paid. */
  inFlight: RecordLine[]
  /** Authors who were judged but have no wallet, so nothing could be sent. */
  unpaidCount: number
  /** Scored contributions kept off the list because nobody could be paid. */
  unlistedCount: number
}

/** The most recently published weeks, newest first. */
export async function listWeeks(limit = 10): Promise<Array<{ coin: string; epoch: number; state: string; publishedAt: Date | null; itemCount: number }>> {
  const d = db()
  if (!d) return []

  const rows = await d
    .select({
      coin: hmEpochs.coin,
      epoch: hmEpochs.epoch,
      state: hmEpochs.state,
      publishedAt: hmEpochs.publishedAt,
    })
    .from(hmEpochs)
    .orderBy(desc(hmEpochs.epoch))
    .limit(limit)

  if (rows.length === 0) return []

  // One extra query rather than a join, because the count is per (coin, epoch)
  // and a join would multiply the epoch rows by their items.
  const counts = await d
    .select({ coin: hmLaneReads.coin, epoch: hmLaneReads.epoch, itemCount: hmLaneReads.itemCount })
    .from(hmLaneReads)
    .where(inArray(hmLaneReads.epoch, rows.map((r) => r.epoch)))

  return rows.map((r) => ({
    ...r,
    itemCount: counts
      .filter((c) => c.coin === r.coin && c.epoch === r.epoch)
      .reduce((s, c) => s + c.itemCount, 0),
  }))
}

/** Everything the record page shows for one week of one coin. */
export async function getWeek(coin: string, epoch: number): Promise<WeekRecord | null> {
  const d = db()
  if (!d) return null

  const [week] = await d
    .select()
    .from(hmEpochs)
    .where(and(eq(hmEpochs.coin, coin.toLowerCase()), eq(hmEpochs.epoch, epoch)))
  if (!week) return null

  const lanes = await d
    .select({
      lane: hmLaneReads.lane,
      status: hmLaneReads.status,
      reason: hmLaneReads.reason,
      itemCount: hmLaneReads.itemCount,
    })
    .from(hmLaneReads)
    .where(and(eq(hmLaneReads.coin, week.coin), eq(hmLaneReads.epoch, epoch)))

  // Left join, so an item the scorer never reached still appears. A record that
  // silently dropped unjudged work would look complete when it is not.
  const scored = await d
    .select({
      handle: hmItems.platformHandle,
      link: hmItems.link,
      platform: hmItems.platform,
      subject: hmItems.platformUserId,
      strippedBytes: hmItems.strippedBytes,
      itemStatus: hmItems.status,
      score: hmScores.median,
      reason: hmScores.reason,
      status: hmScores.status,
    })
    .from(hmItems)
    .leftJoin(hmScores, and(eq(hmScores.itemId, hmItems.id), eq(hmScores.round, 0)))
    .where(and(eq(hmItems.coin, week.coin), eq(hmItems.epoch, epoch)))
    .orderBy(desc(hmScores.median))

  const subjects = [...new Set(scored.map((s) => s.subject))]
  const bindings =
    subjects.length > 0
      ? await d
          .select({
            platform: hmBindings.platform,
            subject: hmBindings.subject,
            wallet: hmBindings.wallet,
          })
          .from(hmBindings)
          .where(inArray(hmBindings.subject, subjects))
      : []
  const walletOf = new Map(bindings.map((b) => [`${b.platform}:${b.subject}`, b.wallet]))

  // Claims that were NOT honoured, so an unpaid line can say why. The ones
  // that bound successfully need no explanation: the wallet is right there.
  const refused = await d
    .select({ subject: hmWalletClaims.subject, status: hmWalletClaims.status, note: hmWalletClaims.note })
    .from(hmWalletClaims)
    .where(and(eq(hmWalletClaims.coin, week.coin), eq(hmWalletClaims.epoch, epoch)))
    .orderBy(desc(hmWalletClaims.id))
  const noteFor = new Map<string, string>()
  for (const c of refused) {
    if (c.status === "bound" || c.status === "already_bound_same") continue
    if (c.note && !noteFor.has(c.subject)) noteFor.set(c.subject, c.note)
  }

  const allLines: RecordLine[] = scored.map((s) => ({
    handle: s.handle,
    link: s.link,
    score: s.score ?? 0,
    reason: s.reason ?? "Not yet judged.",
    status: s.itemStatus === "open" ? "open" : (s.status ?? "pending"),
    wallet: walletOf.get(`${s.platform}:${s.subject}`) ?? null,
    strippedBytes: s.strippedBytes,
    claimNote: noteFor.get(s.subject) ?? null,
  }))

  // Work still in flight is shown apart from the scores, because it has not
  // happened yet. A contributor seeing their open pull request here knows it
  // was noticed; seeing it scored would be a promise nobody can keep, since a
  // pull request can still be closed without merging.
  const inFlight = allLines.filter((l) => l.status === "open")

  // Only payable work is listed. A contribution whose author has no wallet
  // bound is still scored, still stored, and still counted below, but it is
  // not a line on the record: a list where most rows say "unpaid" reads as a
  // list of failures rather than a payout.
  const lines = allLines.filter((l) => l.wallet !== null && l.status !== "open")
  const unlistedCount = allLines.length - lines.length - inFlight.length

  const payouts = await d
    .select({
      wallet: hmLeaves.wallet,
      coinAmount: hmLeaves.coinAmount,
      usdcAmount: hmLeaves.usdcAmount,
      leafIndex: hmLeaves.leafIndex,
    })
    .from(hmLeaves)
    .where(and(eq(hmLeaves.coin, week.coin), eq(hmLeaves.epoch, epoch)))
    .orderBy(hmLeaves.leafIndex)

  let rules: string | null = null
  if (week.rulesVersionId != null) {
    const [v] = await d
      .select({ body: hmRuleVersions.body })
      .from(hmRuleVersions)
      .where(eq(hmRuleVersions.id, week.rulesVersionId))
    rules = v?.body ?? null
  }

  return {
    coin: week.coin,
    epoch,
    state: week.state,
    windowStart: week.windowStart,
    windowEnd: week.windowEnd,
    publishedAt: week.publishedAt,
    clockEnd: week.clockEnd,
    modelId: week.modelId,
    promptHash: week.promptHash,
    rules,
    lanes,
    lines,
    payouts,
    inFlight,
    unpaidCount: unlistedCount,
    unlistedCount,
  }
}

/** The newest week that has anything on it, for the page's default view. */
export async function getLatestWeek(): Promise<WeekRecord | null> {
  const weeks = await listWeeks(1)
  if (weeks.length === 0) return null
  return getWeek(weeks[0]!.coin, weeks[0]!.epoch)
}

export interface FomoToken {
  /** FOMO's own chain number. Solana is 1399811149. */
  networkId: number
  /** Lowercased contract address. */
  tokenAddress: string
  /** The berth coin these callouts earn for. */
  coin: string
  name?: string
}

/**
 * Every token whose FOMO callouts count, across all coins.
 *
 * Read from each coin's CURRENT rules version rather than from the version any
 * epoch froze. The bot is deciding what to archive from now on, and an archive
 * gap cannot be filled later: FOMO will not return those theses again. Scoring
 * still uses the frozen version, so a rules change cannot alter how a past week
 * was judged.
 *
 * Deduplicated, because two coins naming the same token would otherwise have
 * the bot sweep it twice for the same rows.
 */
export async function listFomoTokens(): Promise<FomoToken[]> {
  const d = db()
  if (!d) return []

  const rows = await d
    .select({ coin: hmRules.coin, sources: hmRuleVersions.sources })
    .from(hmRules)
    .innerJoin(hmRuleVersions, eq(hmRuleVersions.id, hmRules.currentVersionId))

  const seen = new Set<string>()
  const out: FomoToken[] = []

  for (const r of rows) {
    const sources = r.sources as { fomo?: Array<Record<string, unknown>> } | null
    for (const s of sources?.fomo ?? []) {
      const raw = String(s.tokenAddress ?? "").trim()
      // EVM addresses are hex and case-insensitive, so lowercasing normalises
      // them. Solana addresses are base58 and case-SENSITIVE: lowercasing one
      // does not normalise it, it produces a different and invalid address.
      const isEvm = /^0x[0-9a-fA-F]{40}$/.test(raw)
      const address = isEvm ? raw.toLowerCase() : raw

      // A rules row is creator-supplied. Anything that is not an address shape
      // is skipped rather than handed to the bot to put in a URL. Base58 has no
      // 0, O, I or l, which is most of what makes a typo detectable.
      if (!isEvm && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) continue

      const networkId = Number(s.networkId ?? 0)
      if (!Number.isInteger(networkId) || networkId <= 0) continue

      const key = `${networkId}:${address}`
      if (seen.has(key)) continue
      seen.add(key)

      out.push({
        networkId,
        tokenAddress: address,
        coin: r.coin,
        name: typeof s.name === "string" ? s.name : undefined,
      })
    }
  }

  return out
}
