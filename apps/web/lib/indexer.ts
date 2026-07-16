import { FACE_OPTIONS, type Coin } from "@/lib/mock"

const INDEXER_URL = process.env.INDEXER_URL ?? "http://localhost:42069"

/**
 * ETH/USD for display only. The spec's mock data assumes $3,400.
 * TODO: replace with a real price feed before anyone trades on these numbers.
 */
const ETH_USD = 3400

/** Every launched coin has 18 decimals and 100B supply. */
const SUPPLY_TOKENS = 100_000_000_000

type IndexedCoin = {
  address: string
  creator: string
  tokenId: string
  pool: string
  name: string
  symbol: string
  metadataURI: string
  tickLower: number
  tickUpper: number
  tick: number | null
  curve: number
  graduated: boolean
  volumeWeth: string
  swapCount: number
  createdAt: string
}

const COINS_QUERY = `{
  coins(orderBy: "createdAt", orderDirection: "desc", limit: 100) {
    items {
      address creator tokenId pool name symbol metadataURI
      tickLower tickUpper tick curve graduated
      volumeWeth swapCount createdAt
    }
  }
}`

/**
 * Uniswap v3 tick -> price. Salt mining guarantees the coin is token0 and WETH
 * is token1, so 1.0001^tick is WETH per whole token (both sides are 18dp).
 */
export function tickToPriceWeth(tick: number): number {
  return Math.pow(1.0001, tick)
}

/** Deterministic face until metadata carries a real one. */
function emojiFor(address: string): string {
  let h = 0
  for (let i = 2; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) % 997
  return FACE_OPTIONS[h % FACE_OPTIONS.length]!
}

function ago(unixSeconds: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function short(addr: string): string {
  return `${addr.slice(0, 5)}…${addr.slice(-5)}`
}

function toCoin(c: IndexedCoin): Coin {
  // Pool opens at tickLower; before the first swap `tick` is that floor.
  const tick = c.tick ?? c.tickLower
  const priceWeth = tickToPriceWeth(tick)
  const marketCapWeth = priceWeth * SUPPLY_TOKENS
  const volWeth = Number(BigInt(c.volumeWeth)) / 1e18

  return {
    address: c.address,
    emoji: emojiFor(c.address),
    name: c.name,
    ticker: c.symbol,
    creator: short(c.creator),
    age: ago(Number(c.createdAt)),
    priceUsd: priceWeth * ETH_USD,
    // no trades => no basis for a 24h change. Never fake a 0.
    change24h: c.swapCount > 0 ? 0 : null,
    marketCapUsd: marketCapWeth * ETH_USD,
    curve: c.curve,
    graduated: c.graduated,
    lore: c.metadataURI?.startsWith("ipfs://") ? "" : (c.metadataURI ?? ""),
    vol: volWeth > 0 ? `$${Math.round(volWeth * ETH_USD).toLocaleString()}` : "$0",
  }
}

/** Live coins from the indexer. Returns null if it's unreachable. */
export async function fetchCoins(): Promise<Coin[] | null> {
  try {
    const res = await fetch(`${INDEXER_URL}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: COINS_QUERY }),
      cache: "no-store",
    })
    if (!res.ok) return null
    const json = await res.json()
    const items: IndexedCoin[] | undefined = json?.data?.coins?.items
    if (!items) return null
    return items.map(toCoin)
  } catch {
    return null // indexer down — caller falls back to demo data
  }
}

export async function fetchCoin(address: string): Promise<Coin | null> {
  const coins = await fetchCoins()
  return coins?.find((c) => c.address.toLowerCase() === address.toLowerCase()) ?? null
}
