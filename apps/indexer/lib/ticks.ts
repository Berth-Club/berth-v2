// Tick-space math for berth.club pools.
//
// Pure + dependency-free on purpose: this is the logic that a wrong assumption
// already burned us on once, and no live coin has traded yet to exercise it, so
// it carries its own self-check. Run it with:  node lib/ticks.ts
//
// Lives outside src/ because Ponder executes every file under src/ as an
// indexing module (except src/api/). This is a library, not a handler.

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

/**
 * USDC on Arc Testnet (5042002) — the predeploy, 6 decimals, the quote
 * asset of every pool. Must stay in lockstep with LaunchpadConstants.USDC in
 * arc-launchpad and USDC.address in the web app.
 *
 * Arc has no wrapped native; this predeploy IS the quote asset. 6 decimals in
 * this ERC20 view, 18 in the native view — one balance behind two interfaces.
 *
 * Lowercase: {isCoinToken0} compares raw strings.
 */
export const WRAPPED_NATIVE = "0x3600000000000000000000000000000000000000";

/**
 * The top of every launch range. v1.3 emits only `initialTick` and always runs
 * the position to this bound, so there is no emitted tickUpper to read — the
 * indexer supplies it. Mirrors MAX_USABLE_TICK in BerthClubLaunchFactory:
 * TickMath.MAX_TICK rounded inward to a multiple of the 200 tick spacing.
 */
export const MAX_USABLE_TICK = 887200;

/**
 * Which side of the pool the coin landed on.
 *
 * Uniswap sorts pool tokens by address, and the DEPLOYED factory does NOT
 * salt-mine the coin below the quote asset (whatever the contracts repo does) —
 * when the coin sorts above it, it mirrors the tick range instead.
 *
 * On Robinhood this was lopsided: WETH9 was 0x0Bd7…, so the coin was token0
 * only ~5% of the time. Arc's WUSDC is mid-range (0x911b…), so it is close to a
 * coin flip. The minority branch is no longer the minority — never assume it,
 * always ask.
 */
export function isCoinToken0(token: string): boolean {
  // Equal-length lowercase hex compares lexicographically the same as by uint160.
  return token.toLowerCase() < WRAPPED_NATIVE;
}

/**
 * Pool-space tick -> COIN-SPACE tick. THE ONE PLACE ordering is normalised.
 *
 * Pool space measures token1 per token0. When the coin is token1 that reads
 * "coin per NATIVE", which runs BACKWARDS: buying the coin makes it dearer, so
 * fewer coin per NATIVE, so the tick goes DOWN — such a pool starts at its upper
 * tick and graduates at its lower one.
 *
 * Negating flips it back to "NATIVE per whole coin" (both tokens are 18 decimals,
 * so no decimal shift). In coin space the TokenLaunched ticks apply verbatim for
 * BOTH orderings: price rises with tick, graduation is always tick >= tickUpper.
 */
export function toCoinTick(poolTick: number, coinIsToken0: boolean): number {
  return coinIsToken0 ? poolTick : -poolTick;
}

/**
 * Coin-space launch range -> the REAL pool/NFPM range.
 * Negate AND swap: negation reverses the ordering, so lower/upper trade places.
 */
export function poolRange(
  tickLower: number,
  tickUpper: number,
  coinIsToken0: boolean,
): { poolTickLower: number; poolTickUpper: number } {
  return coinIsToken0
    ? { poolTickLower: tickLower, poolTickUpper: tickUpper }
    : { poolTickLower: -tickUpper, poolTickUpper: -tickLower };
}

/** 0–1 progress of a COIN-SPACE `tick` through [lower, upper]. Clamped. */
export function curveProgress(tick: number, lower: number, upper: number): number {
  if (upper <= lower) return 0;
  const p = (tick - lower) / (upper - lower);
  return Math.min(1, Math.max(0, p));
}

/**
 * Percent change between two COIN-SPACE ticks.
 *
 * price = 1.0001^tick, and we only need the ratio of two prices, which collapses
 * to 1.0001^(now-then) — so the huge exponentials never get evaluated.
 */
