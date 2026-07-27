"use client"

import * as React from "react"

import { TokenCard } from "@/components/token-card"
import { useWatchlist } from "@/lib/use-watchlist"
import type { Coin } from "@/lib/coin"

/**
 * The fleet grid with search + filter — the discovery layer that turns a static
 * list into something you can actually navigate.
 *
 * Client-side over the already-fetched coins: the harbor is a few dozen coins on
 * a testnet, so filtering in the browser is instant and needs no round trip.
 * If the fleet ever grows past a few hundred, this moves server-side.
 */

type Filter = "trending" | "fresh" | "graduating" | "top" | "watching"

const FILTERS: { key: Filter; label: string }[] = [
  { key: "trending", label: "🔥 Trending" },
  { key: "fresh", label: "🚢 Fresh" },
  { key: "graduating", label: "🎓 Graduating" },
  { key: "top", label: "💰 Top cap" },
  { key: "watching", label: "★ Watching" },
]

function matches(coin: Coin, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    coin.name.toLowerCase().includes(needle) ||
    coin.ticker.toLowerCase().includes(needle) ||
    coin.address.toLowerCase().includes(needle)
  )
}

function applyFilter(coins: Coin[], filter: Filter, isWatched: (a: string) => boolean): Coin[] {
  const out = [...coins]
  switch (filter) {
    case "trending":
      // A coin that has never traded has change24h === null and no claim to
      // being "trending" — it sorts last rather than posing as flat at 0%.
      return out.sort((a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity))
    case "fresh":
      return out.sort((a, b) => b.createdAt - a.createdAt)
    case "graduating":
      // Ungraduated coins closest to the line first; graduated ones drop out.
      return out.filter((c) => !c.graduated).sort((a, b) => b.curve - a.curve)
    case "top":
      // marketCapNative, never the USD field — the latter goes null on a feed blip.
      return out.sort((a, b) => b.marketCapNative - a.marketCapNative)
    case "watching":
      return out.filter((c) => isWatched(c.address))
  }
}

export function Harbor({ coins }: { coins: Coin[] }) {
  const [query, setQuery] = React.useState("")
  const [filter, setFilter] = React.useState<Filter>("trending")
  const { isWatched, toggle } = useWatchlist()

  const shown = React.useMemo(
    () => applyFilter(coins.filter((c) => matches(c, query)), filter, isWatched),
    [coins, query, filter, isWatched]
  )

  return (
    <div className="flex flex-col">
      {/* section head: title · count · search */}
      <div className="mb-3.5 mt-[34px] flex flex-wrap items-center gap-3">
        <h2 className="font-display text-[26px]">The water right now</h2>
        <span className="text-mist text-[13px]">
          <span className="tabular">{coins.length}</span> {coins.length === 1 ? "ship" : "ships"}
        </span>
        <div className="well ml-auto flex min-w-[200px] items-center gap-2 rounded-full px-3.5">
          <span className="text-faint text-sm" aria-hidden>
            ⌕
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ships or tickers"
            aria-label="Search coins"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const on = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={on}
              className="rounded-[10px] px-3.5 py-2 text-[13px] font-bold transition-colors"
              style={{
                background: on ? "rgba(137,167,219,.12)" : "transparent",
                color: on ? "#89a7db" : "#93a8c4",
                border: `1px solid ${on ? "#89a7db" : "rgba(148,168,196,.2)"}`,
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {shown.length > 0 ? (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}>
          {shown.map((coin) => (
            <TokenCard
              key={coin.address}
              coin={coin}
              watched={isWatched(coin.address)}
              onToggleWatch={toggle}
            />
          ))}
        </div>
      ) : (
        <div
          className="bg-hull text-mist rounded-[9px] px-5 py-10 text-center text-sm"
          style={{ border: "1px dashed rgba(148,168,196,.2)" }}
        >
          {query
            ? `No ships match "${query}".`
            : filter === "watching"
              ? "Nothing on your watchlist yet — tap a ☆ on any ship."
              : filter === "graduating"
                ? "Every ship here has already graduated."
                : "The harbor's quiet — go launch something."}
        </div>
      )}
    </div>
  )
}
