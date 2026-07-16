import Link from "next/link"

import { fmtMc } from "@/lib/format"
import { CAPTAINS, rankColor } from "@/lib/users"

const COLS = "56px 1fr 110px 90px 110px"

export default function LeaderboardPage() {
  return (
    <div className="mx-auto max-w-[900px] px-5 pb-20 pt-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[34px]">Harbor Masters</h1>
        <span
          className="text-gold rounded-[20px] px-3 py-1 text-xs font-bold"
          style={{ background: "rgba(251,191,36,.12)", border: "1px solid rgba(251,191,36,.45)" }}
        >
          Season 1 · ends in <span className="tabular">12d 4h</span>
        </span>
      </div>

      <div className="rounded-panel bg-hull overflow-hidden border">
        {/* header row */}
        <div
          className="text-mist grid gap-3 px-4 py-3 text-xs font-bold"
          style={{ gridTemplateColumns: COLS, letterSpacing: 1, borderBottom: "1px solid #263A28" }}
        >
          <span>#</span>
          <span>TRADER</span>
          <span className="text-right">PNL</span>
          <span className="text-right">WIN %</span>
          <span className="text-right">VOLUME</span>
        </div>

        {CAPTAINS.map((c, i) => {
          const rank = i + 1
          const color = rankColor(rank)
          return (
            <Link
              key={c.address}
              href={`/u/${encodeURIComponent(c.address)}`}
              className="hover:bg-bulwark grid items-center gap-3 px-4 py-3 transition-colors"
              style={{ gridTemplateColumns: COLS, borderBottom: "1px solid #1a281c" }}
            >
              <span className="font-display text-lg" style={{ color: color ?? "#93A896" }}>
                {rank}
              </span>

              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className="grid size-[30px] shrink-0 place-items-center rounded-full text-sm"
                  style={{
                    background: color ? "rgba(251,191,36,.12)" : "#182418",
                    border: `1px solid ${color ?? "#263A28"}`,
                  }}
                  aria-hidden
                >
                  {c.emoji}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{c.handle}</span>
                  <span className="tabular text-faint block text-xs">{c.address}</span>
                </span>
              </span>

              <span
                className="tabular text-right text-sm"
                style={{ color: c.pnlUsd >= 0 ? "#4ADE80" : "#F87171" }}
              >
                {c.pnlUsd >= 0 ? "+" : "−"}
                {fmtMc(Math.abs(c.pnlUsd)).slice(1)}
              </span>
              <span className="tabular text-right text-sm">{c.winPct}%</span>
              <span className="tabular text-right text-sm">{fmtMc(c.volumeUsd)}</span>
            </Link>
          )
        })}
      </div>

      <p className="text-faint mt-4 text-center text-[13px]">
        Top 3 split a <span className="tabular">12 ETH</span> prize pool. Salvaged from the storm,
        obviously.
      </p>
    </div>
  )
}
