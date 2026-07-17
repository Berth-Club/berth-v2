import { formatEther, isAddress } from "viem"

import { CONTRACTS, UNISWAP } from "@/lib/chain"
import { FACE_OPTIONS, type Coin } from "@/lib/mock"
import { getEthUsd } from "@/lib/prices"

const INDEXER_URL = process.env.INDEXER_URL ?? "http://localhost:42069"

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
  /** Launch-event bounds. Always coin-space, both orderings. */
  tickLower: number
  tickUpper: number
  /** Coin-space at launch, raw pool tick once swapCount > 0. See coinSpaceTick. */
  tick: number | null
  volumeWeth: string
  swapCount: number
  lastTradeAt: string | null
  createdAt: string
  // Landing in the indexer separately — absent on older builds, see coinsQuery.
  holderCount?: number | null
  change24h?: number | null
}

/**
 * Ponder rejects the *whole* query for one unknown field, so `holderCount` and
 * `change24h` (still being added indexer-side) are asked for optimistically and
 * dropped on a retry. Costs one extra localhost POST per render until they
 * land, then zero — cheaper than a flag that needs a web restart to notice.
 */
const coinsQuery = (extended: boolean) => `{
  coins(orderBy: "createdAt", orderDirection: "desc", limit: 100) {
    items {
      address creator tokenId pool name symbol metadataURI
      tickLower tickUpper tick
      volumeWeth swapCount lastTradeAt createdAt
      ${extended ? "holderCount change24h" : ""}
    }
  }
}`

const SWAPS_QUERY = `query ($coin: String!) {
  swaps(where: { coin: $coin }, orderBy: "timestamp", orderDirection: "desc", limit: 20) {
    items { id isBuy amountWeth timestamp txHash }
  }
}`

const HOLDERS_QUERY = `query ($coin: String!) {
  holders(where: { coin: $coin }, orderBy: "balance", orderDirection: "desc", limit: 12) {
    items { address balance }
  }
}`

/**
 * A trader, straight from the indexer's `captain` rollup.
 *
 * Note what is NOT here: PnL and win-rate. Both need per-holder cost basis,
 * which nothing indexes, so there is no honest way to compute them — and a
 * plausible-looking number is worse than an absent one. The leaderboard ranks
 * on volume, which is real.
 */
export type Captain = {
  address: string
  coinsCreated: number
  buys: number
  sells: number
  volumeWeth: number
  volumeUsd: number
  firstSeenAt: number
}

const CAPTAINS_QUERY = `{
  captains(orderBy: "volumeWeth", orderDirection: "desc", limit: 50) {
    items { address coinsCreated buys sells volumeWeth firstSeenAt }
  }
}`

type RawCaptain = {
  address: string
  coinsCreated: number
  buys: number
  sells: number
  volumeWeth: string
  firstSeenAt: string
}

/** Real traders, ranked by real volume. null if the indexer is unreachable. */
export async function fetchCaptains(): Promise<Captain[] | null> {
  const data = await gql<{ captains: { items: RawCaptain[] } }>(CAPTAINS_QUERY)
  if (!data?.captains?.items) return null
  const ethUsd = await getEthUsd()
  return data.captains.items.map((c) => {
    const volumeWeth = Number(formatEther(BigInt(c.volumeWeth)))
    return {
      address: c.address,
      coinsCreated: c.coinsCreated,
      buys: c.buys,
      sells: c.sells,
      volumeWeth,
      volumeUsd: volumeWeth * ethUsd.usd,
      firstSeenAt: Number(c.firstSeenAt),
    }
  })
}

export async function fetchCaptain(address: string): Promise<Captain | null> {
  const all = await fetchCaptains()
  return all?.find((c) => c.address.toLowerCase() === address.toLowerCase()) ?? null
}

/**
 * Coins a given wallet launched, from the indexed launch events.
 *
 * Filtered by the indexer on the FULL address — `Coin.creator` is the
 * truncated display form (0x624…4e895), so matching on it would quietly
 * return nothing.
 */
