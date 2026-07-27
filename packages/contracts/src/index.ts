/**
 * Shared, non-secret config for berth.club on Arc — the single source of truth
 * that BOTH the web app and the indexer import, so nothing here can drift
 * between them (a stale copy of an address or the USDC predeploy has caused real
 * bugs before). Env is reserved for secrets and per-deployment URLs only.
 *
 * Exports: CHAIN (metadata), SYSTEM (fixed on-chain addresses we don't own),
 * CONSTANTS (decimals/tick math), CONTRACTS + START_BLOCK (our v1.4 deployment).
 */

/** Arc testnet chain metadata. RPC endpoint itself is env (carries a key); this
 *  is the public fallback + everything that never changes. */
export const CHAIN = {
  id: 5042002,
  name: "Arc Testnet",
  // NATIVE view — 18 decimals, correct for msg.value / gas / balances.
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  explorerUrl: "https://testnet.arcscan.app",
  defaultRpc: "https://rpc.testnet.arc.network",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
} as const

/** Addresses fixed on Arc that we consume but don't deploy: the USDC predeploy
 *  (quote asset + native gas token) and the Uniswap v3 periphery. */
export const SYSTEM = {
  /** USDC predeploy — 6-decimal ERC20 view; the quote asset of every pool. Same
   *  money as the native balance, two interfaces. Getting this wrong inverts
   *  token ordering and prices — do not copy it, import it. */
  usdc: "0x3600000000000000000000000000000000000000",
  uniswap: {
    factory: "0x065b21b296F56186452B4482f62f56EE7D11a010",
    nfpm: "0x78e21fff6711a81b8b2E02Cef063f7852d2f5fC2",
    swapRouter: "0xB5D2f3Aae27dd5F4682B059A20c47f0a5B831c7f",
    quoterV2: "0xb1A5136826aDE2C39aBA4800442dCc223A2A7604",
    feeTier: 10_000,
    tickSpacing: 200,
  },
} as const satisfies {
  usdc: `0x${string}`
  uniswap: { factory: `0x${string}`; nfpm: `0x${string}`; swapRouter: `0x${string}`; quoterV2: `0x${string}`; feeTier: number; tickSpacing: number }
}

/** Decimal + tick-math constants of the system. */
export const CONSTANTS = {
  /** Native (18dp) units per ERC20 USDC (6dp) unit. */
  nativePerUsdc: 1_000_000_000_000n,
  /** TickMath.MAX_TICK rounded inward to tickSpacing 200. Mirrors the factory. */
  maxUsableTick: 887_200,
  usdcDecimals: 6,
  coinDecimals: 18,
} as const

/** Block the current LaunchFactory was deployed in — the indexer's backfill start. */
export const START_BLOCK = 53500852 as const

/** v1.4 deployment — github.com/Arcane-build/arc-launchpad. */
export const CONTRACTS = {
  launchFactory: "0x82A613C19787D88d648C04F8Ad7Bd6825193e317",
  lpLocker: "0xA592aDF3Cb55741619d09E50E6502f40F3883cc9",
  feeLocker: "0xC3a15f812901205Fc4406Cd0dC08Fe266bF45a1E",
} as const satisfies Record<string, `0x${string}`>
