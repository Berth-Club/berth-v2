"use client"

import * as React from "react"
import { erc20Abi, formatUnits, parseUnits } from "viem"
import {
  useBalance,
  useReadContract,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi"

import { UNISWAP, USDC, COIN_DECIMALS, arc } from "@/lib/chain"
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
 * 5%. Deliberately wide: a launch opens at a ~$4,923 market cap, so any
 * concurrent
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
  /** Quoted output in base units — coin (18dp) for a buy, USDC (6dp) for a sell. */
  amountOut?: bigint
  /** Same, as a display float. */
  amountOutFloat: number
  quoting: boolean
  /** Spendable balance in the units of whatever this side spends. */
  balance?: bigint
  /** Why the trade can't be submitted. Render it; the button is disabled. */
  disabledReason?: string
  canSubmit: boolean
  /** True while an approve tx is in flight — either side can need one. */
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

  // A buy spends USDC (6dp); a sell spends the coin (18dp). Parsing a buy at
  // 18 would ask the pool for 1e12x the intended size.
  const amountIn = parseAmount(amount, side === "buy" ? USDC.decimals : COIN_DECIMALS)

  // Token ordering is NOT assumed. The router derives zeroForOne from
  // tokenIn < tokenOut itself, and we pass sqrtPriceLimitX96 = 0 so it picks the
  // correct directional bound.
  const [tokenIn, tokenOut] =
    side === "buy" ? [USDC.address, coinAddress] : [coinAddress, USDC.address]

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

  // The ERC20 view of the SAME balance the wallet shows as native. Reading the
  // 6dp view keeps every number on this side of the app in one unit.
  const usdcBalance = useReadContract({
    address: USDC.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
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
  // BOTH sides need an allowance now. On Robinhood a buy sent native ETH and the
  // router wrapped it, so only sells approved. Here a buy spends ERC20 USDC, so
  // it needs the same approve step -- a two-tx buy, not one.
  const spendToken = side === "buy" ? USDC.address : coinAddress
  const allowance = useReadContract({
    address: spendToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, UNISWAP.swapRouter] : undefined,
    chainId: arc.id,
    query: { enabled: !!address },
  })

  const needsApproval = amountIn > 0n && (allowance.data ?? 0n) < amountIn

  const { writeContract, data: hash, isPending, error: writeError, reset: resetWrite } = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash, chainId: arc.id })
  const [step, setStep] = React.useState<"idle" | "approve" | "swap">("idle")

  const swap = React.useCallback(() => {
    if (!address || amountOut === undefined || amountOut === 0n) return

    // One plain call, both directions. No multicall, no wrap, no unwrap, no
    // refund leg: on Arc the quote asset is an ordinary ERC20 that happens to
    // also be the gas token, so a swap is just a swap. `value` is 0 -- sending
    // native alongside would be a second, unrelated payment the router would
    // strand, since it has no wrapped-native path to spend it through.
    setStep("swap")
    writeContract({
      address: UNISWAP.swapRouter,
      abi: swapRouterAbi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn,
          tokenOut,
          fee: UNISWAP.feeTier,
          recipient: address,
          amountIn,
          amountOutMinimum: applySlippage(amountOut),
          sqrtPriceLimitX96: 0n,
        },
      ],
      chainId: arc.id,
    })
  }, [address, amountOut, amountIn, side, tokenIn, tokenOut, writeContract])

  const submit = React.useCallback(() => {
    if (needsApproval) {
      setStep("approve")
      writeContract({
        address: spendToken,
        abi: erc20Abi,
        functionName: "approve",
        // Exact amount, not max. Arc testnet is full of lookalike contracts (see
        // the warning in lib/chain.ts), and this allowance is over the user's
        // actual dollars, not a memecoin. An unlimited approval is a standing
        // risk; one extra tx is the cheaper trade. The swap auto-chains off the
        // approve receipt, so it stays a single click.
        args: [UNISWAP.swapRouter, amountIn],
        chainId: arc.id,
      })
      return
    }
    swap()
  }, [needsApproval, writeContract, spendToken, amountIn, swap])

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

  const balance = side === "buy" ? usdcBalance.data : coinBalance.data
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
    // A sell quote reverts when nobody has bought yet: the position is 100%
    // token and holds zero USDC, so there is nothing to sell into.
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
    // A buy receives the coin (18dp); a sell receives USDC (6dp). Formatting a
    // sell at 18 would render every payout as 0.000000.
    amountOutFloat:
      amountOut === undefined
        ? 0
        : Number(formatUnits(amountOut, side === "buy" ? COIN_DECIMALS : USDC.decimals)),
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
