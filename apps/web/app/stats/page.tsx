import Link from "next/link"

import { CoinAvatar } from "@/components/coin-avatar"
import { AutoRefresh } from "@/components/auto-refresh"
import { ChangeChip } from "@/components/token-card"
import { fmtMc } from "@/lib/format"
import { fetchCoins, fetchDailySeries, fetchStats } from "@/lib/indexer"
import { StatsPanel, type Cell, type Point } from "./stats-panel"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Analytics — berth.club",
  description: "Protocol-wide volume, launches and graduations across the harbor.",
}

const DAYS = 30

/** Day-over-day change, rendered plainly ("+43.1%"). null when there's no honest base. */
function pctDelta(cur: number | null, prev: number | null): Cell["delta"] {
  if (cur === null || prev === null || prev === 0) return null
  const d = ((cur - prev) / prev) * 100
  return { text: `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`, up: d >= 0 }
}

/** "Jul 21" from a UTC day boundary. */
function dayLabel(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

/**
 * Analytics. Every figure here is an indexed fact.
 *
 * Notably absent: TVL and "fees to captains", both of which the design's mock
 * shows. Neither is indexed — TVL needs per-pool reserves and the fee split
 * needs the locker's accrued balances — and a plausible dollar figure with
 * nothing behind it is the one thing this page must not print.
 */
export default async function StatsPage() {
  const [coins, stats, series] = await Promise.all([fetchCoins(), fetchStats(), fetchDailySeries(DAYS)])

  if (!coins || !stats) {
    return (
      <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-7">
        <h1 className="font-display text-[26px]">Protocol analytics</h1>
        <p className="text-mist py-10 text-center text-sm">
          Can&apos;t reach the harbor ledger. Nothing to report until it answers.
        </p>
      </div>
    )
  }

  const top = [...coins].sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, 5)

  const pts = series?.points ?? []
  const last = pts.at(-1) ?? null
  const prev = pts.at(-2) ?? null
  const windowVolume = pts.reduce((sum, p) => sum + p.volumeUsd, 0)

  // Three cells, matching the design. The third is total trades — the indexer
  // carries no per-day trade count, so a "24h trades" figure would be invented.
  const tradesCell: Cell = { label: "Trades", value: stats.trades.toLocaleString() }

  const cells: Record<"24h" | "all", Cell[]> = {
    "24h": [
      {
        label: "24h volume",
        value: last ? fmtMc(last.volumeUsd) : "—",
        delta: pctDelta(last?.volumeUsd ?? null, prev?.volumeUsd ?? null),
      },
      {
        label: "24h launches",
        value: last ? String(last.launches) : "—",
        delta: pctDelta(last?.launches ?? null, prev?.launches ?? null),
      },
      tradesCell,
    ],
    all: [
      { label: `Volume · ${DAYS}d`, value: fmtMc(windowVolume) },
      { label: "Ships launched", value: stats.coins.toLocaleString() },
      tradesCell,
    ],
  }

  const volPoints: Point[] = pts.map((p) => ({ label: dayLabel(p.day), value: p.volumeUsd }))
  const launchPoints: Point[] = pts.map((p) => ({ label: dayLabel(p.day), value: p.launches }))

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-7">
      <AutoRefresh seconds={30} />

      <StatsPanel
        cells={cells}
        volPoints={volPoints}
        launchPoints={launchPoints}
        volTotal={{ "24h": last ? fmtMc(last.volumeUsd) : "—", all: fmtMc(windowVolume) }}
        launchTotal={{
          "24h": last ? String(last.launches) : "—",
          all: stats.coins.toLocaleString(),
        }}
      />

      <div className="glass mt-4 p-6">
        <h2 className="text-faint mb-1.5 text-[11px] font-medium" style={{ letterSpacing: ".12em" }}>
          TOP SHIPS · VOLUME
        </h2>
        {top.length === 0 ? (
          <p className="text-mist py-10 text-center text-[13px]">Nothing has traded yet.</p>
        ) : (
          top.map((c) => (
            <Link
              key={c.address}
              href={`/token/${c.address}`}
              className="hover:bg-bulwark -mx-2 flex items-center gap-2.5 rounded-md px-2 py-2.5 transition-colors"
              style={{ borderBottom: "1px solid rgba(148,168,196,.14)" }}
            >
              <CoinAvatar
                image={c.image}
                emoji={c.emoji}
                name={c.name}
                ticker={c.ticker}
                size={30}
                className="bg-deep rounded-lg"
                style={{ border: "1px solid rgba(148,168,196,.2)" }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold">{c.name}</div>
                <div className="text-faint text-[11.5px]">${c.ticker}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="tabular text-[13px]">{c.vol ?? "—"}</div>
                <ChangeChip change={c.change24h} className="!px-0 !py-0 !bg-transparent text-[11.5px]" />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
