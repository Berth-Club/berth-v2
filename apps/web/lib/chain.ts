import { defineChain } from "viem"

import { env } from "@/lib/env"

/**
 * Arc Testnet (Circle's L1, chain id 5042002) — verified live: reth/v1.11.3,
 * base fee pinned at the documented 20 Gwei floor, ~0.5s blocks.
 *
 * THE ONE THING TO UNDERSTAND BEFORE READING ANY NUMBER IN THIS APP:
 * Arc has no ether and no wrapped native. USDC *is* the chain's currency,
 * exposed through two interfaces over ONE balance:
 *
 *   Native view   18 decimals   msg.value, balance, call{value:}, the dev buy
 *   ERC20 view     6 decimals   0x3600…0000 — what Uniswap actually swaps
 *
 * Fixed 1e12 ratio, exactly and always: `USDC.balanceOf(x) === x.balance / 1e12`.
 * `1e18` native and `1e6` ERC20 are both one dollar. Verified on a live address:
 * native 13489266029671387940 vs balanceOf 13489266.
 *
 * There is NO wrapping step anywhere. A payable call is already funded in ERC20
 * terms, so the factory approves the router directly. Arc's Uniswap periphery
 * points its WETH9 immutable at a stub that reverts on every call — if you find
 * yourself reaching for IWETH.deposit, the model is wrong.
 */
/**
 * The RPC endpoint, used directly by both server and browser.
 *
 * NOTE: this is NEXT_PUBLIC_, so whatever is set here is inlined into the JS
 * bundle and visible to anyone who opens devtools. That is a deliberate choice
 * — the free public endpoint drops connections often enough to blank the
 * portfolio, and a keyed endpoint is what makes the app usable. Restrict the
 * key by domain at the provider if that exposure ever matters.
 */
const RPC_URL = env.rpcUrl
const EXPLORER_URL = "https://testnet.arcscan.app"

export const arc = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  // The NATIVE view — correct for msg.value, gas and balances, which is all
  // viem/wagmi use this for. The 6-decimal ERC20 view lives in USDC below.
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Arcscan", url: EXPLORER_URL } },
  testnet: true,
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
})

/**
 * USDC as Uniswap sees it: the predeploy, 6 decimals, the quote asset of every
 * launch pool. Same money as the native balance — see the note above.
 */
export const USDC = {
  address: "0x3600000000000000000000000000000000000000",
  decimals: 6,
} as const

/** Native (18dp) units per ERC20 USDC (6dp) unit. */
export const NATIVE_PER_USDC = 1_000_000_000_000n

/** A launch token is always 18 decimals. */
export const COIN_DECIMALS = 18

/**
 * Dollar price of ONE WHOLE COIN, from a coin-space tick.
 *
 * `1.0001^tick` is USDC-6dp-units per token *wei*, so converting to dollars per
 * whole token is `× 1e18 / 1e6` = `× 1e12`. Skip that and every price is off by
 * twelve orders of magnitude — which looks like a plausible small number rather
 * than an obvious bug, so it is pinned by chain.selfcheck.ts.
 */
export function priceUsdFromTick(tick: number): number {
  return Math.pow(1.0001, tick) * 1e12
}

/**
 * Token ordering is NOT guaranteed, and must never be assumed.
 *
 * Uniswap sorts pool tokens by address. USDC sits at 0x3600…0000 — a low
 * address — so a launch token sorts BELOW it only about 21% of the time. Both
 * branches are live; the minority one is not rare enough to ignore.
 *
 *  - coin is token0 -> price = 1.0001^tick,  buyers push the tick UP
 *  - coin is token1 -> price = 1.0001^-tick, buyers push the tick DOWN
 */
export function coinIsToken0(coin: string): boolean {
  return coin.toLowerCase() < USDC.address.toLowerCase()
}

/** Coin-space tick from a raw pool tick, correct for either ordering. */
export function toCoinTick(poolTick: number, isToken0: boolean): number {
  return isToken0 ? poolTick : -poolTick
}

export const EXPLORER = EXPLORER_URL
export const explorerAddress = (a: string) => `${EXPLORER_URL}/address/${a}`
export const explorerTx = (h: string) => `${EXPLORER_URL}/tx/${h}`

/** Dedicated IPFS gateway that renders uploaded coin art. Falls back to the
 *  public one; strip any trailing slash so joins are clean. */
const IPFS_GATEWAY = env.ipfsGateway

/**
 * `ipfs://CID` -> a browser-loadable `https://<gateway>/ipfs/CID`. Returns null
 * for anything that is not an `ipfs://` reference, so a coin with only the
 * DiceBear/https placeholder (or no image) renders the emoji face instead of a
 * broken <img>.
 */
export function ipfsToGateway(uri: string | null | undefined): string | null {
  if (!uri || !uri.startsWith("ipfs://")) return null
  const path = uri.slice("ipfs://".length).replace(/^\/+/, "")
  if (!path) return null
  return `${IPFS_GATEWAY}/ipfs/${path}`
}


/**
 * Launchpad addresses live in @workspace/contracts — the ONE place both the
 * web app and the indexer read, so they can never point at different
 * factories. A web-env override that drifted from the indexer was a real
 * outage; a redeploy is now a bump in that package, not a per-app env change.
 */
import { CONTRACTS } from "@workspace/contracts"
export { CONTRACTS }

// Addresses are code constants now, so the app is always "configured". Kept as
// a stable export for any caller that still gates on it.
export const CONTRACTS_CONFIGURED = true

/**
 * Uniswap v3 on Arc testnet, from arc-launchpad/config/5042002.json and
 * confirmed against the factory's own immutables on-chain.
 *
 * This is a real SwapRouter02: `exactInputSingle` is selector 0x04e45aaf and has
 * NO deadline field. Its unwrapWETH9/refundETH helpers exist but must never be
 * called — Arc has no wrapped native and the periphery's WETH9 is an inert stub.
 * Do NOT look these addresses up by name on the explorer: Arc testnet lists
 * dozens of verified contracts with these exact names.
 */
export const UNISWAP = {
  factory: "0x065b21b296F56186452B4482f62f56EE7D11a010",
  nfpm: "0x78e21fff6711a81b8b2E02Cef063f7852d2f5fC2",
  swapRouter: "0xB5D2f3Aae27dd5F4682B059A20c47f0a5B831c7f",
  // Not in arc-launchpad's config (the contracts never quote on-chain), but the
  // trade panel needs one. Found by checking every explorer hit named "QuoterV2"
  // against `factory()` -- only this one answers with the factory above. The
  // spec notes the "canonical" quoter address has code on Arc but reverts on
  // factory(), so name-matching alone would have picked a dud.
  quoterV2: "0xb1A5136826aDE2C39aBA4800442dCc223A2A7604",
  feeTier: 10_000,
  tickSpacing: 200,
} as const

/** Where a visitor gets testnet USDC. Nothing works without it. */
export const FAUCET_URL = "https://faucet.circle.com"
