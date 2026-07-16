// Mock traders/captains for the leaderboard + user pages.

export type Captain = {
  address: string
  handle: string
  emoji: string
  pnlUsd: number
  winPct: number
  volumeUsd: number
  coinsCreated: string[] // coin addresses
  feesEarnedEth: number
  badges: string[]
}

export const CAPTAINS: Captain[] = [
  { address: "0x624…4e895", handle: "saltbeard", emoji: "🧔‍♂️", pnlUsd: 48200, winPct: 71, volumeUsd: 412000, coinsCreated: ["0x08435ce96860b7aca55040d1fb6ee46b5f0d0a01"], feesEarnedEth: 2.41, badges: ["👑 Season 1 leader", "🚩 Founder pennant", "⚓ Docked since day one"] },
  { address: "0xb56…fb251", handle: "tidewalker", emoji: "🌊", pnlUsd: 31450, winPct: 66, volumeUsd: 298000, coinsCreated: ["0x039809c401df63313eaa7c5e903fa39f313c8f91"], feesEarnedEth: 1.62, badges: ["🏆 Top 3 captain", "🚩 Founder pennant"] },
  { address: "0x4a6…d34e2", handle: "krakenbait", emoji: "🦑", pnlUsd: 24900, winPct: 63, volumeUsd: 241000, coinsCreated: ["0x01db6b9af1f2abb2f4fef54a594e6e037acf93d1"], feesEarnedEth: 1.08, badges: ["🏆 Top 3 captain", "🛠️ Shipwright ×1"] },
  { address: "0x609…da14e", handle: "deadreckon", emoji: "🧭", pnlUsd: 17300, winPct: 58, volumeUsd: 186000, coinsCreated: ["0x08c2f3853f483289f5f599a82c6b58aa31ec465b"], feesEarnedEth: 0.74, badges: ["🚩 Founder pennant"] },
  { address: "0x73a…72a4a", handle: "barnacle", emoji: "🦀", pnlUsd: 11800, winPct: 55, volumeUsd: 142000, coinsCreated: ["0x03468945b6e76cb3858acf3a8acf28018256159c"], feesEarnedEth: 0.51, badges: ["🛠️ Shipwright ×1"] },
  { address: "0xd5d…6d111", handle: "firestarter", emoji: "🔥", pnlUsd: 8400, winPct: 52, volumeUsd: 98000, coinsCreated: ["0x028a07ba0f0b84cbffc809673584a629bce6a4f7"], feesEarnedEth: 0.33, badges: [] },
  { address: "0x017…cae85", handle: "hoppy", emoji: "🐸", pnlUsd: 5100, winPct: 49, volumeUsd: 71000, coinsCreated: ["0x085959ca700ecbab3ab5387ee33252daac0a7bb8"], feesEarnedEth: 0.19, badges: [] },
  { address: "0xbe0…f541d", handle: "moonsoon", emoji: "🌙", pnlUsd: -2300, winPct: 41, volumeUsd: 54000, coinsCreated: ["0x00b0e5df7033ad21874d9010d4d1bd047837bd9a"], feesEarnedEth: 0.08, badges: [] },
]

export function getCaptain(address: string): Captain | undefined {
  const key = decodeURIComponent(address)
  return CAPTAINS.find((c) => c.address === key || c.handle === key)
}

export function rankOf(c: Captain): number {
  return CAPTAINS.findIndex((x) => x.address === c.address) + 1
}

/** Rank numeral colours — gold / silver / bronze for the top 3. */
export function rankColor(rank: number): string | undefined {
  return rank === 1 ? "#FBBF24" : rank === 2 ? "#cbd5d1" : rank === 3 ? "#d19a66" : undefined
}
