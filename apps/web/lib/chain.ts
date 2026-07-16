import { defineChain } from "viem"

/**
 * Robinhood Chain (an Arbitrum L2, chain id 4663) — verified live: our
 * contracts are deployed and wired (factory <-> lockers, factoryLocked, and
 * LpLocker ownership renounced).
 *
 * RPC verified working (all contract reads + the indexer run against it).
 * Explorer matches the one hoodbridge uses (Blockscout).
 */
const RPC_URL =
  process.env.NEXT_PUBLIC_ROBINHOOD_RPC ?? "https://rpc.mainnet.chain.robinhood.com"
const EXPLORER_URL = "https://robinhoodchain.blockscout.com"

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Robinhood Explorer", url: EXPLORER_URL },
  },
  // Multicall3 at the canonical address — verified live on 4663 (aggregate3
  // present; getBlockNumber() returns real data). Declaring it lets wagmi/viem
  // batch reads (e.g. per-coin balanceOf) into one RPC call for free.
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
})

/**
 * Token ordering is NOT guaranteed.
 *
 * The repo source mines a salt so the coin always sorts below WETH9 (coin =
 * token0). The DEPLOYED factory does not do that — it mirrors the tick range
 * when the coin sorts above WETH9 instead. Verified on-chain: $SMOKE's pool has
 * token0 = WETH9, token1 = the coin, and the position sits at ticks
 * [+199400, +268600] while TokenLaunched emitted [-268600, -199400].
 *
 * Consequences, both orderings possible:
 *  - coin is token0  -> price(WETH per coin) = 1.0001^tick,  buyers push tick UP
 *  - coin is token1  -> price(WETH per coin) = 1.0001^-tick, buyers push tick DOWN
 *
 * Never hardcode an ordering. Derive it.
 */
export function coinIsToken0(coin: string): boolean {
  return coin.toLowerCase() < UNISWAP.weth9.toLowerCase()
}

/** WETH per whole coin, correct for either token ordering. */
export function priceWethFromTick(tick: number, coin: string): number {
  return Math.pow(1.0001, coinIsToken0(coin) ? tick : -tick)
}

export const EXPLORER = EXPLORER_URL

export function explorerAddress(address: string): string {
  return `${EXPLORER_URL}/address/${address}`
}

export function explorerTx(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`
}

/** Our deployed launchpad on 4663. Verified on-chain. */
export const CONTRACTS = {
  launchFactory: "0x5DA172F7D4464DDCD43e748E9458DbdBE943c016",
  lpLocker: "0x022A133a1FDD513dC06AD3b8BaD30b454C074b4d",
  feeLocker: "0xC4Cc6784d32a3732fB991D0E5bA5553757B54E1a",
} as const

/**
 * Pinned Uniswap v3 + WETH9 on 4663, from
 * launchpad-contracts/src/libraries/Addresses.sol.
 * Do NOT look these up by name on the explorer — chain 4663 is launchpad-heavy
 * and full of impostors ("PoolManager" returns six verified contracts).
 */
export const UNISWAP = {
  factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  nfpm: "0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3",
  swapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
  quoterV2: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  weth9: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  feeTier: 10_000,
  tickSpacing: 200,
} as const
