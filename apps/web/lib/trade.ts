"use client"

import * as React from "react"
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits, toFunctionSelector } from "viem"
import {
  useBalance,
  useReadContract,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi"

import { UNISWAP, robinhood } from "@/lib/chain"
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

/**
 * SwapRouter02 — minimal ABI.
 *
 * ⚠️ TRAP: `ExactInputSingleParams` here has SEVEN fields and NO `deadline`
 * (selector 0x04e45aaf). v3-periphery's SwapRouter takes an eight-field struct
 * with `deadline` (selector 0x414bf389) — that function does NOT exist on this
 * deployment. Adding a deadline field silently changes the selector and encodes
 * a call to a function the router doesn't have. Deadlines, if ever needed, go
 * through `multicall(uint256 deadline, bytes[])` — not through this struct.
 * The assertion below fails loudly if anyone re-adds it.
 */
const swapRouter02Abi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  { type: "function", name: "refundETH", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "unwrapWETH9",
    stateMutability: "payable",
    inputs: [
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
] as const

// Runnable guard for the deadline trap above. Dev-only so it costs nothing in
// prod; it throws at module load the moment the struct drifts.
if (process.env.NODE_ENV !== "production") {
  const selector = toFunctionSelector(swapRouter02Abi[0])
  if (selector !== "0x04e45aaf") {
    throw new Error(
      `exactInputSingle selector is ${selector}, expected 0x04e45aaf. ` +
        `SwapRouter02 on chain 4663 has NO deadline field — did someone add one? ` +
        `(0x414bf389 is v3-periphery's deadline variant and does not exist here.)`
    )
  }
}

/**
 * Every launchpad coin is 18 decimals: LaunchToken.sol takes OpenZeppelin's
 * default and never overrides `decimals()`. Verified on-chain against $SMOKE.
 */
const COIN_DECIMALS = 18

/**
 * 5%. Deliberately wide: the whole market is ~6.9 WETH deep, so any concurrent
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
  /** Quoted output in base units — coin for a buy, WETH for a sell. */
  amountOut?: bigint
  /** Same, as a display float. */
  amountOutFloat: number
  quoting: boolean
  /** Spendable balance for the current side — ETH for a buy, coin for a sell. */
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
  // correct directional bound. (Worth knowing: the deployed $SMOKE pool actually
  // has WETH9 as token0 and the coin as token1 — the opposite of what the salt
  // mining is assumed to guarantee. Nothing here depends on it either way.)
  const [tokenIn, tokenOut] = side === "buy" ? [UNISWAP.weth9, coinAddress] : [coinAddress, UNISWAP.weth9]

  // chainId is pinned so quotes still work before connect and while the wallet
  // sits on the wrong network — the user sees real numbers before committing.
  const quote = useSimulateContract({
    address: UNISWAP.quoterV2,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee: UNISWAP.feeTier, sqrtPriceLimitX96: 0n }],
    chainId: robinhood.id,
    query: {
      enabled: amountIn > 0n,
      // A revert means "no route / no liquidity", not a flaky RPC. Don't retry.
      retry: false,
      refetchInterval: 12_000,
    },
  })
  const amountOut = quote.data?.result?.[0]

  const ethBalance = useBalance({
    address,
    chainId: robinhood.id,
    query: { enabled: side === "buy" && !!address },
  })
  const coinBalance = useReadContract({
    address: coinAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: robinhood.id,
    query: { enabled: side === "sell" && !!address },
  })
  const allowance = useReadContract({
    address: coinAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, UNISWAP.swapRouter02] : undefined,
    chainId: robinhood.id,
    query: { enabled: side === "sell" && !!address },
  })

  const needsApproval = side === "sell" && amountIn > 0n && (allowance.data ?? 0n) < amountIn

  const { writeContract, data: hash, isPending, error: writeError, reset: resetWrite } = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash, chainId: robinhood.id })
  const [step, setStep] = React.useState<"idle" | "approve" | "swap">("idle")

  const swap = React.useCallback(() => {
    if (!address || amountOut === undefined || amountOut === 0n) return
    const minOut = applySlippage(amountOut)

    const calls =
      side === "buy"
        ? [
            encodeFunctionData({
              abi: swapRouter02Abi,
              functionName: "exactInputSingle",
              args: [
                {
                  tokenIn,
                  tokenOut,
                  fee: UNISWAP.feeTier,
                  recipient: address,
                  amountIn,
                  amountOutMinimum: minOut,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            }),
            // MANDATORY, not politeness. A v3 swap only pulls what the range can
            // absorb: quoting 100 WETH into this pool consumes ~6.9 and stops at
            // the tick boundary. The router wraps only what the pool actually
            // takes, so the remainder would sit in the router as loose ETH that
            // *anyone* could sweep with refundETH(). Bundling refundETH() here is
            // what makes the "extra ETH auto-refunds" note true and safe.
            encodeFunctionData({ abi: swapRouter02Abi, functionName: "refundETH" }),
          ]
        : [
            // Sell pays out to the router, then unwraps, so the seller receives
            // native ETH rather than WETH they'd have to unwrap themselves.
            // recipient is the router's literal address rather than SwapRouter02's
            // ADDRESS_THIS sentinel (address(2)) — if this fork's sentinel ever
            // differed, address(2) would be a burn. The literal is always correct.
            encodeFunctionData({
              abi: swapRouter02Abi,
              functionName: "exactInputSingle",
              args: [
                {
                  tokenIn,
                  tokenOut,
                  fee: UNISWAP.feeTier,
                  recipient: UNISWAP.swapRouter02,
                  amountIn,
                  amountOutMinimum: minOut,
                  sqrtPriceLimitX96: 0n,
                },
              ],
            }),
            encodeFunctionData({
              abi: swapRouter02Abi,
              functionName: "unwrapWETH9",
              args: [minOut, address],
            }),
          ]

    setStep("swap")
    writeContract({
      address: UNISWAP.swapRouter02,
      abi: swapRouter02Abi,
      functionName: "multicall",
      args: [calls],
      // Buys send native ETH: the router wraps exactly what the pool consumes via
      // WETH9.deposit() inside its pay() path, so the user never needs a separate
      // wrap tx *or* a WETH approval. Chosen over wrapping manually (deposit →
      // approve → swap = 3 txs, and leaves stray WETH behind on a partial fill).
      value: side === "buy" ? amountIn : 0n,
      chainId: robinhood.id,
    })
  }, [address, amountOut, amountIn, side, tokenIn, tokenOut, writeContract])

  const submit = React.useCallback(() => {
    if (needsApproval) {
      setStep("approve")
      writeContract({
        address: coinAddress,
        abi: erc20Abi,
        functionName: "approve",
        // Exact amount, not max. This router is a chain-4663 deployment verified
        // only by selector probe, and 4663 is full of impostor contracts (see the
        // warning in lib/chain.ts). An unlimited allowance to it is a standing
        // risk; one extra tx per sell is the cheaper trade. The swap auto-chains
        // off the approve receipt, so it's still a single click.
        args: [UNISWAP.swapRouter02, amountIn],
        chainId: robinhood.id,
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

  const balance = side === "buy" ? ethBalance.data?.value : coinBalance.data
  const quoting = quote.isFetching && amountOut === undefined

  let disabledReason: string | undefined
  if (amountIn <= 0n) {
    disabledReason = undefined // nothing typed yet — disabled, but don't scold
  } else if (balance !== undefined && amountIn > balance) {
    disabledReason =
      side === "buy" ? "Not enough ETH in the hold" : `Not enough $${coin.ticker} to abandon`
  } else if (quoting) {
    disabledReason = undefined
  } else if (quote.error) {
    // Live example: every $SMOKE sell quote reverts today — nobody has bought, so
    // the pool holds zero WETH and there is nothing to sell into.
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
