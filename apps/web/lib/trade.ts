"use client"

import * as React from "react"
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits } from "viem"
import {
  useBalance,
  useReadContract,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi"

import { UNISWAP, arc } from "@/lib/chain"
import { swapRouterAbi } from "@/lib/router-abi"
import { useWallet } from "@/components/wallet-provider"
import type { Coin } from "@/lib/coin"

/**
 * QuoterV2 — minimal ABI, kept local on purpose. `lib/abis/` holds the verified
 * ABIs of *our* deployed contracts and is owned elsewhere; Uniswap's periphery
 * doesn't belong there.
 *
 * `quoteExactInputSingle` is NOT `view`. QuoterV2 quotes by starting a real swap
 * and reverting inside the swap callback, then decoding the revert payload — so
 * it is declared non-payable and a plain read (`useReadContract`) fails. It must
 * be *simulated* (eth_call), which is what `useSimulateContract` does.
 *
 * Verified live: selector 0xc6a5026a is present in the deployed bytecode at
 * UNISWAP.quoterV2, and returns real numbers for the $SMOKE pool.
 */
const quoterV2Abi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const


// The ABI, its traps, and the selectors that pin them live in lib/router-abi.ts
// and are verified by lib/router-abi.selfcheck.ts. Do not inline them here again.

/**
 * Every launchpad coin is 18 decimals: LaunchToken.sol takes OpenZeppelin's
 * default and never overrides `decimals()`. Verified on-chain against $SMOKE.
 */
const COIN_DECIMALS = 18

/**
 * 5%. Deliberately wide: the whole market is ~6.9 USDC deep, so any concurrent
 * trade moves the price several percent. A tighter tolerance would revert honest
 * trades far more often than it would save anyone from a sandwich — there is no
 * meaningful MEV on a pool this thin.
 */
const SLIPPAGE_BPS = 500n

/**
 * amountOutMinimum = quote − slippage. bigint division truncates, so this always
 * rounds DOWN: the floor never lands above the quote, and never asks the pool for
 * more than it offered. Rounding the other way would manufacture reverts.
 */
export function applySlippage(amountOut: bigint): bigint {
  return (amountOut * (10_000n - SLIPPAGE_BPS)) / 10_000n
}

/** How long a signed swap stays valid. Arc blocks are ~0.5s, so this is generous. */
const DEADLINE_SECONDS = 600n

/**
 * Absolute unix deadline for the v1 router. Computed at click time, not module
 * load, or a long-lived tab would sign an already-expired swap.
 *
 * Arc caveat: block timestamps are non-decreasing, not strictly increasing —
 * consecutive blocks may share one. The router's check is `block.timestamp <=
 * deadline`, which a repeated timestamp cannot break.
 */
export function swapDeadline(now: number = Date.now()): bigint {
  return BigInt(Math.floor(now / 1000)) + DEADLINE_SECONDS
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
  /** Quoted output in base units — coin for a buy, wrapped USDC for a sell. */
  amountOut?: bigint
  /** Same, as a display float. */
  amountOutFloat: number
  quoting: boolean
  /** Spendable balance for the current side — native USDC for a buy, coin for a sell. */
  balance?: bigint
  /** Why the trade can't be submitted. Render it; the button is disabled. */
  disabledReason?: string
  canSubmit: boolean
  /** True while the sell's approve tx is in flight (button stays "ABANDON SHIP"). */
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

/**
 * Everything the trade panel needs: a live QuoterV2 quote, allowance handling,
 * and the swap itself. The panel stays presentational.
 */
export function useTrade(coin: Coin, side: Side, amount: string): Trade {
  const { address } = useWallet()
  const coinAddress = coin.address as `0x${string}`

  const amountIn = parseAmount(amount, side === "buy" ? 18 : COIN_DECIMALS)

  // Token ordering is NOT assumed. The router derives zeroForOne from
  // tokenIn < tokenOut itself, and we pass sqrtPriceLimitX96 = 0 so it picks the
  // correct directional bound. This matters more on Arc than it did on
  // Robinhood: WUSDC sits mid-range (0x911b…), so coins sort either side of it
  // roughly half the time rather than ~4.6%.
  const [tokenIn, tokenOut] = side === "buy" ? [UNISWAP.wrappedNative, coinAddress] : [coinAddress, UNISWAP.wrappedNative]

  // chainId is pinned so quotes still work before connect and while the wallet
  // sits on the wrong network — the user sees real numbers before committing.
  const quote = useSimulateContract({
    address: UNISWAP.quoterV2,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee: UNISWAP.feeTier, sqrtPriceLimitX96: 0n }],
    chainId: arc.id,
    query: {
      enabled: amountIn > 0n,
      // A revert means "no route / no liquidity", not a flaky RPC. Don't retry.
      retry: false,
      refetchInterval: 12_000,
    },
  })
  const amountOut = quote.data?.result?.[0]

  const usdcBalance = useBalance({
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
  const allowance = useReadContract({
    address: coinAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, UNISWAP.swapRouter] : undefined,
    chainId: arc.id,
    query: { enabled: side === "sell" && !!address },
  })

  const needsApproval = side === "sell" && amountIn > 0n && (allowance.data ?? 0n) < amountIn

  const { writeContract, data: hash, isPending, error: writeError, reset: resetWrite } = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash, chainId: arc.id })
  const [step, setStep] = React.useState<"idle" | "approve" | "swap">("idle")

  const swap = React.useCallback(() => {
    if (!address || amountOut === undefined || amountOut === 0n) return
    const minOut = applySlippage(amountOut)

    const calls =
      side === "buy"
        ? [
            encodeFunctionData({
              abi: swapRouterAbi,
              functionName: "exactInputSingle",
              args: [
                {
                  tokenIn,
                  tokenOut,
                  fee: UNISWAP.feeTier,
                  recipient: address,
                  deadline: swapDeadline(),
                  amountIn,
                  amountOutMinimum: minOut,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            }),
            // MANDATORY, not politeness. A v3 swap only pulls what the range can
            // absorb: quoting 100 USDC into this pool consumes ~6.9 and stops at
            // the tick boundary. The router wraps only what the pool actually
            // takes, so the remainder would sit in the router as loose native
            // USDC that *anyone* could sweep with refundUSDC(). Bundling it here
            // is what makes the "extra USDC auto-refunds" note true and safe.
            encodeFunctionData({ abi: swapRouterAbi, functionName: "refundUSDC" }),
          ]
        : [
            // Sell pays out to the router, then unwraps, so the seller receives
            // native USDC rather than WUSDC they'd have to unwrap themselves.
            // recipient is the router's literal address rather than the
            // ADDRESS_THIS sentinel (address(2)) — if this fork's sentinel ever
            // differed, address(2) would be a burn. The literal is always correct.
            encodeFunctionData({
              abi: swapRouterAbi,
              functionName: "exactInputSingle",
              args: [
                {
                  tokenIn,
                  tokenOut,
                  fee: UNISWAP.feeTier,
                  recipient: UNISWAP.swapRouter,
                  deadline: swapDeadline(),
                  amountIn,
                  amountOutMinimum: minOut,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            }),
            encodeFunctionData({
              abi: swapRouterAbi,
              functionName: "unwrapWUSDC",
              args: [minOut, address],
            }),
          ]

    setStep("swap")
    writeContract({
      address: UNISWAP.swapRouter,
      abi: swapRouterAbi,
      functionName: "multicall",
      args: [calls],
      // Buys send native ETH: the router wraps exactly what the pool consumes via
      // WRAPPED_NATIVE.deposit() inside its pay() path, so the user never needs a separate
      // wrap tx *or* a NATIVE approval. Chosen over wrapping manually (deposit →
      // approve → swap = 3 txs, and leaves stray NATIVE behind on a partial fill).
      value: side === "buy" ? amountIn : 0n,
      chainId: arc.id,
    })
  }, [address, amountOut, amountIn, side, tokenIn, tokenOut, writeContract])

  const submit = React.useCallback(() => {
    if (needsApproval) {
      setStep("approve")
      writeContract({
        address: coinAddress,
        abi: erc20Abi,
        functionName: "approve",
        // Exact amount, not max. This router is a third-party fork (UnitFlow)
        // verified only by selector probe, and Arc is a public testnet full of
        // lookalike contracts (see the
        // warning in lib/chain.ts). An unlimited allowance to it is a standing
        // risk; one extra tx per sell is the cheaper trade. The swap auto-chains
        // off the approve receipt, so it's still a single click.
        args: [UNISWAP.swapRouter, amountIn],
        chainId: arc.id,
      })
      return
    }
    swap()
  }, [needsApproval, writeContract, coinAddress, amountIn, swap])

  // Approve landed → fire the swap automatically (one click for the user).
  // Swap landed → refetch allowance/balance, otherwise a stale allowance would
  // make the *next* sell skip approve and revert.
  const refetchAllowance = allowance.refetch
  const refetchCoinBalance = coinBalance.refetch
  React.useEffect(() => {
    if (!receipt.isSuccess) return
    if (step === "approve") {
      swap()
    } else if (step === "swap") {
      void refetchAllowance()
      void refetchCoinBalance()
    }
  }, [receipt.isSuccess, step, swap, refetchAllowance, refetchCoinBalance])

  const balance = side === "buy" ? usdcBalance.data?.value : coinBalance.data
  const quoting = quote.isFetching && amountOut === undefined

  let disabledReason: string | undefined
  if (amountIn <= 0n) {
    disabledReason = undefined // nothing typed yet — disabled, but don't scold
  } else if (balance !== undefined && amountIn > balance) {
    disabledReason =
      side === "buy" ? "Not enough USDC in the hold" : `Not enough $${coin.ticker} to abandon`
  } else if (quoting) {
    disabledReason = undefined
  } else if (quote.error) {
    // Live example: every $SMOKE sell quote reverts today — nobody has bought, so
    // the pool holds zero NATIVE and there is nothing to sell into.
    disabledReason =
      side === "sell"
        ? `No exit liquidity — nobody has bought $${coin.ticker} yet`
        : "No route — this pool has no liquidity"
  } else if (amountOut === 0n) {
    disabledReason = side === "buy" ? "The range is dry — nothing left to buy" : "Quote came back empty"
  }

  const busy = isPending || receipt.isLoading

  return {
    amountOut,
    amountOutFloat: amountOut === undefined ? 0 : Number(formatUnits(amountOut, 18)),
    quoting,
    balance,
    disabledReason,
    canSubmit: amountIn > 0n && amountOut !== undefined && amountOut > 0n && !disabledReason && !busy,
    approving: step === "approve" && busy,
    submit,
    busy,
    hash,
    success: step === "swap" && receipt.isSuccess,
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
  return first.length > 90 ? `${first.slice(0, 90)}…` : first
}
