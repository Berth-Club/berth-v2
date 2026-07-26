/**
 * Pins the decimal boundary that this whole app rests on.
 *
 *   node --experimental-strip-types lib/chain.selfcheck.ts
 *
 * Worth a check because getting it wrong is not loud. A launch token has 18
 * decimals and USDC has 6, so a tick is USDC-units-per-token-WEI — 1e-12 of the
 * dollar price of a whole token. Drop the 1e12 and prices render as a plausible
 * tiny number instead of an obvious error, and an $8,618 market cap silently
 * becomes $0.0000000086.
 *
 * Ground truth is the deployed factory's curve preset 0 (getCurveConfig(0) =>
 * initialTick -439000, graduationThreshold 8787e6): a ~$8,618 opening market cap
 * graduating at $8,787 with ~50.48% of supply sold, and a 2% dev-buy cap costing
 * ~$175.89.
 */
import assert from "node:assert/strict"

import { priceUsdFromTick, coinIsToken0, toCoinTick, USDC, NATIVE_PER_USDC } from "./chain.ts"

const SUPPLY = 100_000_000_000 // 100B, a contract constant
const INITIAL_TICK = -439_000 // preset 0, verified on the deployed factory
const GRADUATION_USD = 8_787

const close = (a: number, b: number, tol: number, msg: string) =>
  assert.ok(Math.abs(a - b) / b < tol, `${msg}: got ${a}, expected ~${b}`)

// --- the shipped curve, reproduced from the tick alone
const openingMcap = priceUsdFromTick(INITIAL_TICK) * SUPPLY
close(openingMcap, 8618.38, 0.001, "opening market cap")

const f = GRADUATION_USD / (GRADUATION_USD + openingMcap)
close(f * 100, 50.48, 0.001, "fraction of supply sold at graduation")

close((openingMcap * 0.02) / 0.98, 175.89, 0.001, "cost of a 2% dev buy")

// --- the 1e12 shift itself. An 18-decimal quote asset would put this same
// dollar price 276,324 ticks higher; that gap IS the decimal difference.
//
// Ticks are discrete, so no integer expresses 1e12 exactly: the true value is
// 276,324.0264 and rounding leaves ~2.6e-6 of relative error. That is a property
// of tick space, not a defect, hence the tolerance. (Getting this wrong in the
// other direction -- asserting exactness -- is what this comment exists to stop
// someone "fixing".)
const shift = Math.round(Math.log(1e12) / Math.log(1.0001))
assert.equal(shift, 276_324, "1e12 expressed in ticks")
close(priceUsdFromTick(INITIAL_TICK + shift), priceUsdFromTick(INITIAL_TICK) * 1e12, 1e-5, "shift is 1e12 to within tick granularity")

// --- native/ERC20 are one balance at a fixed ratio
assert.equal(NATIVE_PER_USDC, 10n ** 12n)
assert.equal(1_000_000_000_000_000_000n / NATIVE_PER_USDC, 1_000_000n, "1e18 native === 1e6 ERC20 === $1")
assert.equal(USDC.decimals, 6)

// --- ordering, against the real USDC predeploy address
assert.equal(coinIsToken0("0x0000000000000000000000000000000000000001"), true, "below 0x3600 => token0")
assert.equal(coinIsToken0("0xffffffffffffffffffffffffffffffffffffffff"), false, "above 0x3600 => token1")
assert.equal(coinIsToken0("0x35ffffffffffffffffffffffffffffffffffffff"), true, "one below the boundary")
assert.equal(coinIsToken0("0x3600000000000000000000000000000000000001"), false, "one above the boundary")
assert.equal(coinIsToken0(USDC.address), false, "equal is not below")

// Coin-space normalisation is a sign flip, and its own inverse.
assert.equal(toCoinTick(-439_000, true), -439_000)
assert.equal(toCoinTick(439_000, false), -439_000)
for (const [t, is0] of [
  [-439_000, true],
  [439_000, false],
] as const) {
  assert.equal(toCoinTick(toCoinTick(t, is0), is0), t, "toCoinTick is an involution")
}

// A token1 coin prices the reciprocal, so the SAME dollar price must come out
// of the mirrored tick. This is the bug that shows as an upside-down chart.
close(
  priceUsdFromTick(toCoinTick(439_000, false)),
  priceUsdFromTick(toCoinTick(-439_000, true)),
  1e-9,
  "both orderings price identically"
)

console.log("chain.ts: all checks passed")