export async function fetchCoinsByCreator(address: string): Promise<Coin[] | null> {
  const data = await gql<{ coins: { items: IndexedCoin[] } }>(
    `query ($creator: String!) {
      coins(where: { creator: $creator }, orderBy: "createdAt", orderDirection: "desc", limit: 50) {
        items {
          address creator tokenId pool name symbol metadataURI
          tickLower tickUpper tick
          volumeWeth swapCount lastTradeAt createdAt
          holderCount change24h
        }
      }
    }`,
    { creator: address.toLowerCase() }
  )
  if (!data?.coins?.items) return null
  const ethUsd = await getEthUsd()
  return data.coins.items.map((c) => toCoin(c, ethUsd.usd))
}

export type IndexerStatus = {
  /** Last block the indexer has processed. */
  block: number
  /** How far behind the chain tip it is, in seconds of chain time. */
  lagSeconds: number
  /** Caught up enough that what we render is effectively current. */
  synced: boolean
}

/**
 * How far behind the indexer is.
 *
 * Measured in TIME, not blocks: chain 4663 produces a block every ~0.098s, so
 * "11,000 blocks behind" is meaningless to a reader while "18 minutes behind"
 * is not. Lag comes from the indexed block's own timestamp, so it needs no
 * extra RPC round-trip.
 *
 * This exists because the harbor badge used to claim "live" whenever the
 * indexer answered at all — including when it was 18 minutes stale and missing
 * a coin that had already launched. Answering is not the same as being current.
 */
export async function fetchIndexerStatus(): Promise<IndexerStatus | null> {
  try {
    const res = await fetch(`${INDEXER_URL}/status`, { cache: "no-store" })
    if (!res.ok) return null
    const json = await res.json()
    const block = json?.robinhood?.block
    if (!block?.number || !block?.timestamp) return null
    // Clamp at 0: a chain timestamp can sit marginally ahead of local clock.
    const lagSeconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(block.timestamp))
    return {
      block: Number(block.number),
      lagSeconds,
      // 60s ≈ 600 blocks here — comfortably past normal jitter, well short of
      // "you are missing launches".
      synced: lagSeconds < 60,
    }
  } catch {
    return null
  }
}

/** Human lag: "18m behind", "42s behind". */
export function formatLag(seconds: number): string {
  if (seconds < 90) return `${seconds}s behind`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m behind`
  return `${(seconds / 3600).toFixed(1)}h behind`
}

/** null on any failure — transport, HTTP, or a GraphQL error (e.g. unknown field). */
async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`${INDEXER_URL}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    })
    if (!res.ok) return null
    const json = await res.json()
    if (json?.errors) return null
    return (json?.data as T) ?? null
  } catch {
    return null // indexer down — caller falls back to demo data
  }
}

/**
 * Uniswap v3 tick -> price, for a tick already in COIN SPACE (see
 * `coinSpaceTick`). Both sides are 18dp, so 1.0001^tick is WETH per whole coin.
 *
 * Do NOT hand this a raw pool tick — pass it through `coinSpaceTick` first, or
 * you get the reciprocal price (off by ~1e22 for a real launch range).
 */
export function tickToPriceWeth(tick: number): number {
  return Math.pow(1.0001, tick)
}

/**
 * Uniswap sorts pool tokens by address, and the DEPLOYED factory does not force
 * the coin to token0 — it mirrors the tick range when the coin sorts above
 * WETH9. So ordering is derived from the addresses (deterministic, no schema
 * coupling) rather than assumed.
 *
 * Verified on chain 4663 for $SMOKE (0x4b70e9…, pool 0x12ff27…):
 *   token0 = 0x0Bd7D308… (WETH9), token1 = 0x4b70e93E… (the coin)
 *   slot0.tick = +268600, position range +199400/+268600
 *   but TokenLaunched emitted tickLower -268600 / tickUpper -199400.
 */
export function coinIsToken0(coinAddress: string): boolean {
  return BigInt(coinAddress) < BigInt(UNISWAP.weth9)
}

