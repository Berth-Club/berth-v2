import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { createPublicClient, http } from "viem"

import { TradePanel } from "@/components/trade-panel"
import { PriceChart } from "@/components/price-chart"
import { CoinComments } from "@/components/coin-comments"
import { CopyPill } from "@/components/copy-pill"
import { AutoRefresh } from "@/components/auto-refresh"
import { PendingCoin } from "@/components/pending-coin"
import { UserAvatar } from "@/components/user-avatar"
import { arc, explorerAddress, explorerTx, ipfsToGateway } from "@/lib/chain"
import { env } from "@/lib/env"
import { fmtMc, fmtPrice } from "@/lib/format"
import {
  fetchCoin,
  fetchCoinPool,
  fetchPriceHistory,
  fetchTrades,
} from "@/lib/indexer"
import { fetchHolders } from "@/lib/holders"
import { getProfile, getProfiles } from "@/lib/profiles"

/** Is there a deployed contract at this address? A just-launched coin exists
 *  on-chain before the indexer logs it — that's a poll-and-wait, not a 404. */
async function hasContract(address: string): Promise<boolean> {
  try {
    const client = createPublicClient({ chain: arc, transport: http(env.rpcUrl) })
    const code = await client.getCode({ address: address as `0x${string}` })
    return !!code && code !== "0x"
  } catch {
    return false
  }
}

export const dynamic = "force-dynamic"

/**
 * Trades / holders cards. Both lists are capped and scroll inside the card
 * (the chat card already does this) — unbounded, 20 trades stretched the card
 * past 1000px and `items-stretch` dragged the 12-row holders card up with it,
 * leaving a wall of empty panel.
 */
