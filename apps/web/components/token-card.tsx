"use client"

import { CoinAvatar } from "@/components/coin-avatar"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { cn } from "@workspace/ui/lib/utils"
import { fmtMc } from "@/lib/format"
import type { Coin } from "@/lib/coin"

/** The snap-buy size, in USDC. Matches the design's "⚡ Snap buy 100 USDC". */
export const SNAP_BUY_USDC = 100

/**
 * 24h chip — tinted green/red per the spec. `change: null` means "no trades
 * yet, no basis to compute it" and renders neutral: a coin that has never
 * traded must not show a green +0.0%.
 *
 * Kept here because the Analytics screen (`app/stats`) still renders it; the
 * Harbor cards themselves no longer show per-token change (removed by v3).
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
 * A ship in the water — v3 flat-glass card. Per-token generated art fills the
 * square tile (the creator's uploaded face, or the deterministic emoji on a
 * moonlit radial), a "Graduated" pill rides the top-left of graduated coins,
 * and a ⚡ snap-buy pill sits top-right.
 *
 * The card links to `/coin/${ticker}`. The ⚡ pill has its own destination
 * (`?buy=100`), so it's a <button> that swallows the click — an anchor nested
 * in an anchor is invalid markup.
 */
export function TokenCard({ coin }: { coin: Coin }) {
  const router = useRouter()

  return (
    <Link
      href={`/coin/${coin.ticker}`}
      className="group relative flex flex-col rounded-[20px] border p-3 pb-3.5 transition-transform duration-150 hover:-translate-y-1"
      style={{
        background: "rgba(13,24,39,.82)",
        borderColor: coin.graduated ? "rgba(137,167,219,.55)" : "rgba(148,168,196,.2)",
        boxShadow: "0 14px 30px -18px rgba(3,8,16,.7)",
      }}
    >
      {/* per-token generated art */}
      <div
        className="relative grid aspect-square place-items-center overflow-hidden rounded-[14px]"
        style={{
          background: "radial-gradient(circle at 50% 40%, #14345a, #0a1524 82%)",
          border: "1px solid rgba(148,168,196,.16)",
        }}
      >
        {/* Fills the tile edge-to-edge: uploaded art is full-bleed (object-cover,
            clipped to the tile's rounding); the emoji fallback stays centered at
            a sensible size (size drives only the emoji font). */}
        <CoinAvatar
          image={coin.image}
          emoji={coin.emoji}
          name={coin.name}
          ticker={coin.ticker}
          size={96}
          className="bg-transparent"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />

        {coin.graduated && (
          <span
            className="absolute left-2.5 top-2.5 text-[12px] font-semibold"
            style={{
              color: "#e9eef7",
              background: "rgba(13,26,43,.5)",
              border: "1px solid rgba(234,241,250,.22)",
              borderRadius: 999,
              padding: "5px 12px",
              backdropFilter: "blur(6px)",
            }}
          >
            Graduated
          </span>
        )}

        {/* Opens the coin with 100 USDC pre-filled — it does NOT fire a trade.
            A one-click swap off a grid card is not something to do before the
            user has seen the quote and the price impact. */}
        <button
          type="button"
          title="Snap buy 100 USDC"
          aria-label={`Snap buy 100 USDC of $${coin.ticker}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            router.push(`/coin/${coin.ticker}?buy=${SNAP_BUY_USDC}`)
          }}
          className="absolute right-2.5 top-2.5 leading-none transition-colors"
          style={{
            fontSize: 13,
            color: "#d3e0f9",
            background: "rgba(13,26,43,.72)",
            border: "1px solid rgba(148,168,196,.35)",
            borderRadius: 999,
            padding: "6px 10px",
            backdropFilter: "blur(4px)",
          }}
        >
          ⚡
        </button>
      </div>

      <div className="font-display mt-[11px] truncate text-[16.5px]">{coin.name}</div>
      <div className="text-mist mt-px text-[13px]">${coin.ticker}</div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="tabular text-[19px]">{fmtMc(coin.marketCapUsd)}</span>
        <span className="text-faint text-[11px] font-semibold tracking-[.1em]">MC</span>
      </div>

      {/* mt-auto: footers stay aligned even if a card above it ever grows */}
      <div className="text-faint mt-auto flex justify-between gap-2 pt-2 text-[12.5px]">
        <span className="tabular truncate">{coin.creator}</span>
        <span className="shrink-0">{coin.age} ago</span>
      </div>
    </Link>
  )
}