export function pctChange(tickNow: number, tickThen: number): number {
  return (Math.pow(1.0001, tickNow - tickThen) - 1) * 100;
}

/**
 * Self-check. The tick-space assertions below are ground truth read off chain
 * 4663 on 2026-07-16 for $SMOKE (pool 0x12ff275AE94AD8b7BD8c10C4d466394Db40101D1,
 * NFPM position 163160). That maths is chain-independent — only the ORDERING
 * fixtures had to change for Arc, because ordering is the one thing that depends
 * on the quote asset's address.
 */
function main(): void {
  // Ordering, against Arc's WUSDC (0x911b…). Synthetic addresses that straddle
  // it, rather than a real coin: no berth.club coin exists on Arc yet, and
  // pinning to one would re-break this the next time the chain moves.
  assert.equal(isCoinToken0("0x0000000000000000000000000000000000000001"), true, "far below => token0");
  assert.equal(isCoinToken0("0xffffffffffffffffffffffffffffffffffffffff"), false, "far above => token1");
  assert.equal(isCoinToken0(WRAPPED_NATIVE.toUpperCase()), false, "case-insensitive, equal is not below");

  // The boundary is the quote asset itself: one below sorts token0, one above
  // token1. This is what actually breaks if WRAPPED_NATIVE is left stale.
  assert.equal(isCoinToken0("0x35ffffffffffffffffffffffffffffffffffffff"), true, "one below => token0");
  assert.equal(isCoinToken0("0x3600000000000000000000000000000000000001"), false, "one above => token1");

  // USDC sits at a LOW address, so a launch token sorts below it only ~21% of
  // the time. The minority branch is live and must never be assumed away.
  assert.equal(
    isCoinToken0("0x4cfc207c7c5407848d18a1e75fb7d7020fef8787"),
    false,
    "a real launched coin sorts above the USDC predeploy => token1",
  );

  // TokenLaunched emitted [-268600, -199400]; positions() reports [199400, 268600].
  const { poolTickLower, poolTickUpper } = poolRange(-268600, -199400, false);
  assert.equal(poolTickLower, 199400);
  assert.equal(poolTickUpper, 268600);

  // A coin-as-token0 launch keeps its range verbatim.
  assert.deepEqual(poolRange(-268600, -199400, true), {
    poolTickLower: -268600,
    poolTickUpper: -199400,
  });

  // slot0.tick was +268600: a fresh pool sitting at 0 progress, not graduated.
  const start = toCoinTick(268600, false);
  assert.equal(start, -268600);
  assert.equal(curveProgress(start, -268600, -199400), 0);
  assert.equal(start >= -199400, false, "fresh launch has not graduated");

  // Graduation is the pool's LOWER tick when the coin is token1.
  const end = toCoinTick(199400, false);
  assert.equal(curveProgress(end, -268600, -199400), 1);
  assert.equal(end >= -199400, true, "reaching poolTickLower graduates");

  // Halfway, and clamping past either edge.
  assert.equal(curveProgress(toCoinTick(234000, false), -268600, -199400), 0.5);
  assert.equal(curveProgress(toCoinTick(300000, false), -268600, -199400), 0);
  assert.equal(curveProgress(toCoinTick(150000, false), -268600, -199400), 1);

  // Buying a token1 coin pushes the pool tick DOWN, which must read as a price RISE.
  assert.ok(pctChange(toCoinTick(268000, false), toCoinTick(268600, false)) > 0);
  // ...and the mirrored token0 case rises when the pool tick goes UP.
  assert.ok(pctChange(toCoinTick(268600, true), toCoinTick(268000, true)) > 0);

  // Both orderings must price identically for the same real move: one tick of
  // NATIVE-per-coin is +0.01% either way.
  assert.ok(Math.abs(pctChange(1, 0) - 0.01) < 1e-6);
  assert.equal(pctChange(0, 0), 0, "no move, no change");

  console.log("ticks.ts: all checks passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
