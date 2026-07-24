import { CoinAvatar } from "@/components/coin-avatar"
import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"
import { GraduationMeter } from "@workspace/ui/components/graduation-meter"
import { fmtPrice, fmtMc } from "@/lib/format"
import type { Coin } from "@/lib/coin"

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
      <span className={cn("tabular rounded-chip text-mist bg-deep px-1.5 py-0.5 text-xs", className)}>
        —
      </span>
    )
  }
  const up = change >= 0
  return (
    <span
      className={cn("tabular rounded-chip px-1.5 py-0.5 text-xs", className)}
      style={{
        color: up ? "#4ADE80" : "#F87171",
        background: up ? "rgba(74,222,128,.12)" : "rgba(248,113,113,.12)",
      }}
    >
      {up ? "+" : ""}
      {change.toFixed(1)}%
    </span>
  )
}

/** A ship in the water. Hover lifts 4px + lime border. */
export function TokenCard({ coin }: { coin: Coin }) {
  return (
    <Link
      href={`/token/${coin.address}`}
      className={cn(
        "rounded-card bg-hull relative flex flex-col gap-3 border p-4 transition-all duration-150",
        "hover:-translate-y-1 hover:shadow-card-hover",
        coin.graduated ? "hover:border-gold" : "hover:border-lime"
      )}
      style={{
        borderColor: coin.graduated ? "rgba(251,191,36,.55)" : "#263A28",
      }}
    >
      {/* graduated tab sits ON the top border */}
      {coin.graduated && (
        <span
          className="text-gold absolute left-3.5 text-[11px] font-bold"
          style={{ top: -11, background: "#0C130E", padding: "0 6px" }}
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
          className="rounded-chip bg-deep"
          style={{ border: "1px solid #263A28" }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-bold">{coin.name}</span>
            <span className="text-mist tabular shrink-0 text-xs">${coin.ticker}</span>
          </div>
          <div className="text-faint mt-0.5 text-xs">
            <span className="tabular">{coin.creator}</span> · <span className="tabular">{coin.age}</span> ago
          </div>
        </div>
        <ChangeChip change={coin.change24h} />
      </div>

      <div className="flex items-baseline justify-between text-[13px]">
        <span className="tabular">{fmtPrice(coin.priceUsd)}</span>
        <span className="text-mist">
          MC <span className="tabular text-foam">{fmtMc(coin.marketCapUsd)}</span>
        </span>
      </div>

      {/* dense stats at a glance — the data was already fetched, just unshown */}
      <div className="text-faint flex items-center gap-3 text-[11px]">
        <span className="tabular">Vol {coin.vol ?? "—"}</span>
        <span aria-hidden>·</span>
        <span className="tabular">
          {coin.holderCount} {coin.holderCount === 1 ? "holder" : "holders"}
        </span>
      </div>

      <GraduationMeter progress={coin.curve} graduated={coin.graduated} />
    </Link>
  )
}
