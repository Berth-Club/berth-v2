"use client"

import { CoinAvatar } from "@/components/coin-avatar"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { cn } from "@workspace/ui/lib/utils"
import { fmtPrice, fmtMc } from "@/lib/format"
import type { Coin } from "@/lib/coin"

/** The snap-buy size, in USDC. Matches the design's "⚡ Snap buy 100 USDC". */
export const SNAP_BUY_USDC = 100

/**
 * 24h chip — tinted green/red per the spec. `change: null` means "no trades
 * yet, no basis to compute it" and renders neutral: a coin that has never
 * traded must not show a green +0.0%.
 */
export function ChangeChip({
  change,
  className,
}: {
  change: number | null
  className?: string
}) {
  if (change === null) {
    return (
      <span className={cn("tabular rounded-chip text-mist bg-deep px-2 py-1 text-[13px]", className)}>
        —
      </span>
    )
  }
  const up = change >= 0
  return (
    <span
      className={cn("tabular rounded-chip px-2 py-1 text-[13px] font-bold", className)}
      style={{
        color: up ? "#7cc9a3" : "#de8092",
        background: up ? "rgba(124,201,163,.12)" : "rgba(222,128,146,.12)",
      }}
    >
      {up ? "+" : ""}
      {change.toFixed(1)}%
    </span>
  )
}

/**
 * A ship in the water. Hover lifts 4px + periwinkle border.
 *
 * The ☆ and the ⚡ row sit inside the card's link, so both swallow the click:
 * the star is a local toggle, snap-buy has its own destination. They're buttons
 * rather than nested <a>s — an anchor inside an anchor is invalid markup.
 */
export function TokenCard({
  coin,
  watched,
  onToggleWatch,
}: {
  coin: Coin
  watched?: boolean
  onToggleWatch?: (address: string) => void
}) {
  const router = useRouter()
  const pct = Math.round(Math.min(1, Math.max(0, coin.graduated ? 1 : coin.curve)) * 100)

  return (
    <Link
      href={`/token/${coin.address}`}
      className={cn(
        "bg-hull hover:shadow-card-hover hover:border-lime relative flex flex-col rounded-[9px] border p-4 transition-all duration-150 hover:-translate-y-1"
      )}
      style={{
        borderColor: coin.graduated ? "rgba(137,167,219,.55)" : "rgba(148,168,196,0.2)",
      }}
    >
      {/* graduated tab straddles the top border */}
      {coin.graduated && (
        <span
          className="text-gold absolute left-3.5 text-[11px] font-bold"
          style={{
            top: -11,
            letterSpacing: 1.5,
            background: "#0d1a2b",
            border: "1px solid rgba(137,167,219,.55)",
            borderRadius: 10,
            padding: "3px 10px",
          }}
        >
          🎓 GRADUATED
        </span>
      )}

      <div className="flex items-center gap-3">
        <CoinAvatar
          image={coin.image}
          emoji={coin.emoji}
          name={coin.name}
          ticker={coin.ticker}
          size={48}
          className="bg-deep rounded-[9px]"
          style={{ border: "1px solid rgba(148,168,196,0.2)" }}
        />
        <div className="min-w-0">
          <div className="truncate font-bold">{coin.name}</div>
          <div className="text-mist text-[13px]">${coin.ticker}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ChangeChip change={coin.change24h} />
          {onToggleWatch && (
            <button
              type="button"
              title={watched ? "Remove from watchlist" : "Add to watchlist"}
              aria-label={watched ? `Unwatch $${coin.ticker}` : `Watch $${coin.ticker}`}
              aria-pressed={watched}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onToggleWatch(coin.address)
              }}
              className={cn(
                "hover:text-lime text-base leading-none transition-colors",
                watched ? "text-gold" : "text-faint"
              )}
            >
              {watched ? "★" : "☆"}
            </button>
          )}
        </div>
      </div>

      <div className="mt-3.5 flex justify-between text-sm">
        <span>
          <span className="text-mist">Price </span>
          <span className="tabular">{fmtPrice(coin.priceUsd)}</span>
        </span>
        <span>
          <span className="text-mist">MC </span>
          <span className="tabular">{fmtMc(coin.marketCapUsd)}</span>
        </span>
      </div>

      {/* graduation bar with the ⛵ riding the head of the fill */}
      <div className="mt-3">
        <div className="text-mist mb-1.5 flex justify-between text-[11px]">
          <span>Graduation</span>
          <span className="tabular">{pct}%</span>
        </div>
        <div className="bg-deep relative h-2 rounded-md">
          <div
            className="animate-flow h-full rounded-md"
            style={{
              width: `${pct}%`,
              backgroundImage: "linear-gradient(90deg,#4f74a8,#d3e0f9,#89a7db,#4f74a8)",
              backgroundSize: "200% 100%",
            }}
          />
          <span
            aria-hidden
            className="absolute text-[22px] leading-none"
            style={{ top: -11, left: `${pct}%`, transform: "translateX(-60%)" }}
          >
            ⛵
          </span>
        </div>
      </div>

      {/* Opens the coin with the amount pre-filled — it does NOT fire a trade.
          A one-click 100 USDC swap straight off a grid card is not something to
          do before the user has seen the quote and the price impact. */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          router.push(`/token/${coin.address}?buy=${SNAP_BUY_USDC}`)
        }}
        className="text-gold hover:border-lime mt-3 rounded-[10px] py-2.5 text-center text-[13px] font-bold transition-colors"
        style={{
          background: "rgba(137,167,219,.07)",
          border: "1px solid rgba(148,168,196,.2)",
        }}
      >
        ⚡ Snap buy {SNAP_BUY_USDC} USDC
      </button>
    </Link>
  )
}
