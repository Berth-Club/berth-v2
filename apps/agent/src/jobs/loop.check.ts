import assert from "node:assert/strict"

import { hmJobs, makeDb, TABLE_NAMES } from "@workspace/db"
import { eq, sql } from "drizzle-orm"

import { redact } from "../redact.js"
import { claimOne, tick } from "./loop.js"
import { done, failed, waitFor, type JobHandler } from "./types.js"

/**
 * The loop, against a real Postgres.
 *
 * `SKIP LOCKED`, lease expiry and the conditional completion are the three
 * things standing between this worker and a job running twice or a payout being
 * recorded by a process that had already lost its claim. None of them can be
 * checked without a database, so this is not mocked.
 *
 *   DATABASE_URL=postgres://…/throwaway pnpm --filter agent check:loop
 */

const COIN = "0x00000000000000000000000000000000000000bb"

const db = makeDb(process.env.DATABASE_URL)
if (!db) {
  console.error("DATABASE_URL is not set. Point it at a throwaway database.")
  process.exit(1)
}

const quiet = () => {}

async function reset() {
  await db!.execute(
    sql.raw(`truncate ${TABLE_NAMES.filter((t) => t.startsWith("hm_")).join(", ")} cascade`)
  )
}

async function seed(type: string, key = "", runAfter = new Date(Date.now() - 1000)) {
  const [row] = await db!
    .insert(hmJobs)
    .values({ type, coin: COIN, epoch: 1, key, status: "pending", runAfter })
    .returning({ id: hmJobs.id })
  return row!.id
}

async function read(id: bigint) {
  const [row] = await db!.select().from(hmJobs).where(eq(hmJobs.id, id))
  return row!
}

async function main() {
  /* ── a job runs once, and a second tick does not find it again ─────────── */

  await reset()
  let runs = 0
  const counting: JobHandler = async () => {
    runs++
    return done()
  }
  const id = await seed("counted")
  assert.equal(await tick({ db: db!, handlers: { counted: counting }, workerId: "w1", log: quiet }), true)
  assert.equal(runs, 1)
  assert.equal((await read(id)).status, "done")
  assert.equal(await tick({ db: db!, handlers: { counted: counting }, workerId: "w1", log: quiet }), false,
    "nothing left to claim")
  assert.equal(runs, 1)

  /* ── two workers, one job each: SKIP LOCKED must not hand out the same row ─ */

  await reset()
  await seed("a", "1")
  await seed("a", "2")
  const first = await claimOne(db!, "w1")
  const second = await claimOne(db!, "w2")
  assert.ok(first && second, "both workers get work")
  assert.notEqual(first!.id, second!.id, "and never the same row")
  assert.equal(await claimOne(db!, "w3"), null, "a third finds nothing")

  /* ── waiting is not failing ───────────────────────────────────────────── */

  await reset()
  const waitId = await seed("waiter")
  const waiting: JobHandler = async () => waitFor(300, "lane not read yet")
  await tick({ db: db!, handlers: { waiter: waiting }, workerId: "w1", log: quiet })
  const waited = await read(waitId)
  assert.equal(waited.status, "pending", "it comes back")
  assert.equal(waited.attempts, 0, "and has not spent an attempt")
  assert.ok(waited.runAfter.getTime() > Date.now() + 200_000, "scheduled for later")
  assert.equal(waited.lockedBy, null, "the lease is released")

  /* ── a failure retries, and the fifth one asks for a person ───────────── */

  await reset()
  const failId = await seed("failer")
  const failing: JobHandler = async () => failed(new Error("upstream said no"))
  for (let i = 1; i <= 5; i++) {
    await db!.update(hmJobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(hmJobs.id, failId))
    await tick({ db: db!, handlers: { failer: failing }, workerId: "w1", log: quiet })
    const row = await read(failId)
    assert.equal(row.attempts, i, `attempt ${i} recorded`)
    assert.equal(row.status, i < 5 ? "pending" : "needs_operator", `status after attempt ${i}`)
    assert.match(row.lastError ?? "", /upstream said no/, "the reason is kept")
  }
  // A parked job is not picked up again on its own.
  await db!.update(hmJobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(hmJobs.id, failId))
  assert.equal(await tick({ db: db!, handlers: { failer: failing }, workerId: "w1", log: quiet }), false,
    "needs_operator stays parked until a human resets it")

  /* ── an expired lease makes the row claimable again ───────────────────── */

  await reset()
  const leaseId = await seed("stuck")
  await claimOne(db!, "dead-worker")
  assert.equal(await claimOne(db!, "w2"), null, "not while the lease holds")
  await db!.update(hmJobs).set({ lockUntil: new Date(Date.now() - 1000) }).where(eq(hmJobs.id, leaseId))
  const taken = await claimOne(db!, "w2")
  assert.ok(taken, "once the lease expires another worker takes it over")

  /* ── and the worker that lost its claim cannot write the result ───────── */

  const { complete } = await import("./loop.js")
  await complete(db!, { ...taken!, attempts: 0 }, "dead-worker", done())
  assert.equal((await read(leaseId)).status, "running",
    "a late write from the abandoned run is refused")
  await complete(db!, { ...taken!, attempts: 0 }, "w2", done())
  assert.equal((await read(leaseId)).status, "done", "the holder's write lands")

  /* ── a job with no handler parks instead of spinning ──────────────────── */

  await reset()
  const orphanId = await seed("never_registered")
  await tick({ db: db!, handlers: {}, workerId: "w1", log: quiet })
  const orphan = await read(orphanId)
  assert.equal(orphan.attempts, 1)
  assert.match(orphan.lastError ?? "", /no handler registered/)

  /* ── a future job is not claimed early ────────────────────────────────── */

  await reset()
  await seed("later", "", new Date(Date.now() + 60_000))
  assert.equal(await claimOne(db!, "w1"), null, "run_after is respected")

  /* ── the paid RPC key never reaches the error column ──────────────────── */

  await reset()
  const saved = process.env.RPC_URL_PAID
  process.env.RPC_URL_PAID = "https://arc-mainnet.example.com/v2/SUPERSECRETKEY123456"
  try {
    const leakId = await seed("leaky")
    const leaky: JobHandler = async () => {
      throw new Error(`HTTP request failed: POST ${process.env.RPC_URL_PAID} returned 401`)
    }
    await tick({ db: db!, handlers: { leaky }, workerId: "w1", log: quiet })
    const stored = (await read(leakId)).lastError ?? ""
    assert.ok(!stored.includes("SUPERSECRETKEY123456"), "the key is gone")
    assert.match(stored, /\[redacted\]/, "and visibly replaced")
    assert.match(stored, /401/, "while the useful part survives")
  } finally {
    if (saved === undefined) delete process.env.RPC_URL_PAID
    else process.env.RPC_URL_PAID = saved
  }

  // A bare private key is redacted wherever it appears.
  assert.match(redact(new Error(`signing with 0x${"a".repeat(64)}`)), /\[redacted-key\]/)
  assert.match(redact(new Error("Bearer abcdefghijklmnop failed")), /\[redacted\]/)

  console.log("loop check passed")
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
