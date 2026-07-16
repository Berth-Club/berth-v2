// Fake data for building the UI before the indexer/contracts exist.
// Shape mirrors what the indexer's `token` row will provide (plan Unit 2).

export type Coin = {
  address: string
  emoji: string
  name: string
  ticker: string
  creator: string
  age: string
  priceUsd: number
  /** null = never traded, no basis to compute a change. */
  change24h: number | null
  marketCapUsd: number
  /** 0–1 progress along the v3 range toward graduation (~6.9 WETH). */
  curve: number
  graduated: boolean
  lore: string
  /** 24h volume, preformatted for display. */
  vol: string
}

export const MOCK_COINS: Coin[] = [
  { address: "0x08435ce96860b7aca55040d1fb6ee46b5f0d0a01", emoji: "🚢", name: "Flagship", ticker: "FLAG", creator: "0x624…4e895", age: "2h", priceUsd: 0.00041, change24h: 62.4, marketCapUsd: 41200, curve: 1, graduated: true, lore: "First ship out of the yard. Never sank." , vol: "$18.4K" },
  { address: "0x039809c401df63313eaa7c5e903fa39f313c8f91", emoji: "🐋", name: "Whale Bait", ticker: "BAIT", creator: "0xb56…fb251", age: "1h", priceUsd: 0.00033, change24h: 41.2, marketCapUsd: 33100, curve: 0.95, graduated: false, lore: "Chum the water, see what surfaces." , vol: "$12.1K" },
  { address: "0x08c2f3853f483289f5f599a82c6b58aa31ec465b", emoji: "⚓", name: "Anchor Heavy", ticker: "ANCHOR", creator: "0x609…da14e", age: "1h", priceUsd: 0.00024, change24h: 18.9, marketCapUsd: 24500, curve: 0.88, graduated: false, lore: "It never comes up." , vol: "$9.7K" },
  { address: "0x05f135f1ff44575b1628b369d76b506c6576f7ac", emoji: "🦈", name: "Shark Week", ticker: "CHOMP", creator: "0x64f…defd3", age: "1h", priceUsd: 0.00012, change24h: -7.3, marketCapUsd: 12900, curve: 0.74, graduated: false, lore: "Smells blood, buys the dip." , vol: "$8.2K" },
  { address: "0x028a07ba0f0b84cbffc809673584a629bce6a4f7", emoji: "🔥", name: "Prometheus", ticker: "FIRE", creator: "0xd5d…6d111", age: "1h", priceUsd: 0.00009, change24h: 12.1, marketCapUsd: 9400, curve: 0.41, graduated: false, lore: "Stole fire, launched a coin." , vol: "$6.9K" },
  { address: "0x01db6b9af1f2abb2f4fef54a594e6e037acf93d1", emoji: "🐺", name: "Two Wolves", ticker: "WOLVES", creator: "0x4a6…d34e2", age: "2h", priceUsd: 0.00008, change24h: -3.4, marketCapUsd: 8260, curve: 0.62, graduated: false, lore: "There are two wolves inside you." , vol: "$5.4K" },
  { address: "0x04ff2a2e9c0c355489129ab867362048b8911c8c", emoji: "🧭", name: "Lost At Sea", ticker: "COMPASS", creator: "0xbe0…f541d", age: "1h", priceUsd: 0.00007, change24h: 5.6, marketCapUsd: 7020, curve: 0.24, graduated: false, lore: "No map, no problem." , vol: "$4.8K" },
  { address: "0x085959ca700ecbab3ab5387ee33252daac0a7bb8", emoji: "🐸", name: "Harbor Pepe", ticker: "HPEPE", creator: "0x017…cae85", age: "1h", priceUsd: 0.00006, change24h: 22.0, marketCapUsd: 6100, curve: 0.18, graduated: false, lore: "Rare, seaworthy." , vol: "$3.9K" },
  { address: "0x06343a2ca8f8e7d933452205b3869f0a989d9642", emoji: "🐂", name: "Beanie Bull", ticker: "BEANIE", creator: "0xb24…72895", age: "1h", priceUsd: 0.00005, change24h: -1.2, marketCapUsd: 5770, curve: 0.13, graduated: false, lore: "Up only, allegedly." , vol: "$3.1K" },
  { address: "0x03468945b6e76cb3858acf3a8acf28018256159c", emoji: "🦀", name: "Crab Market", ticker: "CRAB", creator: "0x73a…72a4a", age: "1h", priceUsd: 0.00005, change24h: 0.4, marketCapUsd: 5220, curve: 0.28, graduated: false, lore: "Sideways forever. Still floating." , vol: "$2.7K" },
  { address: "0x08a410a01d0a3dfd8be188cc75968a70fef3b32f", emoji: "🐱", name: "Cash Cat", ticker: "CASHCAT", creator: "0xdf4…35035", age: "2h", priceUsd: 0.00004, change24h: 9.1, marketCapUsd: 4870, curve: 0.05, graduated: false, lore: "Money printer go meow." , vol: "$2.2K" },
  { address: "0x00b0e5df7033ad21874d9010d4d1bd047837bd9a", emoji: "🌙", name: "Moon Soon", ticker: "MOON", creator: "0xbe0…f541d", age: "57m", priceUsd: 0.00004, change24h: 2.2, marketCapUsd: 4760, curve: 0.02, graduated: false, lore: "Soon™" , vol: "$1.8K" },
]

/** The flagship — king of the hill. Highest market cap. */
export const KING: Coin = MOCK_COINS[0]!

export function getCoin(address: string): Coin | undefined {
  return MOCK_COINS.find((c) => c.address.toLowerCase() === address.toLowerCase())
}

export type Holder = { who: string; pct: number }
export type Trade = { kind: "buy" | "sell"; who: string; eth: string; ago: string }

export function getHolders(coin: Coin): Holder[] {
  const base = [32, 18, 11, 7, 5, 4, 3, 2]
  return base.map((pct, i) => ({
    who: `0x${coin.address.slice(2 + i, 5 + i)}…${coin.address.slice(-4)}`,
    pct,
  }))
}

export function getTrades(coin: Coin): Trade[] {
  return [
    { kind: "buy", who: coin.creator, eth: "0.42", ago: "12s" },
    { kind: "buy", who: "0x9a1…b3c2", eth: "0.09", ago: "44s" },
    { kind: "sell", who: "0x77e…12af", eth: "0.15", ago: "2m" },
    { kind: "buy", who: "0x4a6…d34e2", eth: "1.10", ago: "5m" },
    { kind: "buy", who: "0x265…e326", eth: "0.30", ago: "9m" },
    { kind: "sell", who: "0xbe0…f541d", eth: "0.05", ago: "14m" },
  ]
}

/** Emoji options for the launch flow's "Pick a face" step. */
export const FACE_OPTIONS = ["🚢","⚓","🐋","🦈","🐙","🦀","🐸","🐺","🔥","🌙","🧭","👑","💎","🏴‍☠️","🌊","⛵"]
