import assert from "node:assert/strict"

import { HM_EPOCH_SECONDS, HM_GENESIS } from "@workspace/contracts"

import { assertClockSafe, epochBounds, epochIndex, epochEnd, lastClosedEpoch } from "./clock.js"

/**
 * The clock, checked without a database or a network.
 *
 *   pnpm --filter agent check:clock
 */

/* ── genesis is a Monday midnight, which is what makes the boundary legible ── */

const genesis = new Date(HM_GENESIS * 1000)
assert.equal(genesis.getUTCDay(), 1, "genesis must be a Monday")
assert.equal(genesis.getUTCHours(), 0)
assert.equal(genesis.getUTCMinutes(), 0)
assert.equal(genesis.getUTCSeconds(), 0)
assert.equal(HM_EPOCH_SECONDS, 7 * 24 * 60 * 60, "an epoch is seven days")

/* ── the boundary is half-open, so one item lands on exactly one week ─────── */

assert.equal(epochIndex(HM_GENESIS), 0, "genesis itself is epoch 0")
assert.equal(epochIndex(HM_GENESIS + HM_EPOCH_SECONDS - 1), 0, "one second before the close")
assert.equal(epochIndex(HM_GENESIS + HM_EPOCH_SECONDS), 1, "the close belongs to the next epoch")

const b = epochBounds(7)
assert.equal(b.start.getTime(), (HM_GENESIS + 7 * HM_EPOCH_SECONDS) * 1000)
assert.equal(b.end.getTime(), b.start.getTime() + HM_EPOCH_SECONDS * 1000)
assert.equal(b.start.getUTCDay(), 1, "every epoch opens on a Monday")
assert.equal(epochEnd(7).getTime(), b.end.getTime())
assert.equal(epochBounds(8).start.getTime(), b.end.getTime(), "epochs are contiguous, no gap")

/* ── round trip, across a year, so no drift creeps in ─────────────────────── */

for (let i = 0; i < 60; i++) {
  const { start, end } = epochBounds(i)
  assert.equal(epochIndex(start.getTime() / 1000), i, `start of epoch ${i}`)
  assert.equal(epochIndex(end.getTime() / 1000 - 1), i, `last second of epoch ${i}`)
  assert.equal(epochIndex(end.getTime() / 1000), i + 1, `end of epoch ${i} rolls over`)
  assert.equal(start.getUTCDay(), 1, `epoch ${i} opens on a Monday`)
}

/* ── readers run on the last CLOSED epoch, never the open one ─────────────── */

const openAt = HM_GENESIS + 3 * HM_EPOCH_SECONDS + 100
assert.equal(epochIndex(openAt), 3, "the epoch in progress")
assert.equal(lastClosedEpoch(openAt), 2, "readers work on the week that finished")
assert.equal(lastClosedEpoch(HM_GENESIS), null, "nothing has closed at genesis")
assert.equal(lastClosedEpoch(HM_GENESIS - 1), null, "nor before it")

/* ── a compressed clock is a test tool and must never reach a real chain ──── */

const saved = process.env.HM_EPOCH_SECONDS_OVERRIDE
try {
  delete process.env.HM_EPOCH_SECONDS_OVERRIDE
  assertClockSafe({ nodeEnv: "production", chainId: 5042002 })

  process.env.HM_EPOCH_SECONDS_OVERRIDE = "60"
  assertClockSafe({ nodeEnv: "test", chainId: 31337 })
  assert.equal(epochIndex(HM_GENESIS + 120), 2, "the override actually shortens the epoch")

  assert.throws(
    () => assertClockSafe({ nodeEnv: "production", chainId: 31337 }),
    /compressed epoch clock/,
    "refuses in production"
  )
  assert.throws(
    () => assertClockSafe({ nodeEnv: "development", chainId: 5042002 }),
    /compressed epoch clock/,
    "refuses on Arc"
  )

  process.env.HM_EPOCH_SECONDS_OVERRIDE = "0"
  assert.throws(() => epochIndex(0), /positive integer/, "rejects a nonsense override")
} finally {
  if (saved === undefined) delete process.env.HM_EPOCH_SECONDS_OVERRIDE
  else process.env.HM_EPOCH_SECONDS_OVERRIDE = saved
}

console.log("clock check passed")
