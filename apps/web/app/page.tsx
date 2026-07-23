import Link from "next/link"

import { TokenCard, ChangeChip } from "@/components/token-card"
import { ShipMascot } from "@/components/ship-mascot"
import { fmtMc, fmtPrice } from "@/lib/format"
import { fetchCoins, fetchIndexerStatus, formatLag } from "@/lib/indexer"
import { arc } from "@/lib/chain"

// Always read fresh from the indexer.
export const dynamic = "force-dynamic"

const TRUST = [
  { icon: "🔒", title: "Liquidity locked forever", body: "the anchor never comes up — not for us, not for anyone" },
  { icon: "🚫", title: "Fixed 100B supply", body: "minted once at launch — no one can ever print more" },
  { icon: "🛡️", title: "No admin over your coin", body: "no one can seize, freeze, or scuttle your ship" },
  { icon: "💸", title: "1% fee → the creator", body: "every trade pays the ship's builder, not a middleman" },
]

const GREEN = { color: "#4ADE80", background: "rgba(74,222,128,.12)", border: "1px solid rgba(74,222,128,.35)" }
const GOLD = { color: "#FBBF24", background: "rgba(251,191,36,.12)", border: "1px solid rgba(251,191,36,.35)" }

export default async function HarborPage() {
  // null = indexer unreachable. [] = reachable, genuinely no coins. These are
  // different facts and the page says which; it never fills the gap with
  // invented coins. A "demo data" pill in the corner was no match for a full
  // grid of plausible fake coins with prices and graduation meters.
  const [coins, status] = await Promise.all([fetchCoins(), fetchIndexerStatus()])

  const badge =
    status && !status.synced
      ? {
          // Behind means launches are missing from this page — say so.
          label: `● syncing · ${formatLag(status.lagSeconds)}`,
          style: GOLD,
          title: `Indexed to block ${status.block.toLocaleString()}. Coins launched more recently than this aren't here yet.`,
        }
      : {
          label: `● live · chain ${arc.id}`,
          style: GREEN,
          title: status
            ? `Indexed to block ${status.block.toLocaleString()} (${formatLag(status.lagSeconds)})`
            : `Indexed from chain ${arc.id}`,
        }

  const king = coins?.length ? [...coins].sort((a, b) => b.marketCapNative - a.marketCapNative)[0]! : null
  const fleet = king && coins ? coins.filter((c) => c.address !== king.address) : []

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-7">
      {/* hero */}
      <section className="mb-7 flex items-center gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="font-display leading-[1.05]" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
            The sea doesn&apos;t care if you <span style={{ color: "#F87171" }}>drown</span>.
            <br />
            Build something that <span className="text-lime">floats</span>.
          </h1>
          <p className="text-mist mt-4 max-w-[520px] text-[17px]">
            Deep water outside. Still water in here. One transaction mints your coin, pools it, and
            locks the liquidity forever — no bonding curve, no admin, no way to pull it.
          </p>
        </div>
        <div className="hidden md:block">
          <ShipMascot />
        </div>
      </section>

      {/* flagship — king of the hill. Only exists once a coin does. */}
      {king && (
      <section className="mb-6">
        <Link
          href={`/token/${king.address}`}
          className="rounded-panel shadow-gold-glow relative flex flex-wrap items-center gap-5 px-6 py-[22px] transition-transform hover:-translate-y-0.5"
          style={{
            background: "linear-gradient(120deg,#1d2b14,#182418 55%)",
            border: "2px solid #FBBF24",
            borderRadius: 20,
          }}
        >
          <span className="animate-crown absolute left-6 text-[32px]" style={{ top: -18 }} aria-hidden>
            👑
          </span>

          <span
            className="bg-deep grid size-[76px] shrink-0 place-items-center text-[40px]"
            style={{ border: "2px solid #FBBF24", borderRadius: 18 }}
            aria-hidden
          >
            {king.emoji}
          </span>

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

          <span className="btn-deck btn-gold px-5 py-2.5 text-base">Climb aboard →</span>
        </Link>
      </section>
      )}

      {/* trust strip — 1px gaps show rigging as hairlines */}
      <section
        className="rounded-card mb-8 grid gap-px overflow-hidden"
        style={{
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          background: "#263A28",
          border: "1px solid #263A28",
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

      {/* the fleet */}
      <section>
        <div className="mb-3.5 flex flex-wrap items-baseline gap-3">
          <h2 className="font-display text-2xl">Fresh out of the shipyard</h2>
          {coins && (
            <span className="text-mist text-[13px]">
              <span className="tabular">{coins.length}</span>{" "}
              {coins.length === 1 ? "ship" : "ships"} in the water
            </span>
          )}
          {/* Three states, not two. "Answering" != "current": the badge used to
              say live while the indexer sat 18 minutes back, silently missing a
              coin that had already launched. Lag is now stated, not implied. */}
          <span
            className="rounded-[20px] px-2.5 py-1 text-[11px] font-bold"
            style={badge.style}
            title={badge.title}
          >
            {badge.label}
          </span>
        </div>
        <div
          className="grid gap-3.5"
          style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}
        >
          {fleet.map((coin) => (
            <TokenCard key={coin.address} coin={coin} />
          ))}
        </div>
        {/* Three real states. "Can't reach" and "nothing here" are different
            facts — neither is answered with invented coins. */}
        {coins === null ? (
          <p className="text-mist py-10 text-center text-sm">
            Can&apos;t reach the harbor ledger, so we won&apos;t guess at what&apos;s in the water.
            Try again in a moment.
          </p>
        ) : coins.length === 0 ? (
          <p className="text-mist py-10 text-center text-sm">
            No ships yet. The harbor&apos;s empty — go launch the first one.
          </p>
        ) : fleet.length === 0 ? (
          <p className="text-mist py-10 text-center text-sm">
            Only the flagship so far. The harbor&apos;s quiet — go launch something.
          </p>
        ) : null}
      </section>
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
