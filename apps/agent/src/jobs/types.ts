import type { Db } from "@workspace/db"

/**
 * What a handler is allowed to say when it finishes.
 *
 * The third outcome is the one that matters. Most of what this worker does is
 * waiting on something outside itself: every venue read, the USDC top-up, a
 * dispute window closing. If waiting counted as failure, a healthy epoch would
 * burn its five attempts and park itself in `needs_operator` while nothing was
 * actually wrong. So `wait` is a distinct answer that leaves the attempt count
 * alone, and only `failed` counts toward giving up.
 *
 * It also removes the need for anything to signal anything. An operator who
 * skips a stuck venue does not have to wake a job; the next poll sees the row.
 */
export type JobOutcome =
  | { kind: "done"; note?: string }
  | { kind: "failed"; error: unknown }
  | { kind: "wait"; until: Date; note?: string }

export const done = (note?: string): JobOutcome => ({ kind: "done", note })
export const failed = (error: unknown): JobOutcome => ({ kind: "failed", error })
export const wait = (until: Date, note?: string): JobOutcome => ({ kind: "wait", until, note })

/** Wait a number of seconds from now. */
export const waitFor = (seconds: number, note?: string): JobOutcome =>
  wait(new Date(Date.now() + seconds * 1000), note)

/** One row of `hm_jobs`, as a handler sees it. */
export interface JobRow {
  id: bigint
  type: string
  coin: string
  epoch: number
  key: string
  attempts: number
  payload: unknown
}

export interface JobContext {
  db: Db
  job: JobRow
  /** Identifies this worker in `locked_by`, for anyone reading the table. */
  workerId: string
}

export type JobHandler = (ctx: JobContext) => Promise<JobOutcome>

/**
 * How long a handler may hold its lease, per job type.
 *
 * The lease is what lets a second worker pick up after one dies mid-handler. Too
 * short and a slow-but-healthy run gets its work duplicated; too long and a
 * crashed job sits idle. Handlers are written so a duplicate run is safe anyway
 * (unique keys, conditional updates), so these lean generous.
 */
export const DEFAULT_LEASE_SECONDS = 120

/** Backoff after a failure: 30s, 2m, 8m, 32m, then give up. */
export function backoffSeconds(attempt: number): number {
  return Math.min(30 * 4 ** Math.max(0, attempt - 1), 2 * 60 * 60)
}

/** Failures before a job stops retrying and asks for a human. */
export const MAX_ATTEMPTS = 5

/**
 * Global jobs have no coin, but a NULL would defeat the unique index that keeps
 * them single: NULLs are distinct in Postgres, so two `epoch_start` rows for the
 * same week would both be allowed. The zero address stands in instead.
 */
export const GLOBAL_COIN = "0x0000000000000000000000000000000000000000"
