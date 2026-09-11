import postgres from "postgres"

import type { LaneItem, LaneResult, ReaderContext } from "./types.js"

/**
 * Callouts on FOMO, read from the archive a separate bot already fills.
 *
 * FOMO has no public API. Its backend sits behind Cloudflare and a short-lived
 * Privy bearer token held in localStorage, so a plain HTTP client gets 403 no
 * matter what headers it sends. The callout bot solves that by driving a real
 * logged-in browser and borrowing the app's own Authorization header, and it
 * writes every thesis it sees into a Postgres `events` table before any alert
 * filter runs.
 *
 * So this reader does not talk to FOMO at all. It reads that table. That is the
 * right shape for more reasons than convenience: the payout path never depends
 * on someone else's private interface staying up, a browser session expiring
 * cannot cost a week's payouts, and the archive keeps events that the API will
 * not return again afterwards.
 *
 * The cost is that another service's schema is now a dependency. Only the
 * columns below are read, and a missing one fails the lane with a message that
 * names it rather than quietly reading nulls into a payout.
 */

/** FOMO's own word for a callout. Swaps are archived too and are not work. */
const THESIS = "thesis"
const SOURCE = "fomo"

/**
 * Most callouts one author can be paid for in a week.
 *
 * A callout costs nothing to post, unlike a pull request that a maintainer had
 * to merge. Without a cap, the cheapest way to earn is to post fifty times.
 */
const MAX_PER_AUTHOR = 5

export interface FomoReaderOptions {
  /** The callout bot's Postgres. Separate database, separate pool. */
  archiveUrl?: string
  /** Injected in checks so the reader runs without a database. */
  query?: FomoQuery
}

export interface FomoRow {
  event_id: string
  created_at: Date | null
  username: string | null
  subject: string | null
  text: string | null
  token_address: string | null
  network_id: string | number | null
}

export type FomoQuery = (args: {
  tokens: readonly string[]
  start: Date
  end: Date
}) => Promise<FomoRow[]>

let pool: ReturnType<typeof postgres> | null = null

/** One lazily-opened read-only pool, small: this runs once a week per coin. */
function archive(url: string) {
  if (!pool) {
    pool = postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 10 })
  }
  return pool
}

function makeQuery(url: string): FomoQuery {
  return async ({ tokens, start, end }) => {
    const sql = archive(url)
    // Lowercased on both sides: EVM addresses arrive in mixed case from some
    // sources and a case-sensitive match would silently find nothing, which
    // looks exactly like a quiet week.
    return (await sql`
      select
        event_id,
        created_at,
        username,
        raw->>'userId'                as subject,
        raw->'comment'->>'comment'    as text,
        token_address,
        network_id
      from events
      where source = ${SOURCE}
        and kind = ${THESIS}
        and created_at >= ${start}
        and created_at < ${end}
        and lower(token_address) = any(${tokens as string[]})
      order by created_at asc
    `) as unknown as FomoRow[]
  }
}

export function makeFomoReader(opts: FomoReaderOptions = {}) {
  const query = opts.query ?? (opts.archiveUrl ? makeQuery(opts.archiveUrl) : null)

  return async function readFomo(ctx: ReaderContext): Promise<LaneResult> {
    const sources = ctx.sources.fomo ?? []
    if (sources.length === 0) {
      return { status: "ok", items: [], reason: "no FOMO tokens in this coin's rules" }
    }
    if (!query) {
      // Degrade the lane, never the week. An unconfigured archive is an
      // operator problem, and the record says so instead of showing a coin
      // whose callouts silently stopped counting.
      return {
        status: "failed",
        items: [],
        reason: "not configured: FOMO_ARCHIVE_DATABASE_URL is unset",
      }
    }

    const tokens = sources.map((s) => s.tokenAddress.toLowerCase())

    let rows: FomoRow[]
    try {
      rows = await query({ tokens, start: ctx.window.start, end: ctx.window.end })
    } catch (error) {
      const message = (error as Error).message
      // A column that vanished from the other service's schema is the failure
      // worth naming, because the fix is a conversation, not a retry.
      return {
        status: "failed",
        items: [],
        reason: /column .* does not exist/i.test(message)
          ? `the callout archive's schema changed: ${message}`
          : `cannot read the callout archive: ${message}`,
      }
    }

    const items: LaneItem[] = []
    const perAuthor = new Map<string, number>()
    const partials: string[] = []
    let skippedNoAuthor = 0
    let cappedAuthors = 0

    for (const row of rows) {
      // Keyed on the immutable id, never the handle. A handle can be renamed
      // onto someone else, and a payout that followed the name would pay a
      // stranger for this person's work.
      if (!row.subject) {
        skippedNoAuthor++
        continue
      }
      if (!row.created_at) continue
      if (!row.text || row.text.trim().length === 0) continue

      const seen = perAuthor.get(row.subject) ?? 0
      if (seen >= MAX_PER_AUTHOR) {
        cappedAuthors++
        continue
      }
      perAuthor.set(row.subject, seen + 1)

      items.push({
        platform: "fomo",
        platformUserId: row.subject,
        platformHandle: row.username ?? undefined,
        externalId: row.event_id,
        link: row.username ? `https://fomo.family/profile/${row.username}` : undefined,
        // Raw on purpose: hygiene runs once, in the lane job, so the rule
        // "nothing author-written is stored uncleaned" holds for every lane.
        content: row.text,
        createdAt: row.created_at,
        meta: { tokenAddress: row.token_address, networkId: row.network_id },
      })

      if (items.length >= ctx.cap) {
        partials.push(`stopped at the ${ctx.cap} item cap`)
        break
      }
    }

    if (skippedNoAuthor > 0) {
      // Worth reporting rather than swallowing: an archive full of rows with
      // no author id means the bot's session was anonymous, and its feed
      // returns unnamed aggregates until the account follows people.
      partials.push(`${skippedNoAuthor} callout(s) had no author id and were skipped`)
    }
    if (cappedAuthors > 0) {
      partials.push(`${cappedAuthors} callout(s) over the ${MAX_PER_AUTHOR} per author cap`)
    }

    return partials.length > 0
      ? { status: "partial", items, reason: partials.join("; ") }
      : { status: "ok", items }
  }
}
