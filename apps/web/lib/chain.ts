import { defineChain } from "viem"

// Relative + .ts (not "@/lib/env"): chain.ts is imported by chain.selfcheck.ts,
// which runs on raw node — node can't resolve the "@/" alias and needs the
// explicit extension.
import { env } from "./env.ts"

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
const EXPLORER_URL = CHAIN.explorerUrl

export const arc = defineChain({
  id: CHAIN.id,
  name: CHAIN.name,
  // The NATIVE view — correct for msg.value, gas and balances, which is all
  // viem/wagmi use this for. The 6-decimal ERC20 view lives in USDC below.
  nativeCurrency: CHAIN.nativeCurrency,
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Arcscan", url: EXPLORER_URL } },
  testnet: true,
  contracts: {
    multicall3: { address: CHAIN.multicall3 },
  },
})

/**
 * USDC as Uniswap sees it: the predeploy, 6 decimals, the quote asset of every
 * launch pool. Same money as the native balance — see the note above.
 */
export const USDC = {
  address: SYSTEM.usdc,
  decimals: CONSTANTS.usdcDecimals,
} as const

/** Native (18dp) units per ERC20 USDC (6dp) unit. */
export const NATIVE_PER_USDC = CONSTANTS.nativePerUsdc

/** A launch token is always 18 decimals. */
export const COIN_DECIMALS = CONSTANTS.coinDecimals

/**
 * Dollar price of ONE WHOLE COIN, from a coin-space tick.
 *
 * NO decimal adjustment, and that is the v2 change worth remembering. v1.4
 * pooled an 18dp coin against the SIX-decimal USDC face, so `1.0001^tick` was
 * USDC-6dp-units per token wei and needed `× 1e18 / 1e6` = `× 1e12`. v2 pools
 * against NATIVE USDC, which is 18dp — the same as the coin — so the tick price
 * is already whole-USDC per whole-coin.
 *
 * Leaving the 1e12 in reported a 5,000 USDC launch as a $5,001.4 TRILLION market
 * cap. Pinned by chain.selfcheck.ts.
 */
export function priceUsdFromTick(tick: number): number {
  return Math.pow(1.0001, tick)
}

/**
 * Currency ordering for a NATIVE-quoted v2 pool.
 *
 * Native USDC is `address(0)`, which sorts below every possible token, so the
 * coin is always currency1 and this is always false. It stays a function, and
 * the coin row still carries its own `coinIsToken0`, because an ERC-20-quoted
 * launch can go either way — prefer the stored column over calling this.
 *
 *  - coin is currency0 -> price = 1.0001^tick,  buyers push the tick UP
 *  - coin is currency1 -> price = 1.0001^-tick, buyers push the tick DOWN
 */
export function coinIsToken0(_coin: string): boolean {
  return false
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
 * `ipfs://CID` -> our own cached image proxy (`/api/img?cid=CID`) for in-app
 * display. The proxy fetches from the gateway ONCE and caches the bytes, so the
 * slow public-gateway latency is paid once per coin instead of on every render.
 * Use this for <img> in the app; `ipfsToGateway` stays for absolute URLs that
 * leave the app (OpenGraph/Twitter cards a crawler fetches).
 */
export function ipfsToProxy(uri: string | null | undefined): string | null {
  if (!uri || !uri.startsWith("ipfs://")) return null
  const path = uri.slice("ipfs://".length).replace(/^\/+/, "")
  if (!path) return null
  return `/api/img?cid=${encodeURIComponent(path)}`
}

/**
 * The <img src> for a stored profile image, branching on scheme: `ipfs://`
 * (legacy avatars + coin CIDs) goes through the cached proxy; an https url (an
 * R2 avatar) is used directly; anything else is null (falls back to the glyph).
 * Write-validation (isStorableImage) already restricts stored https urls to the
 * R2 host, and a plain <img src> can't execute script, so direct use is safe.
 */
export function avatarSrc(image: string | null | undefined): string | null {
  if (!image) return null
  if (image.startsWith("ipfs://")) return ipfsToProxy(image)
  if (image.startsWith("https://")) return image
  return null
}


/**
 * Launchpad addresses live in @workspace/contracts — the ONE place both the
 * web app and the indexer read, so they can never point at different
 * factories. A web-env override that drifted from the indexer was a real
 * outage; a redeploy is now a bump in that package, not a per-app env change.
 */
import { CHAIN, SYSTEM, CONSTANTS, CONTRACTS } from "@workspace/contracts"
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
export const UNISWAP_V4 = SYSTEM.uniswapV4

/** Where a visitor gets testnet USDC. Nothing works without it. */
export const FAUCET_URL = "https://faucet.circle.com"
