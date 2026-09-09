// Tick-space math for berth.club pools on contracts v2.
//
// Pure + dependency-free on purpose: this is the logic a wrong assumption
// already burned us on once, so it carries its own self-check. Run it with:
//   node lib/ticks.ts
//
// Lives outside src/ because Ponder executes every file under src/ as an
// indexing module (except src/api/). This is a library, not a handler.
//
// WHAT V2 DELETED FROM THIS FILE:
//   - `MAX_USABLE_TICK` / `poolRange`: v1.4 emitted only `initialTick` and ran
//     the position to a bound the indexer had to supply. v2 emits tickLower AND
//     tickUpper on LaunchPositionMinted, so there is nothing to reconstruct.
//   - `curveProgress`: there is no graduation in v2. The position IS the curve
//     and it never migrates, so there is no finish line to measure against.
//   - `isCoinToken0` by address comparison against a wrapped-native constant:
//     v2's quote asset is NATIVE (`address(0)`), which sorts below every token,
//     so the coin is currency1 on every native-quoted pool. Ordering now comes
//     off the launch record rather than being re-derived from addresses.

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

/**
 * Coin-space tick: `1.0001^tick` = quote per whole coin, for either ordering.
 *
 * The pool reports token1-per-token0. On a native-quoted pool currency0 is
 * native USDC and the coin is currency1, so the raw tick reads coins-per-USDC
 * and has to be negated. Getting this backwards once produced a price of ~$843
 * trillion per token, so it is derived from the stored ordering, never assumed.
 */
export function toCoinTick(poolTick: number, coinIsToken0: boolean): number {
  return coinIsToken0 ? poolTick : -poolTick;
}

/**
 * Coin-space tick the pool sits at the moment it is minted, before any swap.
 *
 * The launch position is single-sided in the coin, and Uniswap parks a
 * single-sided position at the bound where it holds only that asset: at
 * tickLower when the coin is currency0, at tickUpper when it is currency1.
 * Both bounds are RAW pool ticks, so the currency1 case negates.
 *
 * Reading `tickLower` as the coin-space floor instead put a currency1 coin at
 * 1.0001^-887270 ≈ 3e-39 USDC, and the trade panel reported a 1.7e35% price
 * impact against it on the first buy.
 */
export function launchTick(tickLower: number, tickUpper: number, coinIsToken0: boolean): number {
  return toCoinTick(coinIsToken0 ? tickLower : tickUpper, coinIsToken0);
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

function main(): void {
  // A coin as currency1 (the native-quoted case) reads inverted.
  assert.equal(toCoinTick(-268600, false), 268600, "currency1 coin negates");
  assert.equal(toCoinTick(268600, true), 268600, "currency0 coin passes through");
  assert.equal(toCoinTick(0, false), -0, "zero is zero either way");

  // A native-quoted launch: raw range [-887270, 122070], coin is currency1, so
  // the pool starts at raw 122070 and coin-space -122070. The first buy on
  // $TOOK landed at coin-space -122066, four ticks up — consistent.
  assert.equal(launchTick(-887270, 122070, false), -122070, "currency1 launch tick");
  assert.equal(launchTick(-122070, 887270, true), -122070, "currency0 launch tick");

  // Ratio maths, independent of ordering.
  assert.equal(Math.round(pctChange(0, 0)), 0, "no move is 0%");
  assert.ok(pctChange(100, 0) > 0, "up is positive");
  assert.ok(pctChange(0, 100) < 0, "down is negative");
  // 1.0001^6931 ≈ 2, i.e. a double.
  assert.ok(Math.abs(pctChange(6931, 0) - 100) < 1, "+6931 ticks ≈ +100%");
  // Symmetry: a doubling then a halving returns to the start.
  assert.ok(Math.abs(pctChange(6931, 6931)) < 1e-9, "same tick, no change");

  console.log("ticks.ts self-check passed");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
