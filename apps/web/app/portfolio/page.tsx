import { PortfolioTabs } from "@/components/portfolio-tabs"
import { getEthUsd } from "@/lib/prices"

// getEthUsd() is a live fetch — nothing here may be cached into a stale rate.
export const dynamic = "force-dynamic"

export default async function PortfolioPage() {
  // Priced server-side and handed down: the holdings table wants USD, and the
  // Coinbase call belongs on the server where it's memoised ~60s across every
  // visitor rather than fired from each browser. null = feed unreachable, and
  // the table renders "—" rather than inventing a rate.
  const ethUsd = await getEthUsd()

  return (
    <main className="mx-auto max-w-[900px] px-5 pb-20 pt-7">
      <h1 className="font-display text-[34px] leading-none">Your hold</h1>
      <PortfolioTabs ethUsd={ethUsd?.usd ?? null} />
    </main>
  )
}
