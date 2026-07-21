import { defineChain } from "viem"

/**
 * Arc Testnet (Circle's L1, chain id 5042002) — verified live against
 * https://rpc.testnet.arc.network: reth/v1.11.3, base fee pinned at the
 * documented 20 Gwei floor, ~0.5s blocks.
 *
 * The defining property: Arc's native gas token IS USDC. It occupies ETH's
 * slot at 18 decimals, so `msg.value`, `balance` and gas all behave exactly
 * like ETH elsewhere — which is why the contracts ported with no economic
 * changes at all.
 *
 * The catch, and it is a real one: the USDC predeploy at 0x3600…0000 exposes
 * the SAME balance as a 6-decimal ERC20. One balance, two views. Verified on a
 * live address: native 13489266029671387940 vs balanceOf 13489266 — the
 * trailing 0.000000029671387940 is truncated away. Never mix the two views,
 * and never treat `balanceOf(x) === 0n` as "x is empty".
 *
 * We only ever touch the 18-decimal native view and the 18-decimal WUSDC
 * wrapper, so the 6-decimal view does not appear anywhere in this app.
 */
const RPC_URL = process.env.NEXT_PUBLIC_ARC_RPC ?? "https://rpc.testnet.arc.network"
const EXPLORER_URL = "https://testnet.arcscan.app"

export const arc = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  // 18 decimals is the NATIVE view. Correct for msg.value, gas and balances —
  // which is all viem/wagmi use this for.
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Arcscan", url: EXPLORER_URL },
  },
  testnet: true,
  // Multicall3 at the canonical address — verified live on Arc (3808 bytes of
  // code). Declaring it lets wagmi/viem batch reads into one RPC call for free.
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
})

/**
 * Token ordering is NOT guaranteed.
 *
 * The repo source mines a salt so the coin always sorts below the quote asset
 * (coin = token0). The DEPLOYED factory does not do that — it mirrors the tick
 * range when the coin sorts above instead.
 *
 * On Arc this matters MORE than it did on Robinhood. Robinhood's WETH9 was a
 * very low address (0x0Bd7…), so a coin sorted below it only ~4.6% of the time
 * and token0 was the overwhelming default. Arc's WUSDC is mid-range (0x911b…),
 * so coins sort either side roughly half the time. The minority branch is no
 * longer the minority.
 *
 * Consequences, both orderings possible:
 *  - coin is token0  -> price(quote per coin) = 1.0001^tick,  buyers push tick UP
 *  - coin is token1  -> price(quote per coin) = 1.0001^-tick, buyers push tick DOWN
 *
 * Never hardcode an ordering. Derive it.
 */
export function coinIsToken0(coin: string): boolean {
  return coin.toLowerCase() < UNISWAP.wrappedNative.toLowerCase()
}

/** Wrapped-native (= USDC) per whole coin, correct for either token ordering. */
export function priceNativeFromTick(tick: number, coin: string): number {
  return Math.pow(1.0001, coinIsToken0(coin) ? tick : -tick)
}

export const EXPLORER = EXPLORER_URL

export function explorerAddress(address: string): string {
  return `${EXPLORER_URL}/address/${address}`
}

export function explorerTx(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`
}

/**
 * Our launchpad on Arc. Env-driven because these do not exist yet — the stack
 * has to be deployed to Arc before the app can read anything. Deploy with
 * launchpad-contracts/script/Deploy.s.sol, then set these.
 */
/**
 * The zero address stands in for "not deployed yet". It keeps the type a real
 * `0x${string}` for viem/wagmi instead of leaking `string` into every call site,
 * and any read against it returns empty rather than throwing — which is exactly
 * what {CONTRACTS_CONFIGURED} is for checking first.
 */
const UNDEPLOYED = "0x0000000000000000000000000000000000000000" as const

function addr(value: string | undefined): `0x${string}` {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as `0x${string}`) : UNDEPLOYED
}

export const CONTRACTS = {
  launchFactory: addr(process.env.NEXT_PUBLIC_LAUNCH_FACTORY),
  lpLocker: addr(process.env.NEXT_PUBLIC_LP_LOCKER),
  feeLocker: addr(process.env.NEXT_PUBLIC_FEE_LOCKER),
} as const

/** True once the launchpad has actually been deployed to Arc and wired up. */
export const CONTRACTS_CONFIGURED = CONTRACTS.launchFactory !== UNDEPLOYED

/**
 * The Uniswap v3 stack on Arc, mirroring
 * launchpad-contracts/src/libraries/Addresses.sol. Keep the two in lockstep.
 *
 * This is UnitFlow Finance, a third-party v3 fork — Arc has no canonical
 * Uniswap deployment. Do NOT look these up by name on the explorer: Arc is a
 * public testnet where anyone deploys, and a search for
 * "NonfungiblePositionManager" returns 31 unrelated contracts.
 */
export const UNISWAP = {
  factory: "0xAb6A8AAb7d490007634ef59d424b5d89688a1971",
  nfpm: "0x77c39eB310BE31e60068CE29855F83359bf85fc4",
  // v1 SwapRouter — its exactInputSingle TAKES a deadline, unlike the
  // SwapRouter02 used on Robinhood.
  swapRouter: "0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01",
  quoterV2: "0x121aeB6DEf00F6F67665008CaC1C19805886ed1a",
  /** WUSDC — wrapped native USDC, 18 decimals. The quote asset of every pool. */
  wrappedNative: "0x911b4000D3422F482F4062a913885f7b035382Df",
  feeTier: 10_000,
  tickSpacing: 200,
} as const

/** Where a visitor gets testnet USDC. Nothing works without it. */
export const FAUCET_URL = "https://faucet.circle.com"
