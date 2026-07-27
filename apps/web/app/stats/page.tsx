import Link from "next/link"

import { CoinAvatar } from "@/components/coin-avatar"
import { AutoRefresh } from "@/components/auto-refresh"
import { ChangeChip } from "@/components/token-card"
import { fmtMc } from "@/lib/format"
import { fetchCoins, fetchDailySeries, fetchStats } from "@/lib/indexer"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Analytics — berth.club",
  description: "Protocol-wide volume, launches and graduations across the harbor.",
}

const DAYS = 30

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
        <h1 className="font-display text-[34px]">Analytics</h1>
        <p className="text-mist py-10 text-center text-sm">
          Can&apos;t reach the harbor ledger. Nothing to report until it answers.
        </p>
      </div>
    )
  }

  const graduated = coins.filter((c) => c.graduated).length
  const gradPct = coins.length ? ((graduated / coins.length) * 100).toFixed(1) : "0.0"
  const windowVolume = series?.points.reduce((sum, p) => sum + p.volumeUsd, 0) ?? null
  const last24h = series?.points.at(-1)?.volumeUsd ?? null
  const top = [...coins].sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, 5)

  const cells: { label: string; value: string; accent?: boolean }[] = [
    { label: "SHIPS LAUNCHED", value: stats.coins.toLocaleString() },
    { label: "GRADUATED", value: `${graduated} · ${gradPct}%` },
    { label: "TRADES", value: stats.trades.toLocaleString() },
    { label: "CAPTAINS", value: stats.captains.toLocaleString() },
    { label: "VOLUME · 24H", value: last24h === null ? "—" : fmtMc(last24h), accent: true },
  ]

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-7">
      <AutoRefresh seconds={30} />

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-[34px]">Analytics</h1>
        <span className="text-mist text-[13px]">protocol-wide · last {DAYS} days</span>
      </div>

      <section className="cell-grid mt-[18px]" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        {cells.map((c) => (
          <div key={c.label} className="cell px-[18px] py-[15px]">
            <div className="text-faint text-[10.5px]" style={{ letterSpacing: ".12em" }}>
              {c.label}
            </div>
            <div className={`tabular mt-1.5 text-[19px] ${c.accent ? "text-gold" : ""}`}>{c.value}</div>
          </div>
        ))}
      </section>

      <div className="mt-4 flex flex-wrap items-stretch gap-4">
        {/* volume area chart */}
        <div className="glass min-w-0 flex-[2_1_380px] p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-faint text-[11px] font-medium" style={{ letterSpacing: ".12em" }}>
              VOLUME · {DAYS}D
            </h2>
            <span className="tabular text-gold text-[13px]">
              {windowVolume === null ? "—" : `${fmtMc(windowVolume)} total`}
            </span>
          </div>
          {series ? (
            <AreaChart values={series.points.map((p) => p.volumeUsd)} />
          ) : (
            <Blank>No trade history to chart yet.</Blank>
          )}
          {series?.truncated && (
            <p className="text-faint mt-2 text-[11px]">
              Trimmed to the most recent 1,000 trades — earlier days under-report.
            </p>
          )}
        </div>

        {/* launches per day */}
        <div className="glass flex min-w-0 flex-[1.2_1_300px] flex-col p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-faint text-[11px] font-medium" style={{ letterSpacing: ".12em" }}>
              LAUNCHES PER DAY
            </h2>
            <span className="tabular text-mist text-[13px]">{stats.coins.toLocaleString()} total</span>
          </div>
          {series ? (
            <>
              <BarChart values={series.points.map((p) => p.launches)} />
              <div className="text-faint tabular mt-2 flex justify-between text-[11px]">
                <span>-{DAYS}d</span>
                <span>today</span>
              </div>
            </>
          ) : (
            <Blank>No launches to chart yet.</Blank>
          )}
        </div>

        {/* top ships */}
        <div className="glass min-w-0 flex-[1_1_280px] p-5">
          <h2 className="text-faint mb-1.5 text-[11px] font-medium" style={{ letterSpacing: ".12em" }}>
            TOP SHIPS · VOLUME
          </h2>
          {top.length === 0 ? (
            <Blank>Nothing has traded yet.</Blank>
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
    </div>
  )
}

function Blank({ children }: { children: React.ReactNode }) {
  return <p className="text-mist py-10 text-center text-[13px]">{children}</p>
}

/** Volume over time. Flat-zero series render as a flat line, which is the truth. */
function AreaChart({ values }: { values: number[] }) {
  const W = 600
  const H = 320
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * W : 0
    return [x, H - 14 - (v / max) * (H - 28)] as const
  })
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const area = `M0,${H} L${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")} L${W},${H} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Daily volume">
      <defs>
        <linearGradient id="stats-vol" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fb0e8" stopOpacity="0.28" />
          <stop offset="1" stopColor="#8fb0e8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(148,168,196,.16)" strokeDasharray="3 7" />
      <path d={area} fill="url(#stats-vol)" />
      <polyline
        points={line}
        fill="none"
        stroke="#8fb0e8"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function BarChart({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  return (
    <div className="flex min-h-[180px] flex-1 items-end gap-[3px]">
      {values.map((v, i) => (
        <div
          key={i}
          title={`${v} ${v === 1 ? "launch" : "launches"}`}
          className="flex-1 rounded-t-[3px]"
          style={{
            // 2% floor so an empty day still reads as a day, not a gap.
            height: `${Math.max(2, (v / max) * 100)}%`,
            background: i === values.length - 1 ? "#b7c9ee" : "rgba(143,176,232,.35)",
          }}
        />
      ))}
    </div>
  )
}
