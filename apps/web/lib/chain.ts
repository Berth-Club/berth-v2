import { defineChain } from "viem"

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
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.testnet.arc.network"
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

/**
 * The launchpad on Arc testnet, deployed from github.com/Arcane-build/arc-launchpad.
 * Verified live: LpLocker ownership renounced to 0x0, factoryLocked, wired both
 * ways, preset 0 = (-444600, 20000e6, enabled).
 *
 * Env-overridable so a redeploy does not need a code change.
 */
const UNDEPLOYED = "0x0000000000000000000000000000000000000000" as const
function addr(v: string | undefined, fallback: string): `0x${string}` {
  return (v && /^0x[0-9a-fA-F]{40}$/.test(v) ? v : fallback) as `0x${string}`
}

export const CONTRACTS = {
  launchFactory: addr(process.env.NEXT_PUBLIC_LAUNCH_FACTORY, "0xb7738F4e07845fAa09b7694E5E882e00e0eE768B"),
  lpLocker: addr(process.env.NEXT_PUBLIC_LP_LOCKER, "0x402f35e11cC6E89E80EFF4205956716aCd94be04"),
  feeLocker: addr(process.env.NEXT_PUBLIC_FEE_LOCKER, "0x3bC8f037691Ce1d28c0bB224BD33563b49F99dE8"),
} as const

export const CONTRACTS_CONFIGURED = CONTRACTS.launchFactory !== UNDEPLOYED

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
