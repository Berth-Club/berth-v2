// Pure geometry for the price chart. Kept out of the component so it can be
// checked without a renderer.
//
// Checks live in chart.selfcheck.ts — run `node --experimental-strip-types
// lib/chart.selfcheck.ts` after touching anything here. They are in a separate
// file on purpose: this module is imported by a "use client" component, so it
// must not pull in node builtins.

/** Minimal shape the geometry needs — mirrors indexer.ts PricePoint. */
export type Vertex = { t: number; native: number }

export type Geometry = { line: string; area: string }

/**
 * SVG path for a real price series, or null when there is nothing honest to draw.
 *
 * Returns null for fewer than two points: one trade cannot make a line, and a
 * flat line drawn from a single point would imply a price that held steady when
 * we simply have no second observation.
 */
export function chartGeometry(points: Vertex[], w: number, h: number): Geometry | null {
  if (points.length < 2) return null

  const first = points[0]!
  const last = points[points.length - 1]!
  const ys = points.map((p) => p.native)
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)

  // A perfectly flat run has no range to normalise against. This is NOT a
  // hypothetical: $SHIPP's first two real trades were a buy and a sell that
  // landed on the same tick, so hi === lo on live data. Dividing here would
  // emit NaN into the `d` attribute and the chart would vanish silently.
  const norm = (v: number) => (hi === lo ? 0.5 : (v - lo) / (hi - lo))

  const span = last.t - first.t
  const pts = points.map((p, i) => {
    // Space by time when the trades span any real duration, else evenly —
    // otherwise a burst of same-second trades would stack on a single x.
    const x = span > 0 ? ((p.t - first.t) / span) * w : (i / (points.length - 1)) * w
    return [x, h - norm(p.native) * (h - 20) - 10] as const
  })

  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  return { line, area: `${line} L${w},${h} L0,${h} Z` }
}