const LIST_CARD = "glass flex h-[420px] min-w-[300px] flex-col p-6"
const LIST_SCROLL = "-mr-2 min-h-0 flex-1 overflow-y-auto pr-2"

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
  // No fixture fallback: an address the indexer doesn't know is NOT invented.
  // But a coin that just launched is on-chain seconds before the indexer logs
  // it — so if a contract exists there, poll until it appears instead of 404ing
  // the creator straight off their own launch. Only a codeless address is a 404.
  const coin = await fetchCoin(address)
  if (!coin) {
    if (await hasContract(address)) return <PendingCoin address={address} />
    notFound()
  }

  // All are null when the indexer can't answer. Nothing here is invented:
  // an un-traded coin shows no trades, and holders stay empty until indexed.
  const [trades, holders, history, pool, creatorProfile] = await Promise.all([
    fetchTrades(address),
    fetchHolders(address),
    fetchPriceHistory(address),
    fetchCoinPool(address),
    getProfile(coin.creatorAddress),
  ])
  // Batch-resolve holder identities in one query (see origin plan R9, R10).
  const holderProfiles = await getProfiles(holders?.rows.map((h) => h.address) ?? [])

  const pct = Math.round(Math.min(1, Math.max(0, coin.graduated ? 1 : coin.curve)) * 100)

  // Inline social links for the meta line — only the keys the creator supplied.
  const socials = [
    coin.links.twitter && { label: "𝕏", href: coin.links.twitter },
    coin.links.telegram && { label: "Telegram", href: coin.links.telegram },
    coin.links.website && { label: "Website", href: coin.links.website },
  ].filter(Boolean) as { label: string; href: string }[]

  // Four external-market chips. Contract/Pool go to the real Arc explorer
  // (testnet.arcscan.app, via explorerAddress); the pool falls back to the coin
  // address when the indexer hasn't handed us a pool. Dexscreener/GeckoTerminal
  // resolve either address to the token's live USDC pool.
  const poolAddr = pool ?? coin.address
  const extLinks = [
    { label: "Dexscreener", href: `https://dexscreener.com/arc/${coin.address}` },
    { label: "GeckoTerminal", href: `https://www.geckoterminal.com/arc/pools/${poolAddr}` },
    { label: "Contract", href: explorerAddress(coin.address) },
    { label: "Pool", href: explorerAddress(poolAddr) },
  ]

  return (
    <div className="mx-auto max-w-[1280px] px-5 pb-20 pt-6">
      {/* Re-runs this server component every 15s so trades, chart, volume and
          holders track the chain without a manual refresh. */}
      <AutoRefresh />

      <Link href="/" className="btn-ghost mb-4 inline-flex items-center gap-2 px-4 py-2.5 text-[13.5px]">
        ‹ Back
      </Link>

      {/* ---- About: a compact card that uses all four corners ---- */}
      <div className="glass mb-4 px-5 py-4">
        {/* top row — About + description (left) · CONTRACT ADDRESS pill (right) */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-[1_1_340px]">
            <h1 className="font-display text-[15.5px]" style={{ letterSpacing: "-.01em" }}>
              About
            </h1>
            <p className="text-mist mt-[5px] max-w-[70ch] text-[13.5px] leading-[1.6] text-pretty">
              {coin.lore ||
                "Minted, pooled and locked in one transaction — keys burned at launch. 1% fee on every trade, split with the creator. No exit but through the curve."}
            </p>
          </div>
          <div className="min-w-0 shrink text-right">
            <div className="text-faint mb-[5px] text-[10.5px] font-medium" style={{ letterSpacing: ".12em" }}>
              CONTRACT ADDRESS
            </div>
            <CopyPill address={coin.address} />
          </div>
        </div>

        {/* bottom row — meta line (left) · external market chips (right) */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-faint flex flex-wrap items-center gap-[11px] text-[12.5px]">
            <span>
              by{" "}
              <Link
                href={`/u/${coin.creatorAddress}`}
                className={`text-gold hover:text-lime-hi ${creatorProfile?.name ? "" : "tabular"}`}
              >
                {creatorProfile?.name ?? coin.creator}
              </Link>
            </span>
            <span style={{ color: "rgba(148,168,196,.4)" }}>·</span>
            <span>launched {coin.age} ago</span>
            {coin.graduated && (
              <span
                className="text-gold rounded-full px-[9px] py-[2px] text-[11px] font-semibold"
                style={{ border: "1px solid rgba(137,167,219,.4)" }}
              >
                🎓 graduated
              </span>
            )}
            {socials.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noreferrer noopener nofollow"
                className="text-gold font-semibold hover:text-lime-hi"
              >
                {s.label} ↗
              </a>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap justify-end gap-1.5">
            {extLinks.map((lk) => (
              <a
                key={lk.label}
                href={lk.href}
                target="_blank"
                rel="noreferrer noopener nofollow"
                className="bg-hull text-body2 hover:border-lime hover:text-lime-hi inline-flex items-center gap-1 rounded-full px-[11px] py-[5px] text-[11.5px] font-semibold transition-colors"
                style={{ border: "1px solid rgba(148,168,196,.22)" }}
              >
                {lk.label} ↗
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* ---- swap · market · chat ---- */}
      {/* items-stretch so the chat card matches the tallest sibling's height */}
      <div className="flex flex-wrap items-stretch gap-4">
        <TradePanel coin={coin} creatorName={creatorProfile?.name ?? null} />

        {/* market card */}
        <div className="glass min-w-0 flex-[2.2_1_430px] overflow-hidden">
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))",
              borderBottom: "1px solid rgba(148,168,196,.14)",
            }}
          >
            <Stat label="Market cap" value={fmtMc(coin.marketCapUsd)} />
            <Stat label="24h volume" value={coin.vol ?? "—"} />
            <Stat
              label="Holders"
              value={holders?.count != null ? holders.count.toLocaleString() : "—"}
            />
            <Stat label="Trades" value={trades ? String(trades.length) : "—"} />
          </div>

          <div className="flex flex-wrap items-end gap-3.5 px-5 pb-1 pt-[18px]">
            <div>
              <div className="tabular text-[32px] leading-none" style={{ letterSpacing: "-.02em" }}>
                {fmtPrice(coin.priceUsd)}
              </div>
              <div
                className="mt-1 text-[13.5px] font-semibold"
                style={{
                  color:
                    coin.change24h === null ? "#93a8c4" : coin.change24h >= 0 ? "#7cc9a3" : "#de8092",
                }}
              >
                {coin.change24h === null
                  ? "no trades yet"
                  : `${coin.change24h >= 0 ? "+" : ""}${coin.change24h.toFixed(1)}%`}{" "}
                <span className="text-faint font-medium">today</span>
              </div>
            </div>
          </div>

          <div className="px-2 pt-1.5">
            <PriceChart points={history ?? []} volume={coin.vol} />
          </div>

          <div className="px-5 pb-5 pt-9">
            <div className="text-mist mb-5 flex justify-between text-xs">
              <span>Graduation</span>
              <span className="tabular text-foam font-semibold">{pct}%</span>
            </div>
            <div
              className="relative h-2.5 rounded-lg"
              style={{
                background: "rgba(3,8,16,.85)",
                border: "1px solid rgba(148,168,196,.1)",
                boxShadow: "inset 0 1px 3px rgba(0,0,0,.55)",
              }}
            >
              <div
                className="animate-flow shadow-meter-glow h-full rounded-lg"
                style={{
                  width: `${pct}%`,
                  backgroundImage: "linear-gradient(90deg,#4f74a8,#d3e0f9,#89a7db,#4f74a8)",
                  backgroundSize: "200% 100%",
                }}
              />
              <span
                aria-hidden
                className="absolute text-2xl leading-none"
                style={{ top: -13, left: `${pct}%`, transform: "translateX(-60%)" }}
              >
                ⛵
              </span>
            </div>
          </div>
        </div>

        {/* chat card — flex-col so CoinComments can grow the thread and pin the
            composer to the bottom, matching the sibling cards' height */}
        <div className="glass flex w-full min-w-0 flex-col p-5 lg:max-w-[360px] lg:flex-[1_1_270px]">
          <CoinComments coin={coin.address} symbol={coin.ticker} />
        </div>
      </div>

      {/* ---- recent trades · top holders ---- */}
      <div className="mt-4 flex flex-wrap items-stretch gap-4">
        <div className={`${LIST_CARD} flex-[1.3_1_420px]`}>
          <div className="mb-2.5 flex items-baseline justify-between">
            <h2 className="text-faint text-xs font-medium" style={{ letterSpacing: ".12em" }}>
              RECENT TRADES
            </h2>
            <span className="text-faint flex items-center gap-[7px] text-xs">
              <span className="animate-pulse-soft bg-candle size-1.5 rounded-full" />
              live
            </span>
          </div>
          <div className={LIST_SCROLL}>
            {trades === null ? (
              <Empty>Can&rsquo;t reach the harbourmaster&rsquo;s log.</Empty>
            ) : trades.length === 0 ? (
              <Empty>No trades yet — this one&rsquo;s still at the dock.</Empty>
            ) : (
              trades.map((t) => (
                <Row key={t.id}>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase"
                    style={{
                      color: t.kind === "buy" ? "#7cc9a3" : "#de8092",
                      background: t.kind === "buy" ? "rgba(124,201,163,.12)" : "rgba(222,128,146,.12)",
                    }}
                  >
                    {t.kind}
                  </span>
                  <span className="tabular truncate font-semibold">
                    {t.eth} <span className="text-mist font-sans font-normal">USDC of ${coin.ticker}</span>
                  </span>
                  <a
                    href={explorerTx(t.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="tabular text-mist hover:text-lime ml-auto shrink-0 text-[13px] transition-colors"
                  >
                    {t.ago} ↗
                  </a>
                </Row>
              ))
            )}
          </div>
        </div>

        <div className={`${LIST_CARD} flex-[1_1_380px]`}>
          <div className="mb-2.5 flex items-baseline justify-between">
            <h2 className="text-faint text-xs font-medium" style={{ letterSpacing: ".12em" }}>
              TOP HOLDERS
            </h2>
            {holders?.count != null && (
              <span className="tabular text-mist text-[13px]">
                {holders.count.toLocaleString()} aboard
              </span>
            )}
          </div>
          <div className={LIST_SCROLL}>
            {holders === null || holders.rows.length === 0 ? (
              <Empty>Holder manifest isn&rsquo;t indexed yet.</Empty>
            ) : (
              holders.rows.map((h) => (
                <div
                  key={h.address}
                  className="py-[11px]"
                  style={{ borderBottom: "1px solid rgba(148,168,196,.14)" }}
                >
                  <div className="flex justify-between gap-3 text-[14.5px]">
                    {/* the locked LP position is always the largest holder — by construction */}
                    {h.locked ? (
                      <span className="text-body2 truncate">🏦 locked position</span>
                    ) : (
                      <Link
                        href={`/u/${h.address}`}
                        className="text-body2 hover:text-lime flex min-w-0 items-center gap-2"
                      >
                        <UserAvatar
                          address={h.address}
                          image={holderProfiles.get(h.address.toLowerCase())?.image}
                          size={20}
                        />
                        <span
                          className={`truncate ${holderProfiles.get(h.address.toLowerCase())?.name ? "" : "tabular"}`}
                        >
                          {holderProfiles.get(h.address.toLowerCase())?.name ??
                            `${h.address.slice(0, 5)}…${h.address.slice(-5)}`}
                        </span>
                      </Link>
                    )}
                    <span className="tabular shrink-0 font-semibold">{fmtPct(h.pct)}</span>
                  </div>
                  <div
                    className="mt-[7px] h-1 overflow-hidden rounded-full"
                    style={{ background: "rgba(148,168,196,.14)" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, h.pct)}%`,
                        background: "linear-gradient(90deg,#4f74a8,#8fb0e8)",
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-[15px]" style={{ boxShadow: "0 0 0 .5px rgba(148,168,196,.14)" }}>
      <div className="text-faint text-xs">{label}</div>
      <div className="tabular mt-1 text-[17px]">{value}</div>
    </div>
  )
}

/** Holder share of the fixed 100B supply. Sub-0.01% is still not zero — say so. */
function fmtPct(pct: number): string {
  if (pct > 0 && pct < 0.01) return "<0.01%"
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-mist py-6 text-center text-sm">{children}</p>
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-3 py-3 text-[14.5px]"
      style={{ borderBottom: "1px solid rgba(148,168,196,0.14)" }}
    >
      {children}
    </div>
  )
}
