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
  /**
   * Uploaded coin art as `ipfs://CID`, or null when the coin has none (an older
   * coin, a placeholder, the degraded emoji-only path). null renders the emoji
   * face — only a real ipfs:// upload counts as an image.
   */
  image: string | null
  name: string
  ticker: string
  /** Shortened creator address for display, e.g. "0xb45c…d462e". */
  creator: string
  /** Full lowercased creator address — for /u links and profile lookup. */
  creatorAddress: string
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
  /** Creator social links (https-only, sanitized). Absent keys are omitted. */
  links: { twitter?: string; telegram?: string; website?: string }
  /** 24h volume in USD, preformatted. null = ETH/USD unknown. */
  vol: string | null
  /** Numeric USD volume, for sorting and dense card display. */
  volumeUsd: number
  /** Holders, from the indexer. 0 when unavailable. */
  holderCount: number
  /** Unix seconds the coin launched. For "newest" sorting and age. */
  createdAt: number
}

/** Faces a creator can pick at launch. Rides in metadataURI, so it persists. */
export const FACE_OPTIONS = [
  "🚢", "⚓", "🐋", "🦈", "🐙", "🦀", "🐸", "🐺",
  "🔥", "🌙", "🧭", "👑", "💎", "🏴‍☠️", "🌊", "⛵",
]
