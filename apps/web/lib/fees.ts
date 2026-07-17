"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { erc20Abi, formatEther, type Address, type PublicClient } from "viem"
import { usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi"

import { FeeLockerAbi } from "@/lib/abis/feeLocker"
import { LpLockerAbi } from "@/lib/abis/lpLocker"
import { CONTRACTS, UNISWAP } from "@/lib/chain"
import { coinIsToken0, coinSpaceTick, tickToPriceWeth } from "@/lib/indexer"
import { FACE_OPTIONS } from "@/lib/coin"

/**
 * The fee flow, for real.
 *
 * Two DIFFERENT transactions on two DIFFERENT contracts. They are never merged:
 *
 *   collect = LpLocker.collectFees(tokenId)
 *             sweeps fees accrued ON the locked LP position INTO FeeLocker escrow.
 *             Permissionless — anyone can trigger it for any position.
 *
 *   claim   = FeeLocker.claim(feeOwner, token) / claimMany(feeOwner, tokens)
 *             withdraws the escrow balance TO the fee owner's wallet.
 *             Permissionless too, and it always pays the OWNER, never the caller.
 *
 * So a reward is in exactly one of three places:
 *   earned-but-uncollected (on the position) -> claimable (in escrow) -> claimed (wallet)
 *
 * The two live on different axes and are modelled that way:
 *   - `positions` are keyed by tokenId       -> what `collect` acts on
 *   - `balances`  are keyed by token address -> what `claim` acts on
 * Escrow is (feeOwner, token), NOT (feeOwner, tokenId): if you're a recipient on
 * two positions, their WETH lands in ONE availableFees(owner, WETH) bucket.
 * Showing "claimable" per position row would double-count it.
 */

// Client-side, so it needs a NEXT_PUBLIC_ var. lib/indexer.ts reads the
// server-only INDEXER_URL for its server components; same default on purpose.
const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:42069"

const LP_LOCKER = CONTRACTS.lpLocker as Address
const FEE_LOCKER = CONTRACTS.feeLocker as Address
const WETH = UNISWAP.weth9 as Address

/** A locked position the wallet is a fee recipient of. `collect` targets these. */
export type FeePosition = {
  tokenId: bigint
  /** The launched coin (token0 of the pool). undefined if the indexer has no coin row. */
  token?: Address
  name: string
  symbol: string
  emoji: string
  /** The wallet's share of this position in bps, SUMMED across its slots. */
  bps: number
  /**
   * The wallet's share of fees sitting on the position, not yet swept to escrow.
   * null = we could not read it (never rendered as a fake 0).
   */
  earnedToken: bigint | null
  earnedWeth: bigint | null
}

/** An escrow balance, keyed by token. `claim` targets these. */
export type FeeBalance = {
  token: Address
  symbol: string
  emoji: string
  /** Withdrawable right now via claim(owner, token). Read from the CHAIN. */
  claimable: bigint
  /** true for the WETH bucket — the one shared across every position. */
  isWeth: boolean
  /**
   * Lifetime total ever withdrawn to the wallet for this token.
   *
   * From the indexer's FeesClaimed rollup, not the chain: FeeLocker has no
   * getter for it. Historical, so it can't be signed against — display only.
   * null = the indexer had no row (nothing ever claimed).
   */
  lifetimeClaimed: bigint | null
}

export type Holding = {
  token: Address
  name: string
  symbol: string
  emoji: string
  balance: bigint
  /** Value in WETH from the pool's current tick. null when the pool has no price yet. */
  valueWeth: number | null
}

type RawRecipient = { tokenId: string; bps: number }
type RawFeeBalance = { token: Address; lifetimeClaimed: string }
type RawCoin = {
  address: Address
  name: string
  symbol: string
  tokenId: string
  tick: number | null
  tickLower: number
  // Required by coinSpaceTick(): `tick` is coin-space until the first swap,
  // pool-space after. swapCount is what tells the two apart.
  swapCount: number
}

// ponytail: joins against the whole coin list (one launch today, capped at 100).
// Swap to `coins(where: {tokenId_in: [...]})` if the harbor outgrows one page.
//
// feeBalances is here for lifetimeClaimed ONLY. `claimable` is deliberately NOT
// taken from it: that number gates a signature, so it's read from the chain
// (availableFees) where it can't be stale by an indexer block.
const PORTFOLIO_QUERY = `query($addr: String!) {
  feeRecipients(where: { addr: $addr }, limit: 500) {
    items { tokenId bps }
  }
  feeBalances(where: { owner: $addr }, limit: 100) {
    items { token lifetimeClaimed }
  }
  coins(limit: 100) {
    items { address name symbol tokenId tick tickLower swapCount }
  }
}`

/** Throws when the indexer is unreachable — the caller shows an honest error, not a zero. */
async function fetchPortfolio(addr: Address) {
  const res = await fetch(`${INDEXER_URL}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: PORTFOLIO_QUERY, variables: { addr } }),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`indexer ${res.status}`)
  const json = await res.json()
  const recipients: RawRecipient[] | undefined = json?.data?.feeRecipients?.items
  const coins: RawCoin[] | undefined = json?.data?.coins?.items
  if (!recipients || !coins) throw new Error("indexer returned no data")
  // Absent = nothing ever claimed, which is a real answer, not a failure.
  const claimed: RawFeeBalance[] = json?.data?.feeBalances?.items ?? []
  return { recipients, coins, claimed }
}

// ponytail: mirrors the private emojiFor() in lib/indexer.ts so a coin keeps the
// same face here as on the harbor grid. Export it there and delete this.
function emojiFor(address: string): string {
  let h = 0
  for (let i = 2; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) % 997
  return FACE_OPTIONS[h % FACE_OPTIONS.length]!
}

/**
 * Fees accrued on a position but not yet collected. There is no getter for this,
 * so we eth_call `collectFees` and read what it WOULD return — the position's own
 * accounting, rather than a reimplementation of Uniswap v3 fee math that could drift.
 * Safe to simulate from anyone: collectFees is permissionless (proved from 0xdEaD).
 * Returns the position TOTAL (amount0, amount1); the caller takes its bps share.
 */
async function simulateCollect(
  client: PublicClient,
  tokenId: bigint,
  account: Address
): Promise<readonly [bigint, bigint] | null> {
  try {
    const { result } = await client.simulateContract({
      address: LP_LOCKER,
      abi: LpLockerAbi,
      functionName: "collectFees",
      args: [tokenId],
      account,
    })
    return result
  } catch {
    return null // unregistered position or RPC hiccup — show "—", never a fake 0
  }
}

/**
 * Everything the portfolio needs, in one query: discovery from the indexer, then
 * every number the user might sign against read straight from the chain.
 */
export function usePortfolio(owner?: Address) {
  const publicClient = usePublicClient()

  return useQuery({
    queryKey: ["portfolio", owner],
    enabled: !!owner && !!publicClient,
    queryFn: async () => {
      const addr = owner!
      const client = publicClient! as PublicClient
      const { recipients, coins, claimed } = await fetchPortfolio(addr)

      // A wallet can hold SEVERAL slots on one position — SMOKE's 163160 is two
      // 5000-bps slots for the same creator. Its share is the sum, not one slot.
      const bpsByTokenId = new Map<string, number>()
      for (const r of recipients) {
        bpsByTokenId.set(r.tokenId, (bpsByTokenId.get(r.tokenId) ?? 0) + r.bps)
      }
      const coinByTokenId = new Map(coins.map((c) => [c.tokenId, c]))

      // --- positions: what `collect` acts on (keyed by tokenId) ---
      const positions: FeePosition[] = await Promise.all(
        [...bpsByTokenId].map(async ([tokenId, bps]) => {
          const coin = coinByTokenId.get(tokenId)
          const total = await simulateCollect(client, BigInt(tokenId), addr)
          const share = (amount: bigint) => (amount * BigInt(bps)) / 10_000n
          // collectFees returns (amount0, amount1) in POOL order, and the coin is
          // NOT always token0: the deployed factory mirrors the range instead of
          // salt-mining the coin below WETH9. $SMOKE's pool is token0=WETH9,
          // token1=coin — so assuming coin==token0 swaps the two fee sides and
          // reports WETH as coin earnings. Derive the ordering per coin.
          const isToken0 = coin ? coinIsToken0(coin.address) : true
          const earned0 = total ? share(total[0]) : null
          const earned1 = total ? share(total[1]) : null
          return {
            tokenId: BigInt(tokenId),
            token: coin?.address,
            name: coin?.name ?? `Position #${tokenId}`,
            symbol: coin?.symbol ?? "?",
            emoji: coin ? emojiFor(coin.address) : "🎫",
            bps,
            earnedToken: isToken0 ? earned0 : earned1,
            earnedWeth: isToken0 ? earned1 : earned0,
          }
        })
      )

      // --- balances: what `claim` acts on (keyed by token, deduped) ---
      // Fees accrue in BOTH sides of every pool: the coin AND WETH. Both shown.
      const feeTokens: Address[] = [
        ...new Set(positions.map((p) => p.token).filter((t): t is Address => !!t)),
        WETH,
      ]
      const claimedByToken = new Map(
        claimed.map((b) => [b.token.toLowerCase(), BigInt(b.lifetimeClaimed)])
      )
      const balances: FeeBalance[] = await Promise.all(
        feeTokens.map(async (token) => {
          const claimable = await client.readContract({
            address: FEE_LOCKER,
            abi: FeeLockerAbi,
            functionName: "availableFees",
            args: [addr, token],
          })
          const coin = coins.find((c) => c.address === token)
          return {
            token,
            symbol: token === WETH ? "WETH" : (coin?.symbol ?? "?"),
            emoji: token === WETH ? "Ξ" : emojiFor(token),
            claimable,
            isWeth: token === WETH,
            lifetimeClaimed: claimedByToken.get(token.toLowerCase()) ?? null,
          }
        })
      )

      // --- holdings: real ERC20 balances of coins launched here ---
      // ponytail: one eth_call per coin. Multicall3 IS live on 4663 at the
      // canonical 0xcA11bde0…, but lib/chain.ts doesn't declare it — declare it
      // there and wagmi/viem batch these for free.
      const held = await Promise.all(
        coins.map(async (c) => {
          const balance = await client.readContract({
            address: c.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [addr],
          })
          return { c, balance }
        })
      )
      const holdings: Holding[] = held
        .filter(({ balance }) => balance > 0n)
        .map(({ c, balance }) => {
          // `coin.tick` silently changes meaning: the launch handler writes the
          // event's coin-space tick, the swap handler writes the raw pool tick.
          // coinSpaceTick() normalises both (and handles either token ordering)
          // — feeding the raw tick here priced a coin at ~4.6e22 WETH.
          const priceWeth = tickToPriceWeth(coinSpaceTick(c))
          return {
            token: c.address,
            name: c.name,
            symbol: c.symbol,
            emoji: emojiFor(c.address),
            balance,
            valueWeth: isFinite(priceWeth) ? Number(formatEther(balance)) * priceWeth : null,
          }
        })
        .sort((a, b) => (b.valueWeth ?? 0) - (a.valueWeth ?? 0))

      return { positions, balances, holdings }
    },
  })
}

