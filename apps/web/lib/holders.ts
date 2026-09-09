import "server-only"

import { formatUnits, isAddress } from "viem"

import { EXPLORER } from "@/lib/chain"
import { fetchCoinPool } from "@/lib/indexer"
import { CONTRACTS, CONSTANTS } from "@workspace/contracts"

/**
 * Top holders, read from Arcscan (Blockscout) instead of indexed from Transfer
 * logs. This file exists for one reason, and it is an RPC-cost reason:
 *
 * Watching ERC20 Transfer for launched tokens needs a ponder `factory()` source,
 * and ponder CANNOT bloom-filter one. The child token addresses are unknown when
 * the filter runs, so the address half of the match is forced true and matching
 * collapses to topic0 alone. topic0 here is `Transfer`, which nearly every block
 * on a live chain carries — so the indexer pulled the logs of essentially EVERY
 * block, the whole chain's ERC20 traffic by everyone, to observe the handful of
 * transfers our own tokens have had.
 *
 * On Arc that was not merely expensive, it was fatal: the public RPC caps
 * `eth_getLogs` at ~20 addresses and every launch adds one, so past ~20 coins
 * the request failed outright. The RPC reports that address-count limit with the
 * message "requested range too large", so ponder shrank the BLOCK range and
 * retried forever — an unrecoverable stall at a fixed percentage, with no error.
 * See AGENTS.md § "The factory() bloom trap".
 *
 * Blockscout already indexes every transfer on this chain and serves the ranked
 * list for free. This is display-only data with an honest empty state already
 * wired ("Holder manifest isn't indexed yet" on null), so a third-party read is
 * the right trade — nothing anyone signs depends on a leaderboard.
 */

export type Holder = {
  address: string
  /** Share of total supply, percent. */
  pct: number
  /** The locked LP position — always the largest holder, by construction. */
  locked: boolean
}

export type Holders = {
  rows: Holder[]
  /** Total distinct holders. null = explorer unreachable; the UI renders "—". */
  count: number | null
}

const ROWS = 12
const SUPPLY_TOKENS = CONSTANTS.supplyTokens

/**
 * `/holders` is the slow endpoint on this explorer; `/counters` answers fast.
 *
 * Nothing may block a page render on the slow one, so reads are
 * stale-while-revalidate: a warm value is returned instantly and refreshed
 * behind the render, and a cold read gets a short budget before giving up for
 * THIS render while the fetch carries on filling the memo for the next one. The
 * token page re-renders every 15s (AutoRefresh), so a cold card populates one
 * tick later instead of holding the whole page hostage.
 *
 * The split matters: the holder COUNT (the stat tile) comes from the fast
 * endpoint and is worth waiting for; the ranked LIST is best-effort.
 */
const TTL_OK_MS = 60_000
const TTL_FAIL_MS = 10_000
/** How long a render waits for a value it does not have yet. */
const COLD_BUDGET_MS = { fast: 4000, slow: 2500 }
/** How long the fetch itself gets, once it is off the render's critical path. */
const FETCH_TIMEOUT_MS = 12_000

const memo = new Map<string, { at: number; value: unknown }>()
const inflight = new Map<string, Promise<unknown>>()

/**
 * Fetch and store, deduped: concurrent renders of the same coin share one
 * request rather than each starting their own round trip. Never rejects — every
 * failure is a `null` in the memo, which renders as an honest empty state.
 */
