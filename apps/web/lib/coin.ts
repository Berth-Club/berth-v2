/**
 * Shared coin shape + the launch flow's face options.
 *
 * Every value a surface renders is chain-derived. When the indexer can't be
 * reached, surfaces say so — they never substitute invented coins, which is
 * what the fixtures this file replaces used to do.
 */

export type Coin = {
  address: string
  emoji: string
  name: string
  ticker: string
  creator: string
  age: string
  /** null = the ETH/USD feed is unreachable, so USD is unknown. Renders "—". */
  priceUsd: number | null
  /** null = never traded, no basis to compute a change. */
  change24h: number | null
  /** null = ETH/USD unknown. See priceUsd. */
  marketCapUsd: number | null
  /**
   * Market cap in NATIVE. Always known — it comes off the pool tick, with no
   * dollar feed involved. Rank on this, never on the USD fields, which go null
   * whenever Coinbase is unreachable.
   */
  marketCapNative: number
  /** 0–1 progress along the v3 range toward graduation (~6.9 NATIVE). */
  curve: number
  graduated: boolean
  lore: string
  /** 24h volume in USD, preformatted. null = ETH/USD unknown. */
  vol: string | null
}

/** Faces a creator can pick at launch. Rides in metadataURI, so it persists. */
export const FACE_OPTIONS = [
  "🚢", "⚓", "🐋", "🦈", "🐙", "🦀", "🐸", "🐺",
  "🔥", "🌙", "🧭", "👑", "💎", "🏴‍☠️", "🌊", "⛵",
]
