"use client"

import * as React from "react"

import { TokenCard } from "@/components/token-card"
import type { Coin } from "@/lib/coin"

/**
 * The fleet grid with search + sort/filter — the discovery layer that turns a
 * static list into something you can actually navigate.
 *
 * Client-side over the already-fetched coins: the harbor is a few dozen coins on
 * a testnet, so filtering in the browser is instant and needs no round trip.
 * If the fleet ever grows past a few hundred, this moves server-side.
 */

type Sort = "new" | "volume" | "mcap" | "graduating" | "graduated"

const SORTS: { key: Sort; label: string }[] = [
  { key: "new", label: "Newest" },
  { key: "volume", label: "Top volume" },
  { key: "mcap", label: "Market cap" },
  { key: "graduating", label: "Almost there" },
  { key: "graduated", label: "Graduated" },
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

function sortCoins(coins: Coin[], sort: Sort): Coin[] {
  const out = [...coins]
  switch (sort) {
    case "new":
      return out.sort((a, b) => b.createdAt - a.createdAt)
    case "volume":
      return out.sort((a, b) => b.volumeUsd - a.volumeUsd)
    case "mcap":
      // marketCapNative, never the USD field — the latter goes null on a feed blip.
      return out.sort((a, b) => b.marketCapNative - a.marketCapNative)
    case "graduating":
      // Ungraduated coins closest to the line first; graduated ones drop to the end.
      return out
        .filter((c) => !c.graduated)
        .sort((a, b) => b.curve - a.curve)
    case "graduated":
      return out.filter((c) => c.graduated).sort((a, b) => b.marketCapNative - a.marketCapNative)
  }
}

export function Harbor({ coins }: { coins: Coin[] }) {
  const [query, setQuery] = React.useState("")
  const [sort, setSort] = React.useState<Sort>("new")

  const shown = React.useMemo(
    () => sortCoins(coins.filter((c) => matches(c, query)), sort),
    [coins, query, sort]
  )

  return (
    <div className="flex flex-col gap-4">
      {/* search + sort controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <span className="text-faint pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm" aria-hidden>
            ⌕
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, ticker or address…"
            aria-label="Search coins"
            className="bg-deep rounded-btn w-full border py-2 pl-9 pr-3 text-sm outline-none focus:border-lime"
            style={{ borderColor: "rgba(94,147,234,0.2)" }}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              aria-pressed={sort === s.key}
              className="rounded-chip px-2.5 py-1.5 text-xs font-bold transition-colors"
              style={
                sort === s.key
                  ? { color: "#05070c", background: "#c6ff3d" }
                  : { color: "#9fb0c3", background: "#0a1122", border: "1px solid rgba(94,147,234,0.2)" }
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* the grid */}
      {shown.length > 0 ? (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}>
          {shown.map((coin) => (
            <TokenCard key={coin.address} coin={coin} />
          ))}
        </div>
      ) : (
        <p className="text-mist py-10 text-center text-sm">
          {query
            ? `No ships match "${query}".`
            : sort === "graduated"
              ? "No ship has graduated yet."
              : "The harbor's quiet — go launch something."}
        </p>
      )}
    </div>
  )
}