/** The fields of a coin row needed to place its price on the curve. */
type TickSource = {
  address: string
  tick: number | null
  tickLower: number
  swapCount: number
}

/**
 * The tick as if the coin were token0 — the space where 1.0001^tick is WETH per
 * coin and the launch event's tickLower/tickUpper already live.
 *
 * The indexer's `tick` column changes meaning: at launch it's seeded from the
 * (coin-space) event tickLower, but a Swap overwrites it with the raw pool tick.
 * `swapCount` is what distinguishes the two — before any trade the pool simply
 * sits at the range floor.
 */
export function coinSpaceTick(c: TickSource): number {
  if (c.tick == null || c.swapCount === 0) return c.tickLower
  // Coin as token1: the pool quotes coin-per-WETH, the reciprocal of what we want.
  return coinIsToken0(c.address) ? c.tick : -c.tick
}

/** Deterministic face, used only when the coin carries no readable metadata. */
export function emojiFor(address: string): string {
  let h = 0
  for (let i = 2; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) % 997
  return FACE_OPTIONS[h % FACE_OPTIONS.length]!
}

type CoinMeta = { emoji?: string; description?: string; image?: string }

/**
 * Read back the metadata the creator chose.
 *
 * New launches inline it as `data:application/json,<encoded>` (see
 * lib/launch.ts) so the face and lore survive without an upload host. Anything
 * else — `ipfs://…`, a bare string, an http URL — is metadata we cannot resolve
 * synchronously, so we return nothing and let the caller fall back rather than
 * render a URL as if it were prose. Untrusted input: never throw on it.
 */
