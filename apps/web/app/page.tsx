import { CoinAvatar } from "@/components/coin-avatar"
import Image from "next/image"
import Link from "next/link"

import { ChangeChip } from "@/components/token-card"
import { fmtMc, fmtPrice } from "@/lib/format"
import { fetchCoins, fetchIndexerStatus, fetchStats, fetchRecentTrades, formatLag } from "@/lib/indexer"
import { AutoRefresh } from "@/components/auto-refresh"
import { Harbor } from "@/components/harbor"
import { TradeFeed } from "@/components/trade-feed"

// Always read fresh from the indexer.
export const dynamic = "force-dynamic"

const TRUST = [
  { icon: "🔒", title: "Liquidity locked forever", body: "the anchor never comes up — not for us, not for anyone" },
  { icon: "🚫", title: "Fixed 100B supply", body: "minted once at launch — no one can ever print more" },
  { icon: "🛡️", title: "No admin over your coin", body: "no one can seize, freeze, or scuttle your ship" },
  { icon: "💸", title: "1% fee → the creator", body: "every trade pays the ship's builder, not a middleman" },
]

const GOLD = { color: "#f2c94c", background: "rgba(242,201,76,.12)", border: "1px solid rgba(242,201,76,.35)" }

export default async function HarborPage() {
  // null = indexer unreachable. [] = reachable, genuinely no coins. These are
  // different facts and the page says which; it never fills the gap with
  // invented coins. A "demo data" pill in the corner was no match for a full
  // grid of plausible fake coins with prices and graduation meters.
  const [coins, status, stats, feed] = await Promise.all([
    fetchCoins(),
    fetchIndexerStatus(),
    fetchStats(),
    fetchRecentTrades(),
  ])

  // Shown ONLY when the page is incomplete. "Live · chain 5042002" and a block
  // height are developer status: they told a visitor nothing they could act on,
  // and put a number on screen that invited questions the page could not answer.
  //
  // The lag warning stays, and is load-bearing — a behind indexer means launches
  // that already happened are missing from this grid, and silently showing a
  // short list as if it were the whole harbor is the failure this replaced.
  const badge =
    status && !status.synced
      ? {
          label: `● syncing · ${formatLag(status.lagSeconds)}`,
          style: GOLD,
          title: `Coins launched in the last ${formatLag(status.lagSeconds)} aren't here yet.`,
        }
      : null

  const king = coins?.length ? [...coins].sort((a, b) => b.marketCapNative - a.marketCapNative)[0]! : null

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-7">
      {/* Keeps the harbor grid and the syncing badge current without a reload. */}
      <AutoRefresh seconds={20} />
      {/* hero */}
      <section className="mb-7 flex items-center gap-6">
        <div className="min-w-0 flex-1">
          <h1
            className="font-display uppercase leading-[1.05]"
            style={{ fontSize: "clamp(34px,5vw,58px)", letterSpacing: "-0.035em" }}
          >
            The sea doesn&apos;t care if you <span style={{ color: "#ff8f6e" }}>drown</span>.
            <br />
            Build something that <span className="text-lime">floats</span>.
          </h1>
          <p className="text-mist mt-4 max-w-[520px] text-[17px]">
            Deep water outside. Still water in here. One transaction mints your coin, pools it, and
            locks the liquidity forever — no bonding curve, no admin, no way to pull it.
          </p>
        </div>
        <div className="hidden md:block">
          <div className="relative flex flex-col items-center">
            {/* radial blue halo behind the sail */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-[1]"
              style={{
                background:
                  "radial-gradient(closest-side, rgba(94,147,234,.28), transparent 72%)",
              }}
            />
            <Image
              src="/berth-sail.png"
              alt=""
              width={230}
              height={230}
              priority
              className="animate-bob"
              style={{ animationDuration: "7s", width: 230, height: "auto" }}
            />
            {/* ellipse ground shadow */}
            <div
              aria-hidden
              className="mt-1 h-3 w-[150px] rounded-[50%]"
              style={{ background: "radial-gradient(closest-side, rgba(0,0,0,.55), transparent)" }}
            />
            <div
              className="text-faint mt-4 font-mono text-[10px] uppercase"
              style={{ letterSpacing: ".2em" }}
            >
              EST. 2026 · HARBOR Nº 01
            </div>
          </div>
        </div>
      </section>

      {/* headline totals — the site reads busier the instant these are non-zero */}
      {stats && (
        <section
          className="rounded-card mb-6 grid gap-px overflow-hidden text-center"
          style={{ gridTemplateColumns: "repeat(3,1fr)", background: "rgba(94,147,234,0.2)", border: "1px solid rgba(94,147,234,0.2)" }}
        >
          <StatCell label="Ships launched" value={stats.coins.toLocaleString()} />
          <StatCell label="Trades" value={stats.trades.toLocaleString()} />
          <StatCell label="Captains" value={stats.captains.toLocaleString()} />
        </section>
      )}

      {/* flagship — king of the hill. Only exists once a coin does. */}
      {king && (
      <section className="mb-6">
        <Link
          href={`/token/${king.address}`}
          className="rounded-panel shadow-gold-glow relative flex flex-wrap items-center gap-5 px-6 py-[22px] transition-transform hover:-translate-y-0.5"
          style={{
            background: "linear-gradient(120deg,#0d1526,#0d1526 55%)",
            border: "2px solid #f2c94c",
            borderRadius: 20,
          }}
        >
          <span className="animate-crown absolute left-6 text-[32px]" style={{ top: -18 }} aria-hidden>
            👑
          </span>

          <CoinAvatar
            image={king.image}
            emoji={king.emoji}
            name={king.name}
            ticker={king.ticker}
            size={76}
            className="bg-deep"
            style={{ border: "2px solid #f2c94c", borderRadius: 18 }}
          />

          <div className="min-w-0">
            <div className="text-gold animate-pulse-soft text-[11px] font-bold" style={{ letterSpacing: 2 }}>
              FLAGSHIP OF THE FLEET
            </div>
            <div className="font-display text-[28px] leading-tight">
              {king.name} <span className="text-mist tabular text-lg">${king.ticker}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-7 md:ml-auto">
            <Metric label="Price">
              <span className="tabular">{fmtPrice(king.priceUsd)}</span>
            </Metric>
            <Metric label="24h">
              <ChangeChip change={king.change24h} className="text-sm" />
            </Metric>
            <Metric label="Market cap">
              <span className="tabular">{fmtMc(king.marketCapUsd)}</span>
            </Metric>
          </div>

          <span className="btn-deck btn-lime px-5 py-2.5 text-base">Climb aboard →</span>
        </Link>
      </section>
      )}

      {/* trust strip — 1px gaps show rigging as hairlines */}
      <section
        className="rounded-card mb-8 grid gap-px overflow-hidden"
        style={{
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          background: "rgba(94,147,234,0.2)",
          border: "1px solid rgba(94,147,234,0.2)",
        }}
      >
        {TRUST.map((t) => (
          <div key={t.title} className="bg-hull flex gap-3 px-[18px] py-4">
            <span className="text-2xl leading-none" aria-hidden>
              {t.icon}
            </span>
            <div>
              <div className="text-[15px] font-bold">{t.title}</div>
              <p className="text-mist mt-0.5 text-[13px]">{t.body}</p>
            </div>
          </div>
        ))}
      </section>

      {/* fleet + live feed, side by side on wide screens */}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <section>
        <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
          <h2 className="font-display text-2xl">Fresh out of the shipyard</h2>
          {coins && (
            <span className="text-mist text-[13px]">
              <span className="tabular">{coins.length}</span>{" "}
              {coins.length === 1 ? "ship" : "ships"} in the water
            </span>
          )}
          {badge && (
            <span
              className="rounded-[20px] px-2.5 py-1 text-[11px] font-bold"
              style={badge.style}
              title={badge.title}
            >
              {badge.label}
            </span>
          )}
        </div>
        {coins === null ? (
          // The indexer is unreachable — say so, never invent coins.
          <p className="text-mist py-10 text-center text-sm">
            Can&apos;t reach the harbor ledger, so we won&apos;t guess at what&apos;s in the water.
            Try again in a moment.
          </p>
        ) : coins.length === 0 ? (
          <p className="text-mist py-10 text-center text-sm">
            No ships yet. The harbor&apos;s empty — go launch the first one.
          </p>
        ) : (
          // Everything (including the flagship) is searchable/sortable here.
          <Harbor coins={coins} />
        )}
      </section>
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <TradeFeed trades={feed} />
      </aside>
      </div>
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-hull px-4 py-3">
      <div className="font-display tabular text-2xl">{value}</div>
      <div className="text-mist mt-0.5 text-[12px]">{label}</div>
    </div>
  )
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-mist text-xs">{label}</div>
      <div className="mt-0.5 text-lg font-bold">{children}</div>
    </div>
  )
}
