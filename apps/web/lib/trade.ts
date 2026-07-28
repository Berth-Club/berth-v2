"use client"

import * as React from "react"
import { encodeFunctionData, erc20Abi, formatUnits, parseSignature, parseUnits } from "viem"
import {
  useReadContract,
  useSignTypedData,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi"

import { CONTRACTS, UNISWAP, USDC, COIN_DECIMALS, arc } from "@/lib/chain"
import { LaunchFactoryAbi } from "@/lib/abis"
import { swapRouterAbi } from "@/lib/router-abi"
import { useWallet } from "@/components/wallet-provider"
import type { Coin } from "@/lib/coin"

/** EIP-2612 reads for building the USDC permit domain + message. */
const permitReadAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const

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
export function useTrade(
  coin: Coin,
  side: Side,
  amount: string,
  slippageBps: bigint = DEFAULT_SLIPPAGE_BPS
): Trade {
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

  // The coin's REAL pool fee tier. Since v1.7 a launch pools at its preset's tier
  // (1% / 0.3% / 0.05%), frozen as feeTierOf(token). Quoting or swapping at the
  // hardcoded 1% would hit an empty pool for a non-default coin. Default to 1%
  // while the read is in flight or for a token this factory didn't launch.
  const feeRead = useReadContract({
    address: CONTRACTS.launchFactory,
    abi: LaunchFactoryAbi,
    functionName: "feeTierOf",
    args: [coinAddress],
    chainId: arc.id,
  })
  const feeTier = feeRead.data && Number(feeRead.data) > 0 ? Number(feeRead.data) : UNISWAP.feeTier

  // chainId is pinned so quotes still work before connect and while the wallet
  // sits on the wrong network — the user sees real numbers before committing.
  const quote = useSimulateContract({
    address: UNISWAP.quoterV2,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee: feeTier, sqrtPriceLimitX96: 0n }],
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
  // Sells spend the coin (no permit), so they still approve first. Buys spend
  // USDC, which supports EIP-2612 — a buy signs a permit and swaps in ONE tx
  // (permit + swap via the router's multicall), so it needs no allowance read.
  const allowance = useReadContract({
    address: coinAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, UNISWAP.swapRouter] : undefined,
    chainId: arc.id,
    query: { enabled: !!address && side === "sell" },
  })
  const needsApproval = side === "sell" && amountIn > 0n && (allowance.data ?? 0n) < amountIn

  // USDC permit domain + the owner's live nonce, for the 1-tx buy. Name/version
  // are read (not hardcoded) so a domain mismatch can't silently sign an invalid
  // permit; both fall back to the known Arc values while loading.
  const usdcName = useReadContract({ address: USDC.address, abi: permitReadAbi, functionName: "name", chainId: arc.id })
  const usdcVersion = useReadContract({ address: USDC.address, abi: permitReadAbi, functionName: "version", chainId: arc.id })
  const usdcNonce = useReadContract({
    address: USDC.address,
    abi: permitReadAbi,
    functionName: "nonces",
    args: address ? [address] : undefined,
    chainId: arc.id,
    query: { enabled: !!address && side === "buy" },
  })

  const { signTypedDataAsync } = useSignTypedData()
  const [signing, setSigning] = React.useState(false)
  const [signErr, setSignErr] = React.useState<string>()

  const { writeContract, data: hash, isPending, error: writeError, reset: resetWrite } = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash, chainId: arc.id })
  const [step, setStep] = React.useState<"idle" | "approve" | "swap">("idle")
  // The hash of the approve tx, remembered across the approve->swap hand-off.
  //
  // A buy is two transactions now (approve, then swap), and `hash` is shared by
  // both. When the approve confirms we flip `step` to "swap" and fire the swap,
  // but for one render `step` is already "swap" while `hash`/`receipt` still
  // refer to the just-succeeded approve. Without this guard, `success` flashed
  // true against the approve receipt: the UI celebrated a completed trade,
  // linked to the approve tx, and cleared the form before the swap ever ran.
  const approveHash = React.useRef<`0x${string}` | undefined>(undefined)
  React.useEffect(() => {
    if (step === "approve" && hash) approveHash.current = hash
  }, [step, hash])

  // A plain swap — used by the SELL path after its approve confirms. `value` is
  // 0: on Arc the quote asset is an ordinary ERC20 that also happens to be the
  // gas token, so a swap is just a swap, never payable.
  const swap = React.useCallback(() => {
    if (!address || amountOut === undefined || amountOut === 0n) return
    setStep("swap")
    writeContract({
      address: UNISWAP.swapRouter,
      abi: swapRouterAbi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn,
          tokenOut,
          fee: feeTier,
          recipient: address,
          amountIn,
          amountOutMinimum: applySlippage(amountOut, slippageBps),
          sqrtPriceLimitX96: 0n,
        },
      ],
      chainId: arc.id,
    })
  }, [address, amountOut, amountIn, tokenIn, tokenOut, feeTier, slippageBps, writeContract])

  // The BUY path: sign a USDC permit off-chain, then send permit + swap together
  // via the router's multicall — one on-chain transaction, no separate approve.
  const buyWithPermit = React.useCallback(async () => {
    if (!address || amountOut === undefined || amountOut === 0n) return
    setSignErr(undefined)
    setSigning(true)
    try {
      // Fresh nonce at sign time — a stale one makes the permit unusable.
      const nres = await usdcNonce.refetch()
      const nonce = nres.data
      if (nonce === undefined) throw new Error("Couldn't read the USDC nonce.")
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60)
      const signature = await signTypedDataAsync({
        domain: {
          name: usdcName.data ?? "USDC",
          version: usdcVersion.data ?? "2",
          chainId: arc.id,
          verifyingContract: USDC.address,
        },
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        // spender = the router (selfPermit calls permit(msg.sender, this, …)).
        message: { owner: address, spender: UNISWAP.swapRouter, value: amountIn, nonce, deadline },
      })
      const parsed = parseSignature(signature)
      const v = Number(parsed.v ?? BigInt(27 + (parsed.yParity ?? 0)))
      const permitCall = encodeFunctionData({
        abi: swapRouterAbi,
        functionName: "selfPermit",
        args: [USDC.address, amountIn, deadline, v, parsed.r, parsed.s],
      })
      const swapCall = encodeFunctionData({
        abi: swapRouterAbi,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn,
            tokenOut,
            fee: feeTier,
            recipient: address,
            amountIn,
            amountOutMinimum: applySlippage(amountOut, slippageBps),
            sqrtPriceLimitX96: 0n,
          },
        ],
      })
      setStep("swap")
      writeContract({
        address: UNISWAP.swapRouter,
        abi: swapRouterAbi,
        functionName: "multicall",
        args: [[permitCall, swapCall]],
        chainId: arc.id,
      })
    } catch (e) {
      setSignErr(shortError(e instanceof Error ? e.message : String(e)))
    } finally {
      setSigning(false)
    }
  }, [
    address,
    amountOut,
    amountIn,
    tokenIn,
    tokenOut,
    feeTier,
    slippageBps,
    usdcNonce,
    usdcName.data,
    usdcVersion.data,
    signTypedDataAsync,
    writeContract,
  ])

  const submit = React.useCallback(() => {
    if (side === "buy") {
      void buyWithPermit()
      return
    }
    // Sell: approve the coin (exact amount, not max — this is over the user's
    // real position, and Arc testnet is full of lookalike contracts), then the
    // swap auto-chains off the approve receipt so it stays one click.
    if (needsApproval) {
      setStep("approve")
      approveHash.current = undefined
      writeContract({
        address: coinAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [UNISWAP.swapRouter, amountIn],
        chainId: arc.id,
      })
      return
    }
    swap()
  }, [side, buyWithPermit, needsApproval, writeContract, coinAddress, amountIn, swap])

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

  const busy = isPending || receipt.isLoading || signing

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
    // Only a swap receipt counts: during the approve->swap hand-off `hash`
    // still points at the approve, so its lingering success must not register.
    success: step === "swap" && receipt.isSuccess && hash !== approveHash.current,
    error: signErr ?? (writeError ? shortError(writeError.message) : undefined),
    reset: () => {
      setStep("idle")
      setSigning(false)
      setSignErr(undefined)
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
