import { readFile } from "node:fs/promises"

import type { Db } from "@workspace/db"
import { sql } from "drizzle-orm"

/**
 * Refuse to work against a schema this build does not match.
 *
 * The web app migrates; the agent never does. Two processes racing on the same
 * `CREATE TABLE` is a boot failure for both, and the rule is written down in
 * AGENTS.md. But Railway deploys the two services independently, so for a few
 * minutes after any schema change one of them is running against the other's
 * idea of the database. An agent that starts anyway would write rows the new
 * columns expect, or read columns that are not there yet.
 *
 * So the gate is equality, not "at least": behind means the web has not migrated
 * yet, ahead means this build is the old one and the web has moved on. Both mean
 * wait. That is stricter than necessary, and it buys something worth more than
 * the idle minutes: nobody has to reason about which migrations are
 * backwards-compatible with which build.
 *
 * Drizzle's `__drizzle_migrations` stores a hash and a `created_at` that is the
 * journal entry's `when`, so the journal shipped in this build is what we
 * compare against.
 */

export interface MigrationState {
  /** The last `when` in the journal this build shipped with. */
  expected: number
  /** The newest `created_at` in the database, or null if nothing has migrated. */
  actual: number | null
  status: "ready" | "behind" | "ahead" | "empty"
}

/** Read the last journal entry from the db package that this build resolved. */
export async function expectedVersion(journalPath: string): Promise<number> {
  const raw = await readFile(journalPath, "utf8")
  const journal = JSON.parse(raw) as { entries: Array<{ when: number; tag: string }> }
  const last = journal.entries.at(-1)
  if (!last) throw new Error(`migration journal at ${journalPath} has no entries`)
  return last.when
}

export async function readState(db: Db, journalPath: string): Promise<MigrationState> {
  const expected = await expectedVersion(journalPath)

  let actual: number | null = null
  try {
    const rows = await db.execute<{ latest: string | null }>(
      sql`select max(created_at)::text as latest from drizzle.__drizzle_migrations`
    )
    const raw = rows[0]?.latest
    actual = raw == null ? null : Number(raw)
  } catch {
    // The table does not exist yet: the web app has never migrated this database.
    return { expected, actual: null, status: "empty" }
  }

  if (actual === null) return { expected, actual, status: "empty" }
  if (actual === expected) return { expected, actual, status: "ready" }
  return { expected, actual, status: actual < expected ? "behind" : "ahead" }
}

export interface WaitOptions {
  db: Db
  journalPath: string
  /** Seconds between checks. */
  pollSeconds?: number
  /** Log at error level once this many seconds have passed. */
  alarmAfterSeconds?: number
  signal?: AbortSignal
  log?: (level: "info" | "error", msg: string, meta?: Record<string, unknown>) => void
  now?: () => number
}

/**
 * Block until the database matches this build.
 *
 * The alarm matters as much as the waiting. If the web app's migration fails, it
 * still boots (its start script joins the two commands with `;`), so the site
 * looks healthy while the agent waits forever and Monday never runs. A quiet
 * wait would hide that. After fifteen minutes this starts logging at error
 * level, which is what the alerting watches.
 */
export async function waitForMigrations(opts: WaitOptions): Promise<void> {
  const {
    db,
    journalPath,
    pollSeconds = 5,
    alarmAfterSeconds = 15 * 60,
    signal,
    now = Date.now,
    log = (level, msg, meta) => {
      const line = meta ? `${msg} ${JSON.stringify(meta)}` : msg
      if (level === "error") console.error(line)
      else console.log(line)
    },
  } = opts

  const startedAt = now()
  let alarmed = false
  let announced = false

  for (;;) {
    if (signal?.aborted) return
    const state = await readState(db, journalPath)
    if (state.status === "ready") {
      if (announced) log("info", "migrations match, starting work", { version: state.expected })
      return
    }

    const waitedSeconds = Math.round((now() - startedAt) / 1000)
    const meta = {
      status: state.status,
      expected: state.expected,
      actual: state.actual,
      waitedSeconds,
    }

    if (!alarmed && waitedSeconds >= alarmAfterSeconds) {
      alarmed = true
      log("error", "still waiting for migrations after 15 minutes, the web app may have failed to migrate", meta)
    } else {
      log("info", "waiting for migrations", meta)
    }
    announced = true

    await sleep(pollSeconds * 1000, signal)
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(t)
      resolve()
    }, { once: true })
  })
}
