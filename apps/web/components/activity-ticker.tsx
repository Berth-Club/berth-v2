"use client"

import * as React from "react"

import { env } from "@/lib/env"

/**
 * Ticker tape under the header — real launches and trades from the indexer.
 *
 * This used to be a hardcoded MOCK_FEED inventing specific trades ("0x3f2…a91
 * loaded 0.42 USDC into $KRAKEN") on a platform where nobody had traded at all. It
 * sat on every page of a public site, which made it the most-seen untruth we
 * shipped. If there is nothing to report, the tape renders nothing.
 */
const INDEXER_URL = env.indexerUrl

/**
 * The SwapRouter appears as `sender` on every swap, and as `recipient` on sells
 * too (unwrapWUSDC sends WUSDC back through it before unwrapping to the user).
 * So a sell has no attributable trader in the event — we say what happened
 * without inventing who did it, rather than crediting the router as a person.
 */
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2"

const ACTIVITY_QUERY = `{
  swaps(orderBy: "timestamp", orderDirection: "desc", limit: 12) {
    items { id coin isBuy amountNative amountToken recipient timestamp }
  }
  coins(orderBy: "createdAt", orderDirection: "desc", limit: 12) {
    items { address symbol createdAt }
  }
}`

type Item = { key: string; text: string; ts: number }

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function eth(wei: string): string {
  const n = Number(wei) / 1e18
  if (n === 0) return "0"
  if (n < 0.000001) return "<0.000001"
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 })
}

function tokens(wei: string): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(wei) / 1e18)
}

type RawSwap = {
  id: string
  coin: string
  isBuy: boolean
  amountNative: string
  amountToken: string
  recipient: string
  timestamp: string
}
type RawCoin = { address: string; symbol: string; createdAt: string }

function build(swaps: RawSwap[], coins: RawCoin[]): Item[] {
  const symbolOf = new Map(coins.map((c) => [c.address.toLowerCase(), c.symbol]))

  const launches: Item[] = coins.map((c) => ({
    key: `launch-${c.address}`,
    text: `🚢 $${c.symbol} left the shipyard`,
    ts: Number(c.createdAt),
  }))

  const trades: Item[] = swaps.map((s) => {
    const sym = symbolOf.get(s.coin.toLowerCase()) ?? "???"
    const who = s.recipient.toLowerCase() === ROUTER ? null : short(s.recipient)
    const text = s.isBuy
      ? `🟢 ${who ? `${who} ` : ""}loaded ${eth(s.amountNative)} USDC into $${sym}`
      : `🔴 ${who ? `${who} ` : ""}cashed out ${tokens(s.amountToken)} $${sym}`
    return { key: `swap-${s.id}`, text, ts: Number(s.timestamp) }
  })

  return [...launches, ...trades].sort((a, b) => b.ts - a.ts).slice(0, 10)
}

export function ActivityTicker() {
  const [items, setItems] = React.useState<Item[] | null>(null)

  React.useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(`${INDEXER_URL}/graphql`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: ACTIVITY_QUERY }),
          cache: "no-store",
        })
        if (!res.ok) return
        const json = await res.json()
        if (json?.errors) return
        const swaps = json?.data?.swaps?.items ?? []
        const coins = json?.data?.coins?.items ?? []
        if (alive) setItems(build(swaps, coins))
      } catch {
        // indexer unreachable — leave the tape empty rather than invent one
      }
    }
    void load()
    const id = window.setInterval(load, 30_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  // Nothing real to say yet: render nothing at all.
  if (!items || items.length === 0) return null

  return (
    <div
      className="bg-deep overflow-hidden"
      style={{ borderTop: "1px solid rgba(148,168,196,0.16)" }}
    >
      <div className="animate-tape flex w-max">
        {/* duplicated for the seamless -50% loop */}
        {[...items, ...items].map((item, i) => (
          <span
            key={`${item.key}-${i}`}
            className="text-mist whitespace-nowrap px-[26px] py-[9px] text-[11px] font-medium"
            style={{ letterSpacing: ".16em" }}
          >
            {item.text} <span className="text-faint">· {ago(item.ts)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
