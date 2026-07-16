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
})

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
