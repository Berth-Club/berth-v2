"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

const TIMEFRAMES = ["1H", "4H", "1D", "1W"] as const
const W = 600
const H = 220

/** Deterministic pseudo-random from a string seed — keeps SSR/client in sync. */
function seeded(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h += 0x6d2b79f5
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function series(seed: string, up: boolean, n = 48): number[] {
  const rand = seeded(seed)
  const out: number[] = []
  let v = 0.5
  for (let i = 0; i < n; i++) {
    v += (rand() - (up ? 0.42 : 0.58)) * 0.09
    out.push(Math.min(0.95, Math.max(0.05, v)))
  }
  return out
}

function path(points: number[]): { line: string; area: string } {
  const step = W / (points.length - 1)
  const pts = points.map((p, i) => [i * step, H - p * (H - 20) - 10] as const)
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const area = `${line} L${W},${H} L0,${H} Z`
  return { line, area }
}

export function PriceChart({
  seed,
  change,
  volume,
}: {
  seed: string
  /** null = never traded; the line renders flat and neutral. */
  change: number | null
  volume: string
}) {
  const [tf, setTf] = React.useState<(typeof TIMEFRAMES)[number]>("1D")
  const untraded = change === null
  const up = (change ?? 0) >= 0
  const stroke = untraded ? "#93A896" : up ? "#A3E635" : "#F87171"
  const data = React.useMemo(
    () => (untraded ? Array(48).fill(0.5) : series(seed + tf, up)),
    [seed, tf, up, untraded]
  )
  const { line, area } = React.useMemo(() => path(data), [data])
  const gid = `grad-${up ? "up" : "down"}`

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {TIMEFRAMES.map((t) => (
          <button
            key={t}
            onClick={() => setTf(t)}
            aria-pressed={tf === t}
            className={cn(
              "rounded-chip px-2.5 py-1 text-xs font-bold transition-colors",
              tf === t ? "text-lime" : "text-mist hover:text-foam"
            )}
            style={tf === t ? { background: "rgba(163,230,53,.12)" } : undefined}
          >
            {t}
          </button>
        ))}
        <span className="text-mist ml-auto text-[13px]">
          Vol <span className="tabular text-foam">{volume}</span>
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Price chart">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={stroke} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}