/**
 * collect — LpLocker.collectFees(tokenId). Position -> escrow.
 * Deliberately its own hook with its own write + receipt, so a pending collect
 * can never be confused with a pending claim.
 */
export function useCollect(onDone: () => void): {
  collect: (id: bigint) => void
  tokenId: bigint | null
  pending: boolean
  hash?: `0x${string}`
  error: Error | null
} {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const [tokenId, setTokenId] = React.useState<bigint | null>(null)
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  const done = React.useRef<`0x${string}` | null>(null)

  React.useEffect(() => {
    if (isSuccess && hash && done.current !== hash) {
      done.current = hash
      onDone()
    }
  }, [isSuccess, hash, onDone])

  return {
    /** Sweeps the position's fees into escrow. Anyone may call this for anyone. */
    collect: (id: bigint) => {
      setTokenId(id)
      reset()
      done.current = null
      writeContract({
        address: LP_LOCKER,
        abi: LpLockerAbi,
        functionName: "collectFees",
        args: [id],
      })
    },
    /** Which position is mid-flight, so only that row shows a spinner. */
    tokenId: isPending || confirming ? tokenId : null,
    pending: isPending || confirming,
    hash,
    error,
  }
}

/**
 * claim — FeeLocker.claim / claimMany. Escrow -> the fee owner's wallet.
 * Separate hook, separate contract, separate receipt from collect.
 */
