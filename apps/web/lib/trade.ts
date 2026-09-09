"use client"

import * as React from "react"
import { erc20Abi, formatUnits, maxUint256, parseUnits, type Address } from "viem"
import {
  useBalance,
  useReadContract,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi"

import { CONSTANTS, CONTRACTS } from "@workspace/contracts"
import { COIN_DECIMALS, arc } from "@/lib/chain"
import { LaunchFactoryAbi, RouterAbi } from "@/lib/abis"
import { useWallet } from "@/components/wallet-provider"
import type { Coin } from "@/lib/coin"

/**
 * Trading on contracts v2 — Uniswap V4 through `BerthClubRouter`.
 *
 * Three things collapsed compared with the V3 path:
 *
 * 1. **A buy spends NATIVE USDC as `msg.value`.** No allowance, no EIP-2612
 *    permit, no multicall — the whole permit apparatus is gone. `msg.value`
 *    must equal `amountIn` EXACTLY or the router reverts `NativeValueMismatch`.
 * 2. **A buy is 18 decimals, not 6.** Native and the ERC20 face are the same
 *    money with different decimals; the 6dp face is refused as a pool currency
 *    outright. Parsing a buy at 6 would ask the pool for 1e12x the size — the
 *    v2 docs call this the single most likely integration bug.
 * 3. **Nothing quotes on chain.** There is no QuoterV2. A quote is a simulation
 *    of the real swap with `minAmountOut = 0`, and the floor is applied to its
 *    result.
 *
 * Only native-quoted pools trade here. An ERC-20-quoted launch needs the
 * pricer's `route()` handed to `buyWithNative` / `sellToNative`; the launch form
 * doesn't create those yet, so neither does this.
 */

export const NATIVE_DECIMALS = CONSTANTS.nativeDecimals

/**
 * 5%. Deliberately wide: a launch opens at a 5,000 USDC FDV, so any concurrent
 * trade moves the price several percent. A tighter tolerance would revert honest
 * trades far more often than it would save anyone from a sandwich — there is no
 * meaningful MEV on a pool this thin.
 */
/**
 * Gas to keep back on a buy, in native wei. A V4 swap through the router is far
 * cheaper than a launch (which measured 2.6M gas), so 0.01 USDC covers ~500k gas
 * at Arc's 20 Gwei minimum base fee with room to spare.
 */
const SWAP_GAS_HEADROOM_WEI = 10_000_000_000_000_000n

export const DEFAULT_SLIPPAGE_BPS = 500n

/** The tolerances the swap card offers. 5% is the default, for the reason above. */
export const SLIPPAGE_CHOICES = [
  { label: "1%", bps: 100n },
  { label: "2%", bps: 200n },
  { label: "5%", bps: 500n },
] as const

/**
 * amountOutMinimum = quote − slippage. bigint division truncates, so this always
 * rounds DOWN: the floor never lands above the quote, and never asks the pool for
 * more than it offered. Rounding the other way would manufacture reverts.
 */
export function applySlippage(amountOut: bigint, bps: bigint = DEFAULT_SLIPPAGE_BPS): bigint {
  return (amountOut * (10_000n - bps)) / 10_000n
}

/** Tolerant parse — the input allows digits and dots, so "1.2.3" and "." reach here. */
function parseAmount(value: string, decimals: number): bigint {
  if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) return 0n
  try {
    return parseUnits(value, decimals)
  } catch {
    return 0n
  }
}

export type Side = "buy" | "sell"

export type Trade = {
  /** Quoted output in base units — coin (18dp) for a buy, native (18dp) for a sell. */
  amountOut?: bigint
  /** Same, as a display float. */
  amountOutFloat: number
  quoting: boolean
  /** Spendable balance in the units of whatever this side spends. */
  balance?: bigint
  /** Why the trade can't be submitted. Render it; the button is disabled. */
  disabledReason?: string
  canSubmit: boolean
  /** True while an approve tx is in flight. Sells only — a buy never approves. */
  approving: boolean
  submit: () => void
  /** Wallet prompt open, or a tx in flight. */
  busy: boolean
  hash?: `0x${string}`
  /** The *swap* landed (not the approve). */
  success: boolean
  error?: string
  reset: () => void
}

