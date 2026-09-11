import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import { schema } from "./schema.js"

/**
 * One Postgres pool per process, shared by the web app and the agent.
 *
 * NO `server-only` import: the agent is a plain Node process outside Next, and
 * `server-only` throws there. The web app keeps its own `server-only` wrappers
 * in `lib/`, which is where that guard belongs.
 *
 * A missing URL returns null rather than throwing, so a missing database
 * degrades a feature to unavailable instead of stopping the process from
 * booting. That rule is in ARCHITECTURE.md and every caller already expects it.
 */

export type Db = ReturnType<typeof drizzle<typeof schema>>

const pools = new Map<string, Db>()

export function makeDb(url: string | undefined): Db | null {
  if (!url) return null
  const hit = pools.get(url)
  if (hit) return hit
  // max 3: the web app runs one long-lived instance and the agent another, and
  // Railway's Postgres plan counts connections, not processes.
  const client = postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 10 })
  const db = drizzle(client, { schema })
  pools.set(url, db)
  return db
}

/** Absolute path to the migrations folder, for anything that runs them. */
export const MIGRATIONS_DIR = new URL("../drizzle", import.meta.url).pathname

/**
 * Absolute path to the migration journal that ships with THIS build.
 *
 * The agent compares the journal it was built against with what the database
 * reports, and refuses to work while the two disagree. Resolving the path here
 * rather than at the call site means the file is always the one beside the code,
 * which is the whole point of the comparison.
 */
export const JOURNAL_PATH = new URL("../drizzle/meta/_journal.json", import.meta.url).pathname
