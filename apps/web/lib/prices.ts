// Server-side ETH/USD spot. Display only — nothing on-chain reads this.

/**
 * Last-resort ETH/USD, used only when the feed is unreachable AND we have never
 * had a good tick this process. It is NOT a real price — it is the number the
 * spec's mock data was built around, kept so the page renders something rather
 * than NaN.
 *
 * TODO: every USD figure on the site is derived from this constant whenever
 * `stale` is true. If we ever let people trade off these numbers, surface the
 * stale flag in the UI (or refuse to render USD at all) instead of quietly
 * showing a made-up dollar value.
 */
const FALLBACK_ETH_USD = 3400

/** Coinbase public spot — no API key, no rate limit worth worrying about. */
const SOURCE = "https://api.coinbase.com/v2/prices/ETH-USD/spot"
const TTL_MS = 60_000

export type EthUsd = {
  usd: number
  /** true = the feed failed; `usd` is a last-known-good or the fallback constant. */
  stale: boolean
}

let cached: { usd: number; at: number } | null = null

/**
 * ETH/USD spot, cached ~60s in-process. Never throws: a dead feed degrades to
 * the last good price, then to FALLBACK_ETH_USD, both marked stale.
 *
 * ponytail: a module-level memo, not a shared cache — each server instance
 * fetches at most once a minute, which is already nothing. Move it to Redis
 * only if we ever run enough instances for Coinbase to notice.
 */
export async function getEthUsd(): Promise<EthUsd> {
  if (cached && Date.now() - cached.at < TTL_MS) return { usd: cached.usd, stale: false }

  try {
    const res = await fetch(SOURCE, { cache: "no-store", signal: AbortSignal.timeout(4_000) })
    if (!res.ok) throw new Error(`coinbase ${res.status}`)
    const amount = Number((await res.json())?.data?.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("coinbase returned a non-price")
    cached = { usd: amount, at: Date.now() }
    return { usd: amount, stale: false }
  } catch {
    return { usd: cached?.usd ?? FALLBACK_ETH_USD, stale: true }
  }
}
