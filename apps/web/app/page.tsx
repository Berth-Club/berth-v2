import { fetchCoins, fetchIndexerStatus, formatLag } from "@/lib/indexer"
import { AutoRefresh } from "@/components/auto-refresh"
import { HarborGrid } from "@/components/harbor-grid"

// Always read fresh from the indexer.
export const dynamic = "force-dynamic"

/**
 * The Harbor. v3 opens straight onto the discovery grid: no hero copy, no
 * headline metrics strip, no flagship/king card, no live-feed rail, no trust
 * pillars — all removed by the design, not merely unstyled. The brand sail
 * lives in the background scene, not the foreground.
 */
export default async function HarborPage() {
  // null = indexer unreachable. [] = reachable, genuinely no coins. These are
  // different facts and the page says which; it never fills the gap with
  // invented coins.
  const [coins, status] = await Promise.all([fetchCoins(), fetchIndexerStatus()])

  // Shown ONLY when the page is incomplete. A behind indexer means launches that
  // already happened are missing from this grid, and silently showing a short
  // list as if it were the whole harbor is the failure this replaced.
  const lag = status && !status.synced ? formatLag(status.lagSeconds) : null

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-7">
      {/* Keeps the harbor grid and the syncing badge current without a reload. */}
      <AutoRefresh seconds={20} />

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
        <HarborGrid coins={coins} />
      )}
    </div>
  )
}
