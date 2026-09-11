import { hmJobs, type Db } from "@workspace/db"
import { and, eq, sql } from "drizzle-orm"

import { redact } from "../redact.js"
import {
  backoffSeconds,
  DEFAULT_LEASE_SECONDS,
  MAX_ATTEMPTS,
  type JobHandler,
  type JobOutcome,
  type JobRow,
} from "./types.js"

/**
 * The worker's only loop: claim one job, run it outside the claim, record what
 * happened.
 *
 * Three decisions hold this together.
 *
 * The claim is its own short transaction. Running a handler inside the
 * transaction that claimed it would hold a row lock and a connection for the
 * whole run, and a scoring batch waiting on a model can take minutes. Worse, a
 * hard timeout cannot roll back a transaction from outside, so the "abandon it"
 * path would leave the lock held anyway.
 *
 * `FOR UPDATE SKIP LOCKED` rather than one global advisory lock. Two workers can
 * then run different jobs at the same time instead of queueing behind the
 * slowest one, which matters the moment more than one coin is live.
 *
 * `lockUntil` is a lease, not a lock. A worker that dies mid-handler cannot
 * release anything, so the row has to become claimable on its own. That means a
 * handler can run twice, and every handler is written for it: unique keys make
 * inserts idempotent and state changes are conditional on the state they expect
 * to replace, so the late write from an abandoned run is simply refused.
 */

export interface LoopOptions {
  db: Db
  handlers: Record<string, JobHandler>
  workerId: string
  /** Seconds between polls when there is nothing to do. */
  pollSeconds?: number
  /** Per-type lease length. Falls back to DEFAULT_LEASE_SECONDS. */
  leaseSeconds?: Record<string, number>
  log?: (level: "info" | "error", msg: string, meta?: Record<string, unknown>) => void
}

const defaultLog: NonNullable<LoopOptions["log"]> = (level, msg, meta) => {
  const line = meta ? `${msg} ${JSON.stringify(meta)}` : msg
  if (level === "error") console.error(line)
  else console.log(line)
}

/**
 * Take the next due job and mark it running, in one short transaction.
 *
 * Returns null when nothing is due, which is the normal case most ticks.
 */
export async function claimOne(
  db: Db,
  workerId: string,
  leaseSeconds: Record<string, number> = {}
): Promise<JobRow | null> {
  const rows = await db.execute<{
    id: string
    type: string
    coin: string
    epoch: number
    key: string
    attempts: number
    payload: unknown
  }>(sql`
    with due as (
      select id
      from ${hmJobs}
      where status in ('pending', 'running')
        and run_after <= now()
        -- 'running' is claimable again only once its lease has expired, which is
        -- how a job survives the worker that was holding it being killed.
        and (status = 'pending' or lock_until is null or lock_until < now())
      order by run_after
      for update skip locked
      limit 1
    )
    update ${hmJobs} j
    set status = 'running',
        locked_by = ${workerId},
        lock_until = now() + make_interval(secs => ${DEFAULT_LEASE_SECONDS})
    from due
    where j.id = due.id
    returning j.id, j.type, j.coin, j.epoch, j.key, j.attempts, j.payload
  `)

  const row = rows[0]
  if (!row) return null

  // The lease depends on the job type, which is only known after the claim.
  const lease = leaseSeconds[row.type]
  if (lease && lease !== DEFAULT_LEASE_SECONDS) {
    await db.execute(sql`
      update ${hmJobs}
      set lock_until = now() + make_interval(secs => ${lease})
      where id = ${row.id}
    `)
  }

  return {
    id: BigInt(row.id),
    type: row.type,
    coin: row.coin,
    epoch: row.epoch,
    key: row.key,
    attempts: row.attempts,
    payload: row.payload,
  }
}

/**
 * Write down how a job ended.
 *
 * Every update names the id AND the worker that holds the lease, so a worker
 * whose lease expired while it was running cannot overwrite the result of the
 * worker that legitimately took the job over.
 */
export async function complete(
  db: Db,
  job: JobRow,
  workerId: string,
  outcome: JobOutcome
): Promise<void> {
  const heldByUs = and(eq(hmJobs.id, job.id), eq(hmJobs.lockedBy, workerId))

  if (outcome.kind === "done") {
    await db
      .update(hmJobs)
      .set({ status: "done", lockedBy: null, lockUntil: null, lastError: null })
      .where(heldByUs)
    return
  }

  if (outcome.kind === "wait") {
    // Waiting is not failing: attempts are untouched, so a job can wait on a
    // stuck lane all week without exhausting its retries.
    await db
      .update(hmJobs)
      .set({
        status: "pending",
        runAfter: outcome.until,
        lockedBy: null,
        lockUntil: null,
        lastError: null,
      })
      .where(heldByUs)
    return
  }

  const attempts = job.attempts + 1
  const giveUp = attempts >= MAX_ATTEMPTS
  await db
    .update(hmJobs)
    .set({
      status: giveUp ? "needs_operator" : "pending",
      attempts,
      runAfter: new Date(Date.now() + backoffSeconds(attempts) * 1000),
      lockedBy: null,
      lockUntil: null,
      lastError: redact(outcome.error),
    })
    .where(heldByUs)
}

/** Run one job if one is due. Returns false when the queue was empty. */
export async function tick(opts: LoopOptions): Promise<boolean> {
  const { db, handlers, workerId, leaseSeconds = {}, log = defaultLog } = opts

  const job = await claimOne(db, workerId, leaseSeconds)
  if (!job) return false

  const handler = handlers[job.type]
  if (!handler) {
    // An unknown type is a deploy problem, not a transient one. Park it.
    await complete(db, job, workerId, {
      kind: "failed",
      error: new Error(`no handler registered for job type "${job.type}"`),
    })
    log("error", "job has no handler", { type: job.type, coin: job.coin, epoch: job.epoch })
    return true
  }

  let outcome: JobOutcome
  try {
    outcome = await handler({ db, job, workerId })
  } catch (error) {
    outcome = { kind: "failed", error }
  }

  await complete(db, job, workerId, outcome)

  if (outcome.kind === "failed") {
    const attempts = job.attempts + 1
    log("error", attempts >= MAX_ATTEMPTS ? "job needs an operator" : "job failed, will retry", {
      type: job.type,
      coin: job.coin,
      epoch: job.epoch,
      key: job.key,
      attempts,
      error: redact(outcome.error),
    })
  }

  return true
}

/** Poll until stopped. Drains everything due before sleeping. */
export async function runLoop(
  opts: LoopOptions & { signal?: AbortSignal }
): Promise<void> {
  const pollMs = (opts.pollSeconds ?? 30) * 1000
  const log = opts.log ?? defaultLog
  log("info", "worker polling", { workerId: opts.workerId, pollSeconds: pollMs / 1000 })

  while (!opts.signal?.aborted) {
    try {
      // Drain rather than taking one per tick, so a backlog clears promptly.
      let ranSomething = true
      while (ranSomething && !opts.signal?.aborted) {
        ranSomething = await tick(opts)
      }
    } catch (error) {
      // The loop itself failing (a dropped connection, usually) must not stop
      // the worker: the next tick reconnects.
      log("error", "loop tick failed", { error: redact(error) })
    }
    await sleep(pollMs, opts.signal)
  }

  log("info", "worker stopped", { workerId: opts.workerId })
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