export function parseMetadata(uri: string | null | undefined): CoinMeta {
  if (!uri?.startsWith("data:application/json,")) return {}
  try {
    const json = decodeURIComponent(uri.slice("data:application/json,".length))
    const m = JSON.parse(json) as CoinMeta
    return typeof m === "object" && m !== null ? m : {}
  } catch {
    return {} // malformed metadata is a bad coin, not a broken harbor
  }
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

function toCoin(c: IndexedCoin, ethUsd: number): Coin {
  const tick = coinSpaceTick(c)
  const priceWeth = tickToPriceWeth(tick)
  const marketCapWeth = priceWeth * SUPPLY_TOKENS
  const volWeth = Number(formatEther(BigInt(c.volumeWeth)))
  // The creator's face + lore, read back out of the launch event. Falls back to
  // a derived face for coins launched before metadata was inlined (e.g. $SMOKE,
  // whose URI is literally "ipfs://placeholder").
  const meta = parseMetadata(c.metadataURI)

  // curve/graduated are recomputed rather than read off the row: the indexer
  // still derives them from a raw pool tick against coin-space bounds, which
  // pins any traded coin to curve=1 + graduated. In coin-space the direction is
  // uniform for both orderings — buyers always walk the tick up toward tickUpper.
  const curve = Math.min(1, Math.max(0, (tick - c.tickLower) / (c.tickUpper - c.tickLower)))

  return {
    address: c.address,
    emoji: meta.emoji ?? emojiFor(c.address),
    name: c.name,
    ticker: c.symbol,
    creator: short(c.creator),
    age: ago(Number(c.createdAt)),
    priceUsd: priceWeth * ethUsd,
    // Real and nullable: the indexer returns null when there's no ~24h-old
    // trade to compare against. Never fake a 0 — null renders a neutral "—".
    change24h: c.change24h ?? null,
    marketCapUsd: marketCapWeth * ethUsd,
    curve: c.tickUpper > c.tickLower ? curve : 0,
    graduated: tick >= c.tickUpper,
    lore: meta.description ?? "",
    vol: volWeth > 0 ? `$${Math.round(volWeth * ethUsd).toLocaleString()}` : "$0",
  }
}

/** Live coins from the indexer. Returns null if it's unreachable. */
export async function fetchCoins(): Promise<Coin[] | null> {
  type Res = { coins: { items: IndexedCoin[] } }

  let data = await gql<Res>(coinsQuery(true))
  // Either the indexer is down or it predates holderCount/change24h. Retry
  // plain: if that works it was the latter, and those fields stay null.
  if (!data) data = await gql<Res>(coinsQuery(false))

  const items = data?.coins?.items
  if (!items) return null

  const { usd } = await getEthUsd()
  return items.map((c) => toCoin(c, usd))
}

export async function fetchCoin(address: string): Promise<Coin | null> {
  const coins = await fetchCoins()
  return coins?.find((c) => c.address.toLowerCase() === address.toLowerCase()) ?? null
}

export type Trade = {
  /** `${txHash}-${logIndex}` — one tx can hold two swaps, so this is the row key. */
  id: string
  kind: "buy" | "sell"
  /** WETH in/out of the swap, preformatted. */
  eth: string
  ago: string
  txHash: string
}

type IndexedSwap = {
  id: string
  isBuy: boolean
  amountWeth: string
  timestamp: string
  txHash: string
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n
}

/**
 * Recent trades for one coin. `[]` = genuinely no trades yet (the honest state
 * for a fresh launch); `null` = the indexer couldn't be reached.
 */
export async function fetchTrades(address: string): Promise<Trade[] | null> {
  if (!isAddress(address)) return null

  const data = await gql<{ swaps: { items: IndexedSwap[] } }>(SWAPS_QUERY, {
    coin: address.toLowerCase(),
  })
  const items = data?.swaps?.items
  if (!items) return null

  return items.map((s) => ({
    id: s.id,
    kind: s.isBuy ? ("buy" as const) : ("sell" as const),
    // Pool amounts are signed from the pool's perspective; we only want size.
    eth: Number(formatEther(abs(BigInt(s.amountWeth)))).toLocaleString("en-US", {
      maximumFractionDigits: 4,
    }),
    ago: ago(Number(s.timestamp)),
    txHash: s.txHash,
  }))
}

export type Holder = {
  address: string
  pct: number
  /** The locked LP position — always the largest holder, by construction. */
  locked: boolean
}

export type Holders = {
  rows: Holder[]
  /** Total distinct holders from the indexer; null until it indexes them. */
  count: number | null
}

/**
 * Top holders for one coin. `null` = the indexer has no `holder` table yet, or
 * is unreachable — callers must render an honest empty state, never invent rows.
 */
export async function fetchHolders(address: string): Promise<Holders | null> {
  if (!isAddress(address)) return null
  const coin = address.toLowerCase()

  const [meta, data] = await Promise.all([
    fetchCoinMeta(coin),
    gql<{ holders: { items: { address: string; balance: string }[] } }>(HOLDERS_QUERY, { coin }),
  ])

  const items = data?.holders?.items
  if (!items) return null

  // The LP tokens sit in the pool; the position NFT is held by LpLocker. Either
  // one showing up as a holder is the locked position, not a trader.
  const locked = new Set(
    [CONTRACTS.lpLocker, meta?.pool].filter((a) => !!a).map((a) => a!.toLowerCase()),
  )

  return {
    rows: items.map((h) => ({
      address: h.address,
      pct: (Number(formatEther(BigInt(h.balance))) / SUPPLY_TOKENS) * 100,
      locked: locked.has(h.address.toLowerCase()),
    })),
    count: meta?.holderCount ?? null,
  }
}

/** `pool` + `holderCount` for one coin — the bits `Coin` doesn't carry. */
async function fetchCoinMeta(
  coin: string,
): Promise<{ pool: string; holderCount: number | null } | null> {
  type Res = { coin: { pool: string; holderCount?: number | null } | null }
  const q = (extended: boolean) =>
    `query ($coin: String!) { coin(address: $coin) { pool ${extended ? "holderCount" : ""} } }`

  let data = await gql<Res>(q(true), { coin })
  if (!data) data = await gql<Res>(q(false), { coin })
  if (!data?.coin) return null

  return { pool: data.coin.pool, holderCount: data.coin.holderCount ?? null }
}
