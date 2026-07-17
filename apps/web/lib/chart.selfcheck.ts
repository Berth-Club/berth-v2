// Checks for lib/chart.ts. Run: node --experimental-strip-types lib/chart.selfcheck.ts
//
// Separate from chart.ts because that module is imported by a "use client"
// component and must stay free of node builtins.

import assert from "node:assert/strict"

import { chartGeometry } from "./chart.ts"

const W = 600
const H = 220

assert.equal(chartGeometry([], W, H), null, "no trades: nothing to draw")
assert.equal(chartGeometry([{ t: 1, weth: 2e-12 }], W, H), null, "one trade cannot make a line")

// The live $SHIPP case: two real swaps that landed on the SAME tick (a buy and
// a sell netting out), so hi === lo. Without the flat guard this emits NaN into
// the path and the chart silently disappears.
const flat = chartGeometry(
  [
    { t: 100, weth: 2.167e-12 },
    { t: 200, weth: 2.167e-12 },
  ],
  W,
  H
)!
assert.ok(flat, "two points draw")
assert.ok(!flat.line.includes("NaN"), "flat series must not emit NaN")
// y = H - 0.5*(H-20) - 10 = 110 — mid-band, inside the 10px padding.
assert.equal(flat.line, "M0.0,110.0 L600.0,110.0", "flat series pins mid-height, spans full width")

// A rise must read as a rise: SVG y grows downward, so the later, higher-priced
// point must have the SMALLER y. Get this backwards and every chart is inverted.
const rise = chartGeometry(
  [
    { t: 0, weth: 1e-12 },
    { t: 100, weth: 2e-12 },
  ],
  W,
  H
)!
const yOf = (seg: string) => Number(seg.split(",")[1])
const segs = rise.line.split(" ")
assert.ok(yOf(segs[1]!) < yOf(segs[0]!), "a price rise must go UP the screen (y decreases)")

// Same-timestamp burst: zero time span must not divide by zero.
const burst = chartGeometry(
  [
    { t: 5, weth: 1e-12 },
    { t: 5, weth: 2e-12 },
    { t: 5, weth: 3e-12 },
  ],
  W,
  H
)!
assert.ok(!burst.line.includes("NaN"), "zero time span must not emit NaN")
assert.ok(
  burst.line.includes("M0.0,") && burst.line.includes("L600.0,"),
  "burst spreads across width"
)

console.log("chart.ts: all checks passed")
