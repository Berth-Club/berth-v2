"use client"

import * as React from "react"

import { TokenCard } from "@/components/token-card"
import type { Coin } from "@/lib/coin"

/**
 * The Harbor discovery grid — search + tab pair + sort pills + time-range
 * capsule → token-card grid → numbered pagination. Built for 1000+ tokens:
 * everything is client-side over the already-fetched coins (24/page), so paging
 * is instant and needs no round trip.
 *
 * Where the indexer carries no windowed signal, the control maps to the closest
 * real field rather than inventing one (see the sort/range comments). No mock
 * data ever fills a gap.
 */

type Tab = "water" | "grad"
type Sort = "trending" | "buys" | "new" | "old" | "top" | "vol"
type Range = "all" | "24h" | "7d"

const SORTS: { key: Sort; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "buys", label: "Recent buys" },
  { key: "new", label: "Newest" },
  { key: "old", label: "Oldest" },
  { key: "top", label: "Market cap" },
  { key: "vol", label: "Volume" },
]

const RANGES: { key: Range; label: string }[] = [
  { key: "all", label: "All" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
]

// 20 fills complete rows at 2 / 4 / 5 columns; at the 3-wide md breakpoint the
// last row is short, which the grid handles by leaving empty cells.
const PER_PAGE = 20
const DAY = 86_400

function matches(coin: Coin, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    coin.name.toLowerCase().includes(needle) ||
    coin.ticker.toLowerCase().includes(needle) ||
    coin.address.toLowerCase().includes(needle)
  )
}

function sortCoins(coins: Coin[], sort: Sort): Coin[] {
  const out = [...coins]
  switch (sort) {
    case "trending": {
      // Coins with real uploaded art lead — the emoji-only ones sink to the end
      // so the discovery grid looks its best. Then real 24h movers, then volume,
      // then recency (a field of never-traded coins is all change24h=null, which
      // alone returned NaN and shuffled them randomly).
      const hasArt = (c: Coin) => (c.image?.startsWith("ipfs://") ? 1 : 0)
      const chg = (c: Coin) => c.change24h ?? -Infinity
      return out.sort(
        (a, b) =>
          hasArt(b) - hasArt(a) ||
          chg(b) - chg(a) ||
          b.volumeUsd - a.volumeUsd ||
          b.createdAt - a.createdAt
      )
    }
    // No per-coin recent-buy timestamp reaches the client, so "Recent buys"
    // ranks by holder count — the closest real proxy for buying interest.
    case "buys":
      return out.sort((a, b) => b.holderCount - a.holderCount)
    case "new":
      return out.sort((a, b) => b.createdAt - a.createdAt)
    case "old":
      return out.sort((a, b) => a.createdAt - b.createdAt)
    // marketCapNative, never the USD field — the latter goes null on a feed blip.
    case "top":
      return out.sort((a, b) => b.marketCapNative - a.marketCapNative)
    case "vol":
      return out.sort((a, b) => b.volumeUsd - a.volumeUsd)
  }
}

/** ‹ 1 2 … 9 › — current page ±1, always with the first and last. */
function pageList(total: number, page: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | "…")[] = [1]
  if (page > 3) out.push("…")
  for (let n = Math.max(2, page - 1); n <= Math.min(total - 1, page + 1); n++) out.push(n)
  if (page < total - 2) out.push("…")
  out.push(total)
  return out
}

