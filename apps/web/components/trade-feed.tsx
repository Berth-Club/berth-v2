import Link from "next/link"

import type { FeedTrade } from "@/lib/indexer"

/**
 * A live column of the most recent buys and sells across the whole harbor.
 * Server-rendered from the indexer; the page's AutoRefresh keeps it current.
 * Distinct from the top marquee, which scrolls — this is a readable list.
 */
export function TradeFeed({ trades }: { trades: FeedTrade[] | null }) {
  return (
    <section className="rounded-card bg-hull border p-4" style={{ borderColor: "rgba(148,168,196,0.2)" }}>
      <div className="mb-3 flex items-center gap-2">
        <span className="relative flex size-2">
          <span className="bg-lime absolute inline-flex size-full animate-ping rounded-full opacity-60" />
          <span className="bg-lime relative inline-flex size-2 rounded-full" />
        </span>
        <h2 className="text-mist text-[13px] font-bold" style={{ letterSpacing: 1 }}>
          LIVE TRADES
        </h2>
      </div>

      {trades === null ? (
        <p className="text-mist py-6 text-center text-[13px]">Can&apos;t reach the ledger.</p>
      ) : trades.length === 0 ? (
        <p className="text-mist py-6 text-center text-[13px]">No trades yet — be the first to move.</p>
      ) : (
        <ul className="flex flex-col">
          {trades.map((t) => (
            <li key={t.id}>
              <Link
                href={`/token/${t.coin}`}
                className="hover:bg-deep -mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors"
              >
                <span
                  className="rounded-chip px-1.5 py-0.5 text-[10px] font-bold"
                  style={
                    t.isBuy
                      ? { color: "#7cc9a3", background: "rgba(124,201,163,.12)" }
                      : { color: "#de8092", background: "rgba(222,128,146,.12)" }
                  }
                >
                  {t.isBuy ? "BUY" : "SELL"}
                </span>
                <span className="tabular font-bold">{t.usd}</span>
                <span className="text-mist truncate">of ${t.symbol}</span>
                <span className="text-faint tabular ml-auto shrink-0">{t.ago}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
