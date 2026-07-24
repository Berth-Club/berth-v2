import "server-only"

import postgres from "postgres"

/**
 * Comment storage, on the same Railway Postgres the indexer uses.
 *
 * The indexer OWNS its own tables (Ponder manages them); we never touch those.
 * Comments live in one table of our own, created on first use, in the default
 * schema — nowhere near the indexer's namespaced schema. Read-your-writes only;
 * no joins against indexed data.
 *
 * DATABASE_URL is Railway-internal in prod (postgres.railway.internal) and the
 * public proxy locally (DATABASE_PUBLIC_URL). Missing => comments degrade to
 * read-empty / write-unavailable rather than crashing the coin page.
 */

const URL = process.env.DATABASE_URL

let sql: ReturnType<typeof postgres> | null = null
let ready: Promise<void> | null = null

function db() {
  if (!URL) return null
  if (!sql) {
    sql = postgres(URL, { max: 3, idle_timeout: 20, connect_timeout: 10 })
  }
  return sql
}

/** Create the table once per process. Idempotent. */
async function ensure(s: ReturnType<typeof postgres>) {
  if (!ready) {
    ready = s`
      CREATE TABLE IF NOT EXISTS coin_comments (
        id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        coin       text NOT NULL,
        author     text NOT NULL,
        body       text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `.then(
      () => s`CREATE INDEX IF NOT EXISTS coin_comments_coin_idx ON coin_comments (coin, created_at DESC)`.then(() => {})
    )
  }
  return ready
}

export type Comment = {
  id: string
  author: string
  body: string
  createdAt: number
}

/** true when a DB is configured — the API returns 503 otherwise. */
export const COMMENTS_ENABLED = !!URL

/** Newest-first comments for a coin. Empty array when the DB is unreachable. */
export async function listComments(coin: string, limit = 100): Promise<Comment[]> {
  const s = db()
  if (!s) return []
  try {
    await ensure(s)
    const rows = await s<{ id: string; author: string; body: string; created_at: Date }[]>`
      SELECT id, author, body, created_at
      FROM coin_comments
      WHERE coin = ${coin.toLowerCase()}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
    return rows.map((r) => ({
      id: String(r.id),
      author: r.author,
      body: r.body,
      createdAt: Math.floor(new Date(r.created_at).getTime() / 1000),
    }))
  } catch {
    return []
  }
}

/** Insert a comment. Caller has already authenticated + validated `body`. */
export async function addComment(coin: string, author: string, body: string): Promise<Comment | null> {
  const s = db()
  if (!s) return null
  await ensure(s)
  const [row] = await s<{ id: string; created_at: Date }[]>`
    INSERT INTO coin_comments (coin, author, body)
    VALUES (${coin.toLowerCase()}, ${author}, ${body})
    RETURNING id, created_at
  `
  if (!row) return null
  return {
    id: String(row.id),
    author,
    body,
    createdAt: Math.floor(new Date(row.created_at).getTime() / 1000),
  }
}

/** How many comments this author posted in the last `windowSec`. For rate limiting. */
export async function recentCommentCount(author: string, windowSec = 60): Promise<number> {
  const s = db()
  if (!s) return 0
  try {
    await ensure(s)
    const [row] = await s<{ n: string }[]>`
      SELECT count(*)::text AS n
      FROM coin_comments
      WHERE author = ${author} AND created_at > now() - ${`${windowSec} seconds`}::interval
    `
    return row ? Number(row.n) : 0
  } catch {
    return 0
  }
}