export function useClaim(onDone: () => void): {
  claim: (owner: Address, token: Address) => void
  claimMany: (owner: Address, balances: FeeBalance[]) => void
  pending: boolean
  hash?: `0x${string}`
  error: Error | null
} {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  const done = React.useRef<`0x${string}` | null>(null)

  React.useEffect(() => {
    if (isSuccess && hash && done.current !== hash) {
      done.current = hash
      onDone()
    }
  }, [isSuccess, hash, onDone])

  const start = () => {
    reset()
    done.current = null
  }

  return {
    /**
     * claim() reverts with NothingToClaim on a zero balance, so callers must
     * gate on claimable > 0 (the UI disables the button rather than revert).
     */
    claim: (owner: Address, token: Address) => {
      start()
      writeContract({
        address: FEE_LOCKER,
        abi: FeeLockerAbi,
        functionName: "claim",
        args: [owner, token],
      })
    },
    /**
     * claimMany SKIPS zero balances instead of reverting; we mirror that here by
     * filtering them out first — same outcome, less gas, and it stays disabled
     * when nothing is claimable rather than sending a no-op tx.
     */
    claimMany: (owner: Address, balances: FeeBalance[]) => {
      const tokens = balances.filter((b) => b.claimable > 0n).map((b) => b.token)
      if (tokens.length === 0) return
      start()
      writeContract({
        address: FEE_LOCKER,
        abi: FeeLockerAbi,
        functionName: "claimMany",
        args: [owner, tokens],
      })
    },
    pending: isPending || confirming,
    hash,
    error,
  }
}

/** Fees are 18dp on both sides: every launched coin is 18dp, and so is WETH9. */
export function fmtFee(amount: bigint | null): string {
  if (amount === null) return "—"
  if (amount === 0n) return "0"
  const n = Number(formatEther(amount))
  if (n < 0.0001) return "<0.0001"
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 })
}

/** Compact token balance: 12.4M. Launched coins are all 18dp. */
export function fmtBalance(amount: bigint): string {
  const n = Number(formatEther(amount))
  // Dust would compact to a flat "0" — never show 0 for a balance they do hold.
  if (n > 0 && n < 0.01) return "<0.01"
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n)
}
