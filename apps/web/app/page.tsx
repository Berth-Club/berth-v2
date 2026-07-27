import { fetchCoins, fetchIndexerStatus, formatLag } from "@/lib/indexer"
import { AutoRefresh } from "@/components/auto-refresh"
import { Harbor } from "@/components/harbor"

// Always read fresh from the indexer.
export const dynamic = "force-dynamic"

/**
 * The harbor. v3 opens straight onto the trust pillars and the grid: no hero
 * copy, no headline metrics strip, no flagship/king card, no live-feed rail —
 * all four are removed by the design, not merely unstyled. The brand sail lives
 * in the background scene, not the foreground.
 */
const TRUST = [
  { icon: "🔒", title: "Liquidity locked forever", body: "the anchor never comes up — not for us, not for anyone" },
  { icon: "🚫", title: "Fixed 100B supply", body: "minted once at launch — no one can ever print more" },
  { icon: "🛡️", title: "No admin over your coin", body: "no one can seize, freeze, or scuttle your ship" },
  { icon: "💸", title: "1% fee → the creator", body: "every trade pays the ship's builder, not a middleman" },
]

export default async function HarborPage() {
  // null = indexer unreachable. [] = reachable, genuinely no coins. These are
  // different facts and the page says which; it never fills the gap with
  // invented coins. A "demo data" pill in the corner was no match for a full
  // grid of plausible fake coins with prices and graduation meters.
  const [coins, status] = await Promise.all([fetchCoins(), fetchIndexerStatus()])

  // Shown ONLY when the page is incomplete. A behind indexer means launches that
  // already happened are missing from this grid, and silently showing a short
  // list as if it were the whole harbor is the failure this replaced.
  const lag = status && !status.synced ? formatLag(status.lagSeconds) : null

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-7">
      {/* Keeps the harbor grid and the syncing badge current without a reload. */}
      <AutoRefresh seconds={20} />

      {/* trust pillars — one bordered grid, cells ruled by their own hairline
          shadow. Never a 1px-gap grid: a partial row would paint the page
          backdrop as a phantom cell. */}
      <section className="cell-grid mt-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        {TRUST.map((t) => (
          <div key={t.title} className="cell flex items-start gap-3 px-[18px] py-4">
            <span className="text-2xl leading-none" aria-hidden>
              {t.icon}
            </span>
            <div>
              <div className="text-[15px] font-bold">{t.title}</div>
              <p className="text-mist mt-[3px] text-[13px]">{t.body}</p>
            </div>
          </div>
        ))}
      </section>

      {lag && (
        <p
          className="text-gold mt-4 inline-block rounded-[20px] px-2.5 py-1 text-[11px] font-bold"
          style={{ background: "rgba(137,167,219,.12)", border: "1px solid rgba(137,167,219,.35)" }}
          title={`Coins launched in the last ${lag} aren't here yet.`}
        >
          ● syncing · {lag}
        </p>
      )}

      {coins === null ? (
        // The indexer is unreachable — say so, never invent coins.
        <p className="text-mist py-10 text-center text-sm">
          Can&apos;t reach the harbor ledger, so we won&apos;t guess at what&apos;s in the water. Try
          again in a moment.
        </p>
      ) : (
        <Harbor coins={coins} />
      )}
    </div>
  )
}
