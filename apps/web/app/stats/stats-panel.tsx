"use client"

import { useState } from "react"

import { fmtMc } from "@/lib/format"

type Range = "24h" | "all"

export type Cell = {
  label: string
  value: string
  delta?: { text: string; up: boolean } | null
  accent?: boolean
}

/** One day of the series. `label` is a pre-formatted UTC day ("Jul 21"). */
export type Point = { label: string; value: number }

type Props = {
  cells: Record<Range, Cell[]>
  volPoints: Point[]
  launchPoints: Point[]
  /** Header figure per range — real, never a fabricated total. */
  volTotal: Record<Range, string>
  launchTotal: Record<Range, string>
}

export function StatsPanel({ cells, volPoints, launchPoints, volTotal, launchTotal }: Props) {
  const [range, setRange] = useState<Range>("24h")

  return (
    <>
      <div className="glass p-[30px]">
        <div className="flex flex-wrap items-start gap-4">
          <h1 className="font-display min-w-[250px] text-[26px] leading-tight">Protocol analytics</h1>
          <div className="ml-auto flex rounded-full border border-[rgba(148,168,196,.18)] bg-[rgba(8,17,30,.8)] p-1">
            {(["24h", "all"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
                  range === r ? "bg-bulwark text-foam" : "text-mist hover:text-body2"
                }`}
              >
                {r === "24h" ? "24h" : "All time"}
              </button>
            ))}
          </div>
        </div>

        <section
          className="cell-grid mt-6"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}
        >
          {cells[range].map((c) => (
            <div key={c.label} className="cell px-6 py-[22px]">
              <div className="text-mist text-[13px]">{c.label}</div>
              <div
                className={`tabular mt-2 leading-none ${c.accent ? "text-lime" : ""}`}
                style={{ fontSize: "clamp(28px,3.2vw,38px)", letterSpacing: "-.02em" }}
              >
                {c.value}
              </div>
              {c.delta && (
                <div className={`mt-2 text-[12.5px] ${c.delta.up ? "text-candle" : "text-tide"}`}>
                  {c.delta.text}
                </div>
              )}
            </div>
          ))}
        </section>
      </div>

      <div className="mt-4 flex flex-wrap items-stretch gap-4">
        <Bars
          title="Trading volume"
          total={volTotal[range]}
          points={volPoints}
          format={(v) => fmtMc(v)}
        />
        <Bars
          title="Token launches"
          total={launchTotal[range]}
          points={launchPoints}
          format={(v) => `${v} ${v === 1 ? "launch" : "launches"}`}
        />
      </div>
    </>
  )
}

function Bars({
  title,
  total,
  points,
  format,
}: {
  title: string
  total: string
  points: Point[]
  format: (v: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)

  if (points.length === 0) {
    return (
      <div className="glass min-w-0 flex-1 basis-[380px] p-6">
        <div className="font-display text-[19px]">{title}</div>
        <p className="text-mist py-10 text-center text-[13px]">Nothing to chart yet.</p>
      </div>
    )
  }

  // Default to the latest day; hover overrides it, mouse-leave restores it.
  const active = hover ?? points.length - 1
  const max = Math.max(...points.map((p) => p.value), 1)
  const cur = points[active]!

  return (
    <div className="glass min-w-0 flex-1 basis-[380px] p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <div className="font-display text-[19px]">{title}</div>
        <div className="tabular text-[19px]">{total}</div>
      </div>
      <div className="tabular text-faint mt-1 text-[12.5px]">
        {cur.label} · {format(cur.value)}
      </div>

      <div
        onMouseLeave={() => setHover(null)}
        className="mt-5 flex h-[210px] items-end gap-[7px] overflow-hidden rounded-[14px] border border-[rgba(148,168,196,.1)] bg-[rgba(8,15,26,.5)] px-4 pt-4"
        role="img"
        aria-label={`${title} by day`}
      >
        {points.map((p, i) => {
          const on = i === active
          return (
            <div
              key={i}
              onMouseEnter={() => setHover(i)}
              title={`${p.label} · ${format(p.value)}`}
              className="flex-1 cursor-pointer rounded-t-[5px] transition-all duration-150"
              style={{
                // 2% floor so an empty day still reads as a bar, not a gap.
                height: `${Math.max(2, (p.value / max) * 100)}%`,
                background: on ? "linear-gradient(180deg,#e6eefc,#b7c9ee)" : "rgba(143,176,232,.42)",
                boxShadow: on ? "0 0 22px rgba(183,201,238,.55)" : "none",
              }}
            />
          )
        })}
      </div>

      <div className="tabular text-faint mt-2.5 flex justify-between text-[12px]">
        <span>{points[0]!.label}</span>
        <span>{points[points.length - 1]!.label}</span>
      </div>
    </div>
  )
}
