"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { erc20Abi, formatEther, zeroAddress, type Address, type PublicClient } from "viem"
import { usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi"

import { CONTRACTS } from "@workspace/contracts"
import { FeeEscrowAbi, LaunchFactoryAbi, LaunchLockerAbi } from "@/lib/abis"
import { coinIsToken0, coinSpaceTick, tickToPriceNative } from "@/lib/indexer"
import { FACE_OPTIONS } from "@/lib/coin"
import { env } from "@/lib/env"

/**
 * The fee flow on contracts v2.
 *
 * Still two transactions on two contracts, but both got simpler:
 *
 *   collect = LaunchLocker.collectFees(TOKEN)
 *             sweeps the locked position's fees, splits them, and CREDITS the
 *             creator's share to the escrow. Permissionless.
 *             `pendingFees(token)` reads what is waiting, so there is no
 *             simulate-the-write trick any more.
 *
 *   claim   = FeeEscrow.claim() / claimToken(token)
 *             withdraws the caller's escrow balance to their own wallet.
 *
 * Two v2 differences that change the shape of this file:
 *
 * 1. **Keyed by token, not tokenId.** v1.4 had per-position recipient slots with
 *    bps shares; v2 has exactly ONE `creatorFeeRecipient` per launch, so a
 *    wallet either earns all of a launch's creator share or none of it.
 * 2. **The escrow's native balance is ONE bucket.** `balanceOf(owner)` pools
 *    every launch's native fees together — there is no per-token native figure
 *    to show, which is exactly why the design's single Claim button is right.
 */

const INDEXER_URL = env.indexerUrl

const LOCKER = CONTRACTS.launchLocker as Address
const ESCROW = CONTRACTS.feeEscrow as Address
const FACTORY = CONTRACTS.launchFactory as Address

/** A launch this wallet earns the creator share of. `collect` targets these. */
export type FeePosition = {
  token: Address
  name: string
  symbol: string
  emoji: string
  /** Uploaded coin art (ipfs://CID) or null — null renders the emoji. */
  image: string | null
  /**
   * This wallet's share of fees sitting on the position, not yet swept to
   * escrow. null = the read failed (never rendered as a fake 0).
   */
  earnedToken: bigint | null
  earnedNative: bigint | null
}

/** An escrow balance. `claim` targets these. */
export type FeeBalance = {
  /** zeroAddress = the native bucket, shared across every launch. */
  token: Address
  symbol: string
  emoji: string
  /** Withdrawable right now. Read from the CHAIN, since it gates a signature.
   *  null when that read failed — render a dash, never a zero. */
  claimable: bigint | null
  isNative: boolean
}

export type Holding = {
  token: Address
  name: string
  symbol: string
  emoji: string
  image: string | null
  balance: bigint
  /** Value in NATIVE from the pool's current tick. null when there's no price. */
  valueNative: number | null
}

type RawCoin = {
  address: Address
  name: string
  symbol: string
  image?: string | null
  tick: number | null
  tickLower: number
  tickUpper: number
  coinIsToken0: boolean
  swapCount: number
}

// ponytail: joins against the whole coin list (capped at 100). Swap to a
// creator-filtered query if the harbor outgrows one page.
const PORTFOLIO_QUERY = `query {
  coins(limit: 100) {
    items { address name symbol image tick tickLower tickUpper coinIsToken0 swapCount }
  }
}`

/** Throws when the indexer is unreachable — the caller shows an honest error. */
async function fetchCoins(): Promise<RawCoin[]> {
  const res = await fetch(`${INDEXER_URL}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: PORTFOLIO_QUERY }),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`indexer ${res.status}`)
  const json = await res.json()
  const coins: RawCoin[] | undefined = json?.data?.coins?.items
  if (!coins) throw new Error("indexer returned no data")
  return coins
}

// ponytail: mirrors the private emojiFor() in lib/indexer.ts so a coin keeps the
// same face here as on the harbor grid. Export it there and delete this.
function emojiFor(address: string): string {
  let h = 0
  for (let i = 2; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) % 997
  return FACE_OPTIONS[h % FACE_OPTIONS.length]!
}

/**
 * One flaky read must not blank the whole portfolio. Arc's RPC drops
 * connections intermittently, and an unguarded read inside a Promise.all
 * rejected the entire query — the page then blamed the indexer, which was fine.
 * A null degrades one figure to a dash instead.
 */
async function tryRead<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch {
    return null
  }
}

/**
 * The creator's cut of a collected fee, per the v2 split — applied to each
 * currency alike:
 *
 *   protocolShare = amount × (baseFeeBps × protocolFeeShareBps)
 *                          ÷ ((baseFeeBps + creatorTaxBps) × 10000)
 *   creatorShare  = amount − protocolShare
 *
 * The creator tax goes to the creator whole; the protocol only ever takes a
 * share of the BASE part. Showing the position total instead would overstate
 * what the wallet can actually claim.
 */
function creatorShare(
  amount: bigint,
  baseFeeBps: number,
  creatorTaxBps: number,
  protocolFeeShareBps: number,
): bigint {
  const denom = BigInt(baseFeeBps + creatorTaxBps) * 10_000n
  if (denom === 0n) return amount
  const protocol = (amount * BigInt(baseFeeBps) * BigInt(protocolFeeShareBps)) / denom
  return amount - protocol
}

/**
 * Everything the portfolio needs: discovery from the indexer, then every number
 * the user might sign against read straight from the chain.
 */
export function usePortfolio(owner?: Address) {
  const publicClient = usePublicClient()

  return useQuery({
    queryKey: ["portfolio", owner],
    enabled: !!owner && !!publicClient,
    queryFn: async () => {
      const addr = owner!
      const client = publicClient! as PublicClient
      const coins = await fetchCoins()

      // Who earns each launch's creator share is CHAIN state, not something the
      // indexer is trusted for — the recipient can be moved through a timelock.
      const records = await Promise.all(
        coins.map((c) =>
          tryRead(() =>
            client.readContract({
              address: FACTORY,
              abi: LaunchFactoryAbi,
              functionName: "getLaunchedToken",
              args: [c.address],
            }),
          ),
        ),
      )

      const mine = coins
        .map((coin, i) => ({ coin, record: records[i] }))
        .filter(
          ({ record }) =>
            record?.exists &&
            record.creatorFeeRecipient.toLowerCase() === addr.toLowerCase(),
        )

      // --- positions: what `collect` acts on (keyed by token) ---
      const positions: FeePosition[] = await Promise.all(
        mine.map(async ({ coin, record }) => {
          const pending = await tryRead(() =>
            client.readContract({
              address: LOCKER,
              abi: LaunchLockerAbi,
              functionName: "pendingFees",
              args: [coin.address],
            }),
          )
          const share = (amount: bigint) =>
            creatorShare(
              amount,
              Number(record!.baseFeeBps),
              Number(record!.creatorTaxBps),
              Number(record!.protocolFeeShareBps),
            )
          // pendingFees returns (amount0, amount1) in POOL order, and native is
          // always currency0 on a native-quoted pool — but derive it rather than
          // assume, or an ERC-20-quoted launch reports the two sides swapped.
          const isToken0 = coinIsToken0(coin.address)
          const p0 = pending ? share(pending[0]) : null
          const p1 = pending ? share(pending[1]) : null
          return {
            token: coin.address,
            name: coin.name,
            symbol: coin.symbol,
            emoji: emojiFor(coin.address),
            image: coin.image ?? null,
            earnedToken: isToken0 ? p0 : p1,
            earnedNative: isToken0 ? p1 : p0,
          }
        }),
      )

      // --- balances: what `claim` acts on ---
      // The native bucket is shared across every launch, so it is ONE row. Each
      // launch's token side gets its own.
      const nativeClaimable = await tryRead(() =>
        client.readContract({
          address: ESCROW,
          abi: FeeEscrowAbi,
          functionName: "balanceOf",
          args: [addr],
        }),
      )

      const tokenBalances: FeeBalance[] = await Promise.all(
        mine.map(async ({ coin }) => ({
          token: coin.address,
          symbol: coin.symbol,
          emoji: emojiFor(coin.address),
          isNative: false,
          claimable: await tryRead(() =>
            client.readContract({
              address: ESCROW,
              abi: FeeEscrowAbi,
              functionName: "balanceOfToken",
              args: [addr, coin.address],
            }),
          ),
        })),
      )

      const balances: FeeBalance[] = [
        { token: zeroAddress, symbol: "USDC", emoji: "💵", isNative: true, claimable: nativeClaimable },
        ...tokenBalances.filter((b) => b.claimable === null || b.claimable > 0n),
      ]

      // --- holdings: every launched coin this wallet actually holds ---
      const holdings: Holding[] = (
        await Promise.all(
          coins.map(async (coin) => {
            const bal = await tryRead(() =>
              client.readContract({
                address: coin.address,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [addr],
              }),
            )
            if (!bal || bal === 0n) return null
            const tick = coinSpaceTick(coin)
            return {
              token: coin.address,
              name: coin.name,
              symbol: coin.symbol,
              emoji: emojiFor(coin.address),
              image: coin.image ?? null,
              balance: bal,
              valueNative:
                tick === null ? null : Number(formatEther(bal)) * tickToPriceNative(tick),
            }
          }),
        )
      ).filter((h): h is Holding => h !== null)

      return { positions, balances, holdings }
    },
  })
}

/**
 * collect — LaunchLocker.collectFees(token). Position -> escrow.
 * Permissionless: anyone may sweep anyone's launch.
 */
export function useCollect(onDone: () => void): {
  collect: (token: Address) => void
  token: Address | null
  pending: boolean
  hash?: `0x${string}`
  error: Error | null
} {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const [token, setToken] = React.useState<Address | null>(null)
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  const done = React.useRef<`0x${string}` | null>(null)

  React.useEffect(() => {
    if (isSuccess && hash && done.current !== hash) {
      done.current = hash
      onDone()
    }
  }, [isSuccess, hash, onDone])

  return {
    collect: (t: Address) => {
      setToken(t)
      reset()
      done.current = null
      writeContract({ address: LOCKER, abi: LaunchLockerAbi, functionName: "collectFees", args: [t] })
    },
    /** Which launch is mid-flight, so only that row shows a spinner. */
    token: isPending || confirming ? token : null,
    pending: isPending || confirming,
    hash,
    error,
  }
}

/**
 * claim — FeeEscrow.claim() / claimToken(token). Escrow -> the caller's wallet.
 *
 * Unlike v1.4's FeeLocker these pay the CALLER, not a named owner, so there is
 * no owner argument and no claiming on someone else's behalf.
 */
export function useClaim(onDone: () => void): {
  claim: (balance: FeeBalance) => void
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

  return {
    claim: (balance: FeeBalance) => {
      reset()
      done.current = null
      if (balance.isNative) {
        writeContract({ address: ESCROW, abi: FeeEscrowAbi, functionName: "claim", args: [] })
      } else {
        writeContract({
          address: ESCROW,
          abi: FeeEscrowAbi,
          functionName: "claimToken",
          args: [balance.token],
        })
      }
    },
    pending: isPending || confirming,
    hash,
    error,
  }
}

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
