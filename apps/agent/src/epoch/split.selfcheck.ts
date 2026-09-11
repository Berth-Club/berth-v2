import assert from "node:assert/strict"

import { splitPot } from "./split.js"

/**
 * The split, which is where a rounding mistake becomes someone's missing money.
 *
 *   pnpm --filter agent check:split
 */

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n)

/* ── the total paid always equals the pot, exactly ────────────────────────── */

{
  // The awkward case: three equal shares of a pot that does not divide by three.
  const r = splitPot(
    [
      { wallet: "0xaaa", score: 10 },
      { wallet: "0xbbb", score: 10 },
      { wallet: "0xccc", score: 10 },
    ],
    100n,
    0n
  )
  assert.equal(sum(r.shares.map((s) => s.coinAmount)), 100n, "not 99, not 101")
  assert.equal(r.coinTotal, 100n)
  assert.deepEqual(
    r.shares.map((s) => s.coinAmount).sort(),
    [33n, 33n, 34n].sort(),
    "the leftover unit goes to exactly one wallet"
  )
}

{
  // A pot far larger than a float could hold without losing the low digits.
  // This is the reason every amount in this file is a bigint.
  const huge = 115792089237316195423570985008687907853269984665640564039457584007913129639935n
  const r = splitPot(
    [
      { wallet: "0xaaa", score: 1 },
      { wallet: "0xbbb", score: 2 },
      { wallet: "0xccc", score: 7 },
    ],
    huge,
    0n
  )
  assert.equal(sum(r.shares.map((s) => s.coinAmount)), huge, "a uint256 pot still balances")
}

{
  // Many wallets, an awkward pot, unequal scores. The invariant is the point.
  const wallets = Array.from({ length: 37 }, (_, i) => ({
    wallet: `0x${String(i).padStart(40, "0")}`,
    score: (i % 9) + 1,
  }))
  const r = splitPot(wallets, 1_000_003n, 7n)
  assert.equal(sum(r.shares.map((s) => s.coinAmount)), 1_000_003n)
  assert.equal(sum(r.shares.map((s) => s.usdcAmount)), 7n, "a pot smaller than the crowd balances")
}

/* ── the share follows the score ──────────────────────────────────────────── */

{
  const r = splitPot(
    [
      { wallet: "0xaaa", score: 75 },
      { wallet: "0xbbb", score: 25 },
    ],
    1000n,
    400n
  )
  const a = r.shares.find((s) => s.wallet === "0xaaa")!
  const b = r.shares.find((s) => s.wallet === "0xbbb")!
  assert.equal(a.coinAmount, 750n)
  assert.equal(b.coinAmount, 250n)
  assert.equal(a.usdcAmount, 300n)
  assert.equal(b.usdcAmount, 100n)
}

/* ── the order is fixed, so the root is reproducible ──────────────────────── */

{
  const input = [
    { wallet: "0xCCC", score: 5 },
    { wallet: "0xaaa", score: 5 },
    { wallet: "0xBbB", score: 5 },
  ]
  const first = splitPot(input, 99n, 0n)
  const shuffled = splitPot([input[1]!, input[2]!, input[0]!], 99n, 0n)
  assert.deepEqual(
    first.shares.map((s) => [s.wallet, s.coinAmount.toString()]),
    shuffled.shares.map((s) => [s.wallet, s.coinAmount.toString()]),
    "row order in, identical leaves out: anyone must be able to rebuild the root"
  )
  assert.deepEqual(
    first.shares.map((s) => s.wallet),
    ["0xaaa", "0xbbb", "0xccc"],
    "sorted by address, and addresses are lowercased first"
  )
}

/* ── one wallet, several contributions in a week ──────────────────────────── */

{
  const r = splitPot(
    [
      { wallet: "0xaaa", score: 30 },
      { wallet: "0xAAA", score: 20 },
      { wallet: "0xbbb", score: 50 },
    ],
    100n,
    0n
  )
  assert.equal(r.shares.length, 2, "the same wallet in two cases is one leaf")
  assert.equal(r.shares.find((s) => s.wallet === "0xaaa")!.coinAmount, 50n, "its scores add up")
}

/* ── nothing to pay is an empty list, not an error ────────────────────────── */

assert.deepEqual(splitPot([], 100n, 100n).shares, [], "a week with no work pays nobody")
assert.deepEqual(
  splitPot([{ wallet: "0xaaa", score: 0 }], 100n, 100n).shares,
  [],
  "a zero score earns nothing, and the pot is simply not paid out"
)
assert.deepEqual(
  splitPot([{ wallet: "0xaaa", score: 10 }], 0n, 0n).shares,
  [],
  "an empty pot produces no leaves rather than leaves worth nothing"
)

/* ── a leaf worth nothing is dropped, because claiming it costs more ──────── */

{
  const many = Array.from({ length: 10 }, (_, i) => ({
    wallet: `0x${String(i).padStart(40, "0")}`,
    score: 1,
  }))
  const r = splitPot(many, 3n, 0n)
  assert.equal(r.shares.length, 3, "three units reach three wallets")
  assert.equal(r.dustedWallets.length, 7, "the rest are listed rather than given empty leaves")
  assert.ok(
    r.shares.every((s) => s.coinAmount > 0n || s.usdcAmount > 0n),
    "the leaf table's own CHECK refuses a row that is zero on both sides"
  )
  assert.equal(sum(r.shares.map((s) => s.coinAmount)), 3n, "and the pot is still fully paid")
}

console.log("split check passed")
