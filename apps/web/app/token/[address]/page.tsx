import Link from "next/link"
import { notFound } from "next/navigation"

import { cn } from "@workspace/ui/lib/utils"
import { GraduationMeter } from "@workspace/ui/components/graduation-meter"
import { ChangeChip } from "@/components/token-card"
import { TradePanel } from "@/components/trade-panel"
import { PriceChart } from "@/components/price-chart"
import { fmtPrice, fmtMc } from "@/lib/format"
import { getCoin, getHolders, getTrades } from "@/lib/mock"
import { fetchCoin } from "@/lib/indexer"

export const dynamic = "force-dynamic"

export default async function TokenPage({
  params,
}: {
  params: Promise<{ address: string }>
}) {
  const { address } = await params
  // live first, demo data as fallback so the page still renders offline
  const coin = (await fetchCoin(address)) ?? getCoin(address)
  if (!coin) notFound()

  const holders = getHolders(coin)
  const trades = getTrades(coin)

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-6">
      <Link href="/" className="text-mist hover:text-foam inline-block text-sm font-bold transition-colors">
        ← Back to harbor
      </Link>

      {/* header */}
      <div className="mt-5 flex flex-wrap items-start gap-4">
        <span
          className="bg-hull grid size-16 shrink-0 place-items-center text-[34px]"
          style={{ border: "2px solid #263A28", borderRadius: 16 }}
          aria-hidden
        >
          {coin.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[30px] leading-tight">
            {coin.name} <span className="text-mist tabular text-xl">${coin.ticker}</span>
          </h1>
          <div className="text-mist mt-1 text-[13px]">
            created by{" "}
            <Link href={`/u/${coin.creator}`} className="text-lime tabular hover:underline">
              {coin.creator}
            </Link>{" "}
            · <span className="tabular">{coin.age}</span> ago
          </div>
          {coin.graduated && (
            <span
              className="text-gold mt-2 inline-block text-[11px] font-bold"
              style={{ border: "1px solid rgba(251,191,36,.55)", borderRadius: 8, padding: "2px 8px" }}
            >
              🎓 GRADUATED
            </span>
          )}
          <p className="text-mist mt-2 max-w-lg text-sm">{coin.lore}</p>
        </div>
        <div className="text-right">
          <div className="tabular text-[30px] leading-none">{fmtPrice(coin.priceUsd)}</div>
          <div className="mt-1 text-[13px]">
            <ChangeChip change={coin.change24h} /> <span className="text-mist">today</span>
          </div>
        </div>
      </div>

      {/* two columns: chart card + trade panel */}
      <div
        className="mt-5 grid items-start gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}
      >
        <div className="rounded-panel bg-hull border p-[18px]">
          <PriceChart seed={coin.address} change={coin.change24h} volume={coin.vol} />

          <div className="mt-5">
            <GraduationMeter progress={coin.curve} graduated={coin.graduated} size="page" />
            <p className="text-mist mt-3 text-[13px]">
              Graduation — how far price has climbed the v3 range (~6.9 WETH buys it through). No
              migration, it just keeps trading.
            </p>
          </div>
        </div>

        <TradePanel coin={coin} />
      </div>

      {/* top holders + activity */}
      <div
        className="mt-4 grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}
      >
        <Panel title="TOP HOLDERS">
          {/* the locked LP position is always the largest holder — by construction */}
          <Row>
            <span className="text-sm">🏦 locked position</span>
            <span className="tabular text-mist text-sm">{holders[0]!.pct}%</span>
          </Row>
          {holders.slice(1).map((h) => (
            <Row key={h.who}>
              <Link href={`/u/${h.who}`} className="tabular text-body2 hover:text-lime text-sm">
                {h.who}
              </Link>
              <span className="tabular text-mist text-sm">{h.pct}%</span>
            </Row>
          ))}
        </Panel>

        <Panel title="RECENT TRADES">
          {trades.map((t, i) => (
            <Row key={i}>
              <span className="flex items-center gap-2 text-sm">
                <span
                  className="rounded-chip px-1.5 py-0.5 text-[11px] font-bold uppercase"
                  style={{
                    color: t.kind === "buy" ? "#4ADE80" : "#F87171",
                    background: t.kind === "buy" ? "rgba(74,222,128,.12)" : "rgba(248,113,113,.12)",
                  }}
                >
                  {t.kind}
                </span>
                <span className="tabular">{t.eth} Ξ</span>
                <span className="text-mist">of ${coin.ticker}</span>
              </span>
              <span className="tabular text-mist text-xs">{t.ago}</span>
            </Row>
          ))}
        </Panel>
      </div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-panel bg-hull border p-[18px]">
      <h3 className="text-mist mb-2 text-xs font-bold" style={{ letterSpacing: 1 }}>
        {title}
      </h3>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between py-2.5"
      style={{ borderBottom: "1px solid #1a281c" }}
    >
      {children}
    </div>
  )
}