function refresh<T>(path: string): Promise<T | null> {
  const existing = inflight.get(path) as Promise<T | null> | undefined
  if (existing) return existing

  const started = (async () => {
    let value: T | null = null
    try {
      const res = await fetch(`${EXPLORER}/api/v2${path}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        // NOT next:{revalidate}: the token page is force-dynamic, which Next
        // documents as forcing every fetch in the page to {cache:'no-store',
        // revalidate:0}. A revalidate hint would be silently overridden and
        // every AutoRefresh tick, per open tab, would hit the explorer. This
        // memo is the only cache.
        cache: "no-store",
      })
      if (res.ok) value = (await res.json()) as T
    } catch {
      value = null // unreachable, timed out, or not JSON — all render as "—"
    }
    memo.set(path, { at: Date.now(), value })
    inflight.delete(path)
    return value
  })()

  inflight.set(path, started)
  return started
}

async function blockscout<T>(path: string, speed: "fast" | "slow"): Promise<T | null> {
  const hit = memo.get(path)
  if (hit) {
    const ttl = hit.value === null ? TTL_FAIL_MS : TTL_OK_MS
    if (Date.now() - hit.at >= ttl) void refresh<T>(path) // behind the render
    return hit.value as T | null
  }
  // Cold. Give it a budget, then let this render go without it.
  return Promise.race([
    refresh<T>(path),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), COLD_BUDGET_MS[speed])),
  ])
}

type HoldersResponse = { items?: { address?: { hash?: string }; value?: string }[] }
type CountersResponse = { token_holders_count?: string }

/** Top holders for one coin. `null` = the explorer had nothing for us — callers
 *  must render an honest empty state, never invent rows. */
export async function fetchHolders(address: string): Promise<Holders | null> {
  if (!isAddress(address)) return null
  const token = address.toLowerCase()

  const [list, counters, pool] = await Promise.all([
    blockscout<HoldersResponse>(`/tokens/${token}/holders`, "slow"),
    blockscout<CountersResponse>(`/tokens/${token}/counters`, "fast"),
    // On Uniswap v3 the pool is a real address holding the whole locked float,
    // and LpLocker holds the position NFT. Either is locked liquidity, not a
    // trader — rendered as "🏦 locked position" rather than as a whale.
    fetchCoinPool(token),
  ])

  const count = Number(counters?.token_holders_count)
  const holderCount = Number.isFinite(count) ? count : null

  // The list is best-effort; the count is not. A cold render shows "103 aboard"
  // over an empty manifest rather than nothing at all, and the list lands on the
  // next AutoRefresh tick.
  const items = list?.items
  if (!items) return holderCount === null ? null : { rows: [], count: holderCount }

  const locked = new Set(
    [CONTRACTS.launchLocker, pool].filter((a) => !!a).map((a) => a!.toLowerCase()),
  )

  const rows: Holder[] = items.slice(0, ROWS).flatMap((h) => {
    const hash = h.address?.hash
    // Balances arrive as a decimal string. Anything else is skipped rather than
    // fed to BigInt(), which throws and would take the whole page down.
    if (!hash || !h.value || !/^\d+$/.test(h.value)) return []
    // Blockscout returns EIP-55 mixed case; the indexer returned lowercase, and
    // callers still key profile lookups off the lowercased form.
    const addr = hash.toLowerCase()
    return [
      {
        address: addr,
        // A launch token is 18dp, genuinely. (Not the 6dp quote asset.)
        pct:
          (Number(formatUnits(BigInt(h.value), CONSTANTS.coinDecimals)) / SUPPLY_TOKENS) * 100,
        locked: locked.has(addr),
      },
    ]
  })

  return { rows, count: holderCount }
}

/**
 * Protocol-wide holder positions: the per-coin counts, summed.
 *
 * This is POSITIONS, not unique wallets — one wallet holding three coins counts
 * three times, and the explorer offers no cross-token view that would let us say
 * otherwise. Each read rides the same fast-endpoint memo as the token page, so a
 * warm harbor costs nothing and a cold one degrades to `null` rather than
 * holding the render.
 *
 * Returns `null` when every coin came back empty, so the caller can print an
 * empty state instead of a wrong total. A partial answer is still returned:
 * `counted` says how many coins are actually behind the number.
 */
export async function fetchHolderPositions(
  addresses: string[],
): Promise<{ positions: number; counted: number } | null> {
  const counts = await Promise.all(
    addresses.filter((a) => isAddress(a)).map(async (address) => {
      const c = await blockscout<CountersResponse>(
        `/tokens/${address.toLowerCase()}/counters`,
        "fast",
      )
      const n = Number(c?.token_holders_count)
      return Number.isFinite(n) ? n : null
    }),
  )

  const known = counts.filter((n): n is number => n !== null)
  if (known.length === 0) return null
  return { positions: known.reduce((sum, n) => sum + n, 0), counted: known.length }
}
