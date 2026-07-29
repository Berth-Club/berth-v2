"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"
import { chartGeometry } from "@/lib/chart"
import { fmtPrice } from "@/lib/format"
import type { PricePoint } from "@/lib/indexer"

const TIMEFRAMES = [
  { label: "1H", seconds: 3_600 },
  { label: "4H", seconds: 14_400 },
  { label: "1D", seconds: 86_400 },
  { label: "1W", seconds: 604_800 },
  { label: "ALL", seconds: Infinity },
] as const

const W = 600
const H = 188

/**
 * Real price history only.
 *
 * This component used to draw a seeded random walk and call it a price chart:
 * 48 invented points per coin, a different shape per timeframe button, rendered
 * even for coins with zero trades. It was the most convincing fake on the site —
 * a chart is read as history, and this one sat beside a real price.
 *
 * Now every vertex is one indexed swap. Sparse is fine and honest: two trades
 * draw one segment. Fewer than two draws nothing, and says why.
 */
export function PriceChart({ points, volume }: { points: PricePoint[]; volume: string | null }) {
  const [tf, setTf] = React.useState<(typeof TIMEFRAMES)[number]["label"]>("ALL")

  // Windowed off the newest trade, not wall-clock now: on a chain this quiet the
  // last trade can be days old, and anchoring to now would empty every window
  // and claim "no trades" about a coin that has plenty.
  const newest = points.length ? points[points.length - 1]!.t : 0
  const window = TIMEFRAMES.find((f) => f.label === tf)!.seconds
  const shown = React.useMemo(
    () => (window === Infinity ? points : points.filter((p) => newest - p.t <= window)),
    [points, window, newest]
  )

  const first = shown[0]
  const last = shown[shown.length - 1]
  const up = first && last ? last.native >= first.native : true
  const stroke = up ? "#8fb0e8" : "#de8092"
  const gid = `grad-${up ? "up" : "down"}`

  // Geometry lives in lib/chart.ts, where it has a self-check — the flat-series
  // and zero-span cases both occur on real data.
  const geom = React.useMemo(() => chartGeometry(shown, W, H), [shown])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {TIMEFRAMES.map(({ label }) => (
          <button
            key={label}
            onClick={() => setTf(label)}
            aria-pressed={tf === label}
            className={cn(
              "rounded-chip px-2.5 py-1 text-xs font-bold transition-colors",
              tf === label ? "text-lime" : "text-mist hover:text-foam"
            )}
            style={tf === label ? { background: "rgba(143,176,232,.12)" } : undefined}
          >
            {label}
          </button>
        ))}
        <span className="text-mist ml-auto text-[13px]">
          Vol <span className="tabular text-foam">{volume ?? "—"}</span>
        </span>
      </div>

      {geom ? (
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Price chart">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={geom.area} fill={`url(#${gid})`} />
          <path
            d={geom.line}
            fill="none"
            stroke={stroke}
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <div
          className="text-mist grid place-items-center rounded-card px-4 text-center text-[13px]"
          style={{ height: H, border: "1px dashed rgba(148,168,196,0.2)" }}
        >
          {points.length === 0
            ? "No trades yet — nothing to chart."
            : points.length === 1
              ? "One trade so far. A chart needs two."
              : `No trades in this window. Last price ${fmtPrice(points[points.length - 1]!.usd)}.`}
        </div>
      )}
    </div>
  )
}
