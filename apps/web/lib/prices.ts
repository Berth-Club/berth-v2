// Server-side ETH/USD spot. Display only — nothing on-chain reads this.

/** Coinbase public spot — no API key, no rate limit worth worrying about. */
const SOURCE = "https://api.coinbase.com/v2/prices/ETH-USD/spot"
const TTL_MS = 60_000

export type EthUsd = {
  usd: number
  /** true = the feed just failed and `usd` is the last good price we saw. */
  stale: boolean
}

let cached: { usd: number; at: number } | null = null

/**
 * ETH/USD spot, cached ~60s in-process. Never throws.
 *
 * Returns null when the feed is unreachable AND we have never had a good tick
 * this process — meaning we genuinely do not know what ETH is worth. Callers
 * must render "—" for that, not a number.
 *
 * There used to be a FALLBACK_ETH_USD = 3400 here instead. It was never a real
 * price, and when ETH was actually ~$1871 it silently inflated every price and
 * market cap on the site by 82%. A made-up dollar figure is indistinguishable
 * from a real one on screen, which is exactly what makes it worse than absence.
 * A stale-but-real last-known price is fine; an invented one is not.
 *
 * ponytail: a module-level memo, not a shared cache — each server instance
 * fetches at most once a minute, which is already nothing. Move it to Redis
 * only if we ever run enough instances for Coinbase to notice.
 */
export async function getEthUsd(): Promise<EthUsd | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return { usd: cached.usd, stale: false }

  try {
    const res = await fetch(SOURCE, { cache: "no-store", signal: AbortSignal.timeout(4_000) })
    if (!res.ok) throw new Error(`coinbase ${res.status}`)
    const amount = Number((await res.json())?.data?.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("coinbase returned a non-price")
    cached = { usd: amount, at: Date.now() }
    return { usd: amount, stale: false }
  } catch {
    return cached ? { usd: cached.usd, stale: true } : null
  }
}