export function HarborGrid({ coins }: { coins: Coin[] }) {
  const [query, setQuery] = React.useState("")
  const [tab, setTab] = React.useState<Tab>("water")
  const [sort, setSort] = React.useState<Sort>("trending")
  const [range, setRange] = React.useState<Range>("all")
  const [page, setPage] = React.useState(1)

  const gradCount = React.useMemo(() => coins.filter((c) => c.graduated).length, [coins])
  const waterCount = coins.length - gradCount

  const shown = React.useMemo(() => {
    // Launch-recency window. The indexer exposes no windowed trade activity to
    // the client, so 24h/7d scope by launch time — honest, if coarser than the
    // per-trade window the labels imply.
    const now = Math.floor(Date.now() / 1000)
    const floor = range === "24h" ? now - DAY : range === "7d" ? now - 7 * DAY : 0

    const filtered = coins.filter(
      (c) =>
        c.graduated === (tab === "grad") &&
        c.createdAt >= floor &&
        matches(c, query),
    )
    return sortCoins(filtered, sort)
  }, [coins, tab, range, query, sort])

  const totalPages = Math.max(1, Math.ceil(shown.length / PER_PAGE))
  const pg = Math.min(page, totalPages)
  const pageSlice = shown.slice((pg - 1) * PER_PAGE, pg * PER_PAGE)

  // Any control that narrows the set returns to page 1 — otherwise a filter can
  // strand you on a now-empty page N.
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }
  const goPage = (n: number) => {
    setPage(n)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "water", label: "On the berth", count: waterCount },
    { key: "grad", label: "Graduated", count: gradCount },
  ]

  return (
    <div className="flex flex-col">
      {/* title · count · tabs · search */}
      <div className="mb-3.5 mt-[34px] flex flex-wrap items-center gap-3">
        <h2 className="font-display text-[26px]">Explore</h2>
        <span
          className="text-body2 text-[12.5px] font-semibold"
          style={{
            background: "rgba(8,17,30,.8)",
            border: "1px solid rgba(148,168,196,.18)",
            borderRadius: 999,
            padding: "6px 14px",
          }}
        >
          <span className="tabular">{coins.length.toLocaleString("en-US")}</span> launched
        </span>

        <Segmented>
          {TABS.map((t) => (
            <Pill key={t.key} on={tab === t.key} onClick={() => reset(setTab)(t.key)}>
              {t.label} · <span className="tabular">{t.count.toLocaleString("en-US")}</span>
            </Pill>
          ))}
        </Segmented>

        <div className="well flex w-full items-center gap-2 rounded-full px-3.5 md:ml-auto md:w-auto md:min-w-[200px]">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#93a8c4" strokeWidth={2} strokeLinecap="round" className="shrink-0" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M16.5 16.5L21 21" />
          </svg>
          <input
            value={query}
            onChange={(e) => reset(setQuery)(e.target.value)}
            placeholder="Search ships or tickers"
            aria-label="Search coins"
            className="text-foam min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"
          />
        </div>
      </div>

      {/* sort + time-range. Sort is a compact dropdown on mobile (six pills
          wrapped into a capsule read as cluttered/cropped there) and the full
          pill capsule from md up. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* mobile: sort dropdown */}
        <div className="relative w-full md:hidden">
          <select
            value={sort}
            onChange={(e) => reset(setSort)(e.target.value as Sort)}
            aria-label="Sort coins"
            className="well text-body2 w-full appearance-none rounded-full py-2.5 pl-4 pr-10 text-[13.5px] font-semibold outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key} className="bg-deep">
                Sort · {s.label}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#93a8c4" strokeWidth="2.5" aria-hidden
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {/* md+: sort pills */}
        <div className="hidden md:block">
          <Segmented>
            {SORTS.map((s) => (
              <Pill key={s.key} on={sort === s.key} onClick={() => reset(setSort)(s.key)} className="text-[13.5px]">
                {s.label}
              </Pill>
            ))}
          </Segmented>
        </div>
        <Segmented>
          {RANGES.map((r) => (
            <Pill key={r.key} on={range === r.key} onClick={() => reset(setRange)(r.key)}>
              {r.label}
            </Pill>
          ))}
        </Segmented>
      </div>

      {/* Fixed-column grid, not flex + grow: with grow, a partial last row's cards
          stretched wide, and since the art is aspect-square, wider meant TALLER —
          the last row didn't match the rest. Equal columns keep every card the
          same size; a short last row just leaves empty cells. */}
      {pageSlice.length > 0 ? (
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {pageSlice.map((coin) => (
            <TokenCard key={coin.address} coin={coin} />
          ))}
        </div>
      ) : (
        <div
          className="text-mist rounded-[14px] px-5 py-10 text-center text-sm"
          style={{ background: "rgba(11,20,33,.6)", border: "1px dashed rgba(148,168,196,.3)" }}
        >
          {query
            ? `No ships match "${query}".`
            : tab === "grad"
              ? "No ships have graduated yet."
              : "The berth's quiet — go launch something."}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-[26px] flex items-center justify-center gap-2.5">
          <Arrow disabled={pg <= 1} onClick={() => goPage(pg - 1)}>
            ‹
          </Arrow>
          <div
            className="flex items-center gap-1 p-[5px]"
            style={{ background: "rgba(8,17,30,.85)", border: "1px solid rgba(148,168,196,.14)", borderRadius: 14 }}
          >
            {pageList(totalPages, pg).map((n, i) =>
              n === "…" ? (
                <span key={`gap-${i}`} className="text-faint min-w-10 px-1.5 py-2.5 text-center text-sm select-none">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  onClick={() => goPage(n)}
                  aria-current={n === pg ? "page" : undefined}
                  className="min-w-10 rounded-[10px] px-1.5 py-2.5 text-center text-sm font-semibold select-none"
                  style={{
                    background: n === pg ? "#eaf1fa" : "transparent",
                    color: n === pg ? "#0d2340" : "#93a8c4",
                  }}
                >
                  {n}
                </button>
              ),
            )}
          </div>
          <Arrow disabled={pg >= totalPages} onClick={() => goPage(pg + 1)}>
            ›
          </Arrow>
        </div>
      )}
    </div>
  )
}

/** Segmented-control shell: the rounded frosted track the pills sit in. */
function Segmented({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex max-w-full flex-wrap items-center gap-1 p-1"
      style={{ background: "rgba(8,17,30,.8)", border: "1px solid rgba(148,168,196,.18)", borderRadius: 999 }}
    >
      {children}
    </div>
  )
}

function Pill({
  on,
  onClick,
  children,
  className,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${className ?? ""}`}
      style={{ background: on ? "#1b3450" : "transparent", color: on ? "#eaf1fa" : "#93a8c4" }}
    >
      {children}
    </button>
  )
}

function Arrow({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="grid h-10 w-10 place-items-center rounded-full text-[17px] transition-colors select-none disabled:cursor-default"
      style={{ color: disabled ? "rgba(148,168,196,.35)" : "#93a8c4" }}
    >
      {children}
    </button>
  )
}
