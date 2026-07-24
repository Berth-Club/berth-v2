import { CoinAvatar } from "@/components/coin-avatar"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { GraduationMeter } from "@workspace/ui/components/graduation-meter"
import { ChangeChip } from "@/components/token-card"
import { TradePanel } from "@/components/trade-panel"
import { PriceChart } from "@/components/price-chart"
import { CoinComments } from "@/components/coin-comments"
import { AutoRefresh } from "@/components/auto-refresh"
import { explorerTx, ipfsToGateway } from "@/lib/chain"
import { fmtPrice } from "@/lib/format"
import { fetchCoin, fetchHolders, fetchPriceHistory, fetchTrades } from "@/lib/indexer"

export const dynamic = "force-dynamic"

function SocialLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener nofollow"
      className="rounded-chip bg-deep hover:border-lime inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs transition-colors"
      style={{ borderColor: "#263A28" }}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </a>
  )
}

/**
 * Per-coin social card. When the coin has uploaded ipfs:// art we resolve it to
 * a gateway URL and use a large summary card; otherwise a plain summary, no
 * fabricated image. The image is already a hosted URL, so no ImageResponse.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>
}): Promise<Metadata> {
  const { address } = await params
  const coin = await fetchCoin(address)
  if (!coin) return { title: "Coin not found — berth.club" }

  const title = `${coin.name} ($${coin.ticker}) — berth.club`
  const description = coin.lore || `${coin.name} on berth.club`
  const imageUrl = ipfsToGateway(coin.image)

  return {
    title,
    description,
    openGraph: { title, description, ...(imageUrl ? { images: [imageUrl] } : {}) },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title,
      description,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
  }
}

export default async function TokenPage({
  params,
}: {
  params: Promise<{ address: string }>
}) {
  const { address } = await params
  // No fixture fallback: an address the indexer doesn't know is a 404, not an
  // invented coin page. (If the indexer is down this 404s too — wrong, but far
  // better than rendering a coin that does not exist.)
  const coin = await fetchCoin(address)
  if (!coin) notFound()

  // Both are null when the indexer can't answer. Nothing here is invented: an
  // un-traded coin shows no trades, and holders stay empty until it indexes them.
  const [trades, holders, history] = await Promise.all([
    fetchTrades(address),
    fetchHolders(address),
    fetchPriceHistory(address),
  ])

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-6">
      {/* Re-runs this server component every 15s so trades, chart, volume and
          holders track the chain without a manual refresh. */}
      <AutoRefresh />
      <Link href="/" className="text-mist hover:text-foam inline-block text-sm font-bold transition-colors">
        ← Back to harbor
      </Link>

      {/* header */}
      <div className="mt-5 flex flex-wrap items-start gap-4">
        <CoinAvatar
          image={coin.image}
          emoji={coin.emoji}
          name={coin.name}
          ticker={coin.ticker}
          size={64}
          className="bg-hull"
          style={{ border: "2px solid #263A28", borderRadius: 16 }}
        />
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
          {(coin.links.twitter || coin.links.telegram || coin.links.website) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {coin.links.twitter && <SocialLink href={coin.links.twitter} label="Twitter / X" icon="𝕏" />}
              {coin.links.telegram && <SocialLink href={coin.links.telegram} label="Telegram" icon="✈" />}
              {coin.links.website && <SocialLink href={coin.links.website} label="Website" icon="🌐" />}
            </div>
          )}
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
          <PriceChart points={history ?? []} volume={coin.vol} />

          <div className="mt-5">
            <GraduationMeter progress={coin.curve} graduated={coin.graduated} size="page" />
            <p className="text-mist mt-3 text-[13px]">
              Graduation — how far price has climbed the v3 range (~20,000 USDC buys it through). No
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
        <Panel
          title="TOP HOLDERS"
          note={holders?.count != null ? `${holders.count.toLocaleString()} aboard` : undefined}
        >
          {holders === null || holders.rows.length === 0 ? (
            <Empty>
              {/* TODO: the indexer has no `holder` table yet. No invented rows until it does. */}
              Holder manifest isn&rsquo;t indexed yet.
            </Empty>
          ) : (
            holders.rows.map((h) =>
              // the locked LP position is always the largest holder — by construction
              h.locked ? (
                <Row key={h.address}>
                  <span className="text-sm">🏦 locked position</span>
                  <span className="tabular text-mist text-sm">{fmtPct(h.pct)}</span>
                </Row>
              ) : (
                <Row key={h.address}>
                  <Link
                    href={`/u/${h.address}`}
                    className="tabular text-body2 hover:text-lime text-sm"
                  >
                    {shortAddr(h.address)}
                  </Link>
                  <span className="tabular text-mist text-sm">{fmtPct(h.pct)}</span>
                </Row>
              ),
            )
          )}
        </Panel>

        <Panel title="RECENT TRADES">
          {trades === null ? (
            <Empty>Can&rsquo;t reach the harbourmaster&rsquo;s log.</Empty>
          ) : trades.length === 0 ? (
            <Empty>No trades yet — this one&rsquo;s still at the dock.</Empty>
          ) : (
            trades.map((t) => (
              <Row key={t.id}>
                <span className="flex items-center gap-2 text-sm">
                  <span
                    className="rounded-chip px-1.5 py-0.5 text-[11px] font-bold uppercase"
                    style={{
                      color: t.kind === "buy" ? "#4ADE80" : "#F87171",
                      background:
                        t.kind === "buy" ? "rgba(74,222,128,.12)" : "rgba(248,113,113,.12)",
                    }}
                  >
                    {t.kind}
                  </span>
                  <span className="tabular">{t.eth} USDC</span>
                  <span className="text-mist">of ${coin.ticker}</span>
                </span>
                <a
                  href={explorerTx(t.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="tabular text-mist hover:text-lime text-xs transition-colors"
                >
                  {t.ago} ↗
                </a>
              </Row>
            ))
          )}
        </Panel>
      </div>

      {/* deck chatter — the engagement thread */}
      <div className="mt-6">
        <CoinComments coin={coin.address} />
      </div>
    </div>
  )
}

/** Holder share of the fixed 100B supply. Sub-0.01% is still not zero — say so. */
function fmtPct(pct: number): string {
  if (pct > 0 && pct < 0.01) return "<0.01%"
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 5)}…${addr.slice(-5)}`
}

function Panel({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-panel bg-hull border p-[18px]">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-mist text-xs font-bold" style={{ letterSpacing: 1 }}>
          {title}
        </h3>
        {note && <span className="tabular text-mist text-[11px]">{note}</span>}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-mist py-6 text-center text-sm">{children}</p>
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