export function useTrade(
  coin: Coin,
  side: Side,
  amount: string,
  slippageBps: bigint = DEFAULT_SLIPPAGE_BPS,
): Trade {
  const { address } = useWallet()
  const coinAddress = coin.address as Address

  // Both sides are 18dp now: native USDC in, launch token out, or the reverse.
  const amountIn = parseAmount(amount, side === "buy" ? NATIVE_DECIMALS : COIN_DECIMALS)

  // The pool key, from the factory rather than encoded here — one call, no
  // ordering bugs. Currencies sort ascending and native is address(0), so on a
  // native-quoted pool it is ALWAYS currency0; deriving zeroForOne from the key
  // rather than assuming it keeps an ERC-20-quoted pool honest later.
  const keyRead = useReadContract({
    address: CONTRACTS.launchFactory,
    abi: LaunchFactoryAbi,
    functionName: "poolKeyFor",
    args: [coinAddress],
    chainId: arc.id,
  })
  const poolKey = keyRead.data
  const coinIsCurrency0 = poolKey?.currency0.toLowerCase() === coinAddress.toLowerCase()
  // zeroForOne = "this swap spends currency0". A buy spends the quote asset, a
  // sell spends the coin — so the flag is just which of those is currency0.
  const zeroForOne = side === "buy" ? !coinIsCurrency0 : coinIsCurrency0

  /**
   * The quote IS a simulation of the swap itself, floor set to 0. Nothing on
   * chain quotes, and the router is not a view function, so this is the only
   * honest number available. A revert means "no liquidity", not a flaky RPC.
   */
  const quote = useSimulateContract({
    address: CONTRACTS.router,
    abi: RouterAbi,
    functionName: "swapExactIn",
    args: poolKey && address ? [poolKey, zeroForOne, amountIn, 0n, address] : undefined,
    value: side === "buy" ? amountIn : 0n,
    account: address,
    chainId: arc.id,
    query: {
      enabled: amountIn > 0n && !!poolKey && !!address,
      retry: false,
      refetchInterval: 12_000,
    },
  })
  const amountOut = quote.data?.result

  // A buy spends the NATIVE balance (18dp) — the same money the wallet shows as
  // gas. A sell spends the coin.
  const native = useBalance({
    address,
    chainId: arc.id,
    query: { enabled: side === "buy" && !!address },
  })
  const coinBalance = useReadContract({
    address: coinAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: arc.id,
    query: { enabled: side === "sell" && !!address },
  })
  const balance = side === "buy" ? native.data?.value : coinBalance.data

  // Only a sell moves an ERC20, so only a sell can need an allowance.
  const allowance = useReadContract({
    address: coinAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, CONTRACTS.router] : undefined,
    chainId: arc.id,
    query: { enabled: !!address && side === "sell" },
  })
  const needsApproval = side === "sell" && amountIn > 0n && (allowance.data ?? 0n) < amountIn

  const { writeContract, data: hash, isPending, error: writeError, reset: resetWrite } =
    useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash, chainId: arc.id })
  const [step, setStep] = React.useState<"idle" | "approve" | "swap">("idle")

  // The hash of the approve tx, remembered across the approve->swap hand-off.
  // `hash` is shared by both writes: when the approve confirms we flip `step` to
  // "swap" and fire the swap, but for one render `step` is already "swap" while
  // `hash`/`receipt` still refer to the just-succeeded approve. Without this
  // guard `success` flashes true against the approve receipt.
  const approveHash = React.useRef<`0x${string}` | undefined>(undefined)
  React.useEffect(() => {
    if (step === "approve" && hash) approveHash.current = hash
  }, [step, hash])

  const swap = React.useCallback(() => {
    if (!address || !poolKey || amountOut === undefined || amountOut === 0n) return
    setStep("swap")
    writeContract({
      address: CONTRACTS.router,
      abi: RouterAbi,
      functionName: "swapExactIn",
      args: [poolKey, zeroForOne, amountIn, applySlippage(amountOut, slippageBps), address],
      // Exactly amountIn on a buy, exactly 0 on a sell. Anything else reverts.
      value: side === "buy" ? amountIn : 0n,
      chainId: arc.id,
    })
  }, [address, poolKey, amountOut, amountIn, zeroForOne, side, slippageBps, writeContract])

  // Once the approve confirms, fire the swap. Sells only.
  React.useEffect(() => {
    if (step === "approve" && receipt.isSuccess) swap()
  }, [step, receipt.isSuccess, swap])

  const submit = React.useCallback(() => {
    if (!address) return
    if (needsApproval) {
      setStep("approve")
      writeContract({
        address: coinAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [CONTRACTS.router, maxUint256],
        chainId: arc.id,
      })
      return
    }
    swap()
  }, [address, needsApproval, coinAddress, swap, writeContract])

  const busy = isPending || receipt.isLoading
  const quoting = amountIn > 0n && quote.isLoading

  let disabledReason: string | undefined
  if (!address) disabledReason = "Connect a wallet to trade."
  else if (!poolKey) disabledReason = "No pool for this coin yet."
  else if (
    amountIn > 0n &&
    balance !== undefined &&
    // A BUY spends native USDC as msg.value, which is the same balance that pays
    // gas — so spending all of it always fails. A SELL moves an ERC20 and needs
    // no native headroom beyond what the wallet already reserves.
    balance < (side === "buy" ? amountIn + SWAP_GAS_HEADROOM_WEI : amountIn)
  ) {
    disabledReason =
      side === "buy"
        ? "Not enough USDC in this wallet to cover the trade and gas."
        : `Not enough $${coin.ticker} to sell.`
  } else if (amountIn > 0n && !quoting && amountOut === undefined) {
    disabledReason = "The pool can't fill a trade this size."
  }

  return {
    amountOut,
    // Both sides pay out at 18dp on a native-quoted pool.
    amountOutFloat:
      amountOut === undefined
        ? 0
        : Number(formatUnits(amountOut, side === "buy" ? COIN_DECIMALS : NATIVE_DECIMALS)),
    quoting,
    balance,
    disabledReason,
    canSubmit: amountIn > 0n && amountOut !== undefined && amountOut > 0n && !disabledReason && !busy,
    approving: step === "approve" && busy,
    submit,
    busy,
    hash,
    // Only a swap receipt counts: during the approve->swap hand-off `hash` still
    // points at the approve, so its lingering success must not register.
    success: step === "swap" && receipt.isSuccess && hash !== approveHash.current,
    error: writeError ? shortError(writeError.message) : undefined,
    reset: () => {
      setStep("idle")
      resetWrite()
    },
  }
}

/** Wallet errors are essays. Take the first line. */
function shortError(message: string): string {
  const first = message.split("\n")[0]?.trim() ?? message
  if (/user rejected|denied transaction/i.test(message)) return "You waved it off, captain."
  if (/NativeValueMismatch/i.test(message)) return "The amount and the value didn't match. Try again."
  if (/SlippageExceeded/i.test(message)) return "The price moved past your slippage. Try again."
  return first.length > 90 ? `${first.slice(0, 90)}…` : first
}
