import "server-only"

import { and, count, desc, eq, gt, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { coinComments } from "@/lib/db/schema"
import { getProfile, getProfiles } from "@/lib/profiles"
import { serverEnv } from "@/lib/server-env"

/**
 * Comment storage, on the same Railway Postgres the indexer uses.
 *
 * The indexer OWNS its own tables (Ponder manages them); we never touch those.
 * Comments live in one table of our own, in the default schema — nowhere near
 * the indexer's namespaced schema. Read-your-writes only; no joins against
 * indexed data.
 *
 * The table is created by `pnpm --filter web db:migrate` (drizzle-kit), NOT at
 * runtime — a web request must never issue DDL against a database another
 * service is writing to. See drizzle.config.ts for the tablesFilter rail.
 *
 * DATABASE_URL is Railway-internal in prod (postgres.railway.internal) and the
 * public proxy locally (DATABASE_PUBLIC_URL). Missing => comments degrade to
 * read-empty / write-unavailable rather than crashing the coin page.
 */

const URL = serverEnv.databaseUrl

let cached: ReturnType<typeof drizzle<{ coinComments: typeof coinComments }>> | null = null

function db() {
  if (!URL) return null
  if (!cached) {
    const client = postgres(URL, { max: 3, idle_timeout: 20, connect_timeout: 10 })
    cached = drizzle(client, { schema: { coinComments } })
  }
  return cached
}

export type Comment = {
  id: string
  author: string
  body: string
  createdAt: number
  /** The poster's holding of this coin when they posted, e.g. "22k". */
  balance: string | null
  /** Author's profile display name at read time, or null (falls back to address). */
  name: string | null
  /** Author's profile avatar (`ipfs://CID`) at read time, or null. */
  image: string | null
}

/** true when a DB is configured — the API returns 503 otherwise. */
export const COMMENTS_ENABLED = !!URL

const toUnix = (d: Date) => Math.floor(d.getTime() / 1000)

/** Newest-first comments for a coin. Empty array when the DB is unreachable. */
export async function listComments(coin: string, limit = 100): Promise<Comment[]> {
  const d = db()
  if (!d) return []
  try {
    const rows = await d
      .select({
        id: coinComments.id,
        author: coinComments.author,
        body: coinComments.body,
        createdAt: coinComments.createdAt,
        balance: coinComments.balance,
      })
      .from(coinComments)
      .where(eq(coinComments.coin, coin.toLowerCase()))
      .orderBy(desc(coinComments.createdAt))
      .limit(limit)
    // One batched profile lookup over the distinct authors in this page, so the
    // thread renders names/avatars without an N+1 (see origin plan R7, R10).
    const profiles = await getProfiles(rows.map((r) => r.author))
    return rows.map((r) => {
      const p = profiles.get(r.author.toLowerCase())
      return {
        id: String(r.id),
        author: r.author,
        body: r.body,
        createdAt: toUnix(r.createdAt),
        balance: r.balance,
        name: p?.name ?? null,
        image: p?.image ?? null,
      }
    })
  } catch (err) {
    // Degrade to an empty thread, but never silently — a missing table or a
    // pending migration looks identical to "no comments yet" from the UI.
    console.error("listComments failed", err)
    return []
  }
}

/** Insert a comment. Caller has already authenticated + validated `body`.
 *  `balance` is the poster's holding snapshot (null when unknown). */
export async function addComment(
  coin: string,
  author: string,
  body: string,
  balance: string | null = null
): Promise<Comment | null> {
  const d = db()
  if (!d) return null
  const [row] = await d
    .insert(coinComments)
    .values({ coin: coin.toLowerCase(), author, body, balance })
    .returning({ id: coinComments.id, createdAt: coinComments.createdAt })
  if (!row) return null
  // Attach the poster's own profile so the optimistic insert shows their
  // identity immediately, same as a reloaded thread would.
  const p = await getProfile(author)
  return {
    id: String(row.id),
    author,
    body,
    createdAt: toUnix(row.createdAt),
    balance,
    name: p?.name ?? null,
    image: p?.image ?? null,
  }
}

/** How many comments this author posted in the last `windowSec`. For rate limiting. */
export async function recentCommentCount(author: string, windowSec = 60): Promise<number> {
  const d = db()
  if (!d) return 0
  try {
    const [row] = await d
      .select({ n: count() })
      .from(coinComments)
      .where(
        and(
          eq(coinComments.author, author),
          gt(coinComments.createdAt, sql`now() - make_interval(secs => ${windowSec})`)
        )
      )
    return row?.n ?? 0
  } catch (err) {
    // Fail OPEN on the count, exactly as before: the rate limiter must not be
    // the reason a healthy DB blip stops all commenting.
    console.error("recentCommentCount failed", err)
    return 0
  }
}
