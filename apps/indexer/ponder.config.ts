import { parseAbiItem } from "abitype";
import { createConfig, factory } from "ponder";

import {
  LaunchFactoryAbi,
  LpLockerAbi,
  FeeLockerAbi,
  LaunchTokenAbi,
  UniswapV3PoolAbi,
} from "./abis/berth";

// Arc Testnet (5042002). The launchpad is deployed from
// github.com/Arcane-build/arc-launchpad — that repo is the source of truth for
// ABIs and addresses. These must match apps/web/lib/chain.ts CONTRACTS.
function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. Deploy the launchpad to Arc first, then set ` +
        `LAUNCH_FACTORY, LP_LOCKER, FEE_LOCKER and START_BLOCK.`,
    );
  }
  return v;
}

/** Validates the shape too — a truncated paste would otherwise index nothing, silently. */
function requiredAddress(name: string): `0x${string}` {
  const v = required(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(`${name}="${v}" is not a 20-byte hex address.`);
  }
  return v as `0x${string}`;
}

const LAUNCH_FACTORY = requiredAddress("LAUNCH_FACTORY");
const LP_LOCKER = requiredAddress("LP_LOCKER");
const FEE_LOCKER = requiredAddress("FEE_LOCKER");

/**
 * Block the LaunchFactory was deployed in. NOT optional on Arc: the chain is
 * past 52M blocks at ~0.5s each, so starting from 0 would backfill for days.
 */
const START_BLOCK = Number(required("START_BLOCK"));

/**
 * Every launch emits this — carries everything a discovery row needs.
 *
 * ⚠️ MUST match the deployed event byte for byte. Ponder resolves the factory()
 * patterns below by topic0, which is keccak of the TYPE list — so a single wrong
 * type silently watches nothing. This is the v1.4 shape: `supply` is gone (it is
 * always TOTAL_SUPPLY) and `uint24 fee` sits after initialTick;
 * `graduationThreshold` is **uint128**, not uint256. Any one of those wrong shifts
 * topic0 and the indexer discovers zero pools and zero tokens while still happily
 * recording coins (those come off the full ABI, which is generated). The symptom
 * is a launchpad with coins but no trades and no holders, and no error anywhere.
 *
 * Expected topic0 for the shape below (recompute against the first live log):
 *   0xb999762fcf95cce821130d3e3ea8f1cf0ed56e5dd21c54e2b5379035a20689a4
 */
const tokenLaunchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed creator, uint256 indexed tokenId, address pool, int24 initialTick, uint24 fee, uint256 curveConfigId, uint128 graduationThreshold, uint16 protocolFeeBps, uint256 devBuyNativeIn, string name, string symbol, string metadataURI)",
);

export default createConfig({
  chains: {
    arc: {
      id: 5042002,
      // Deliberately NOT ponder's PONDER_RPC_URL_<chainId> convention: that bakes
      // the chain id into the key, so every chain change strands a dead variable
      // (this file previously carried PONDER_RPC_URL_4663). RPC_URL survives a move.
      rpc: process.env.RPC_URL ?? "https://rpc.testnet.arc.network",
      // Arc's public RPC collapses under ponder's default backfill concurrency
      // -- it timed out at 73s and killed the process with an
      // unhandledRejection. But 15/s was too far the other way: Arc produces
      // ~0.5s blocks, so a factory deployed a day ago is already ~150k blocks
      // back, and 15/s put the initial backfill at a 2.5-hour ETA. 50/s is the
      // compromise that keeps it alive without the wait. A paid endpoint would
      // let this go much higher -- see R11.
      maxRequestsPerSecond: 50,
    },
  },
  contracts: {
    LaunchFactory: {
      chain: "arc",
      abi: LaunchFactoryAbi,
      address: LAUNCH_FACTORY,
      startBlock: START_BLOCK,
    },
    LpLocker: {
      chain: "arc",
      abi: LpLockerAbi,
      address: LP_LOCKER,
      startBlock: START_BLOCK,
    },
    FeeLocker: {
      chain: "arc",
      abi: FeeLockerAbi,
      address: FEE_LOCKER,
      startBlock: START_BLOCK,
    },
    // Factory pattern: every pool a launch creates, discovered from the `pool`
    // param of TokenLaunched. Drives price + graduation progress.
    LaunchPool: {
      chain: "arc",
      abi: UniswapV3PoolAbi,
      address: factory({
        address: LAUNCH_FACTORY,
        event: tokenLaunchedEvent,
        parameter: "pool",
      }),
      startBlock: START_BLOCK,
    },
    // Same factory pattern, on the `token` param: the ERC20 Transfer log of every
    // launched coin. Drives the holder table + coin.holderCount.
    LaunchToken: {
      chain: "arc",
      abi: LaunchTokenAbi,
      address: factory({
        address: LAUNCH_FACTORY,
        event: tokenLaunchedEvent,
        parameter: "token",
      }),
      startBlock: START_BLOCK,
    },
  },
  blocks: {
    // change24h is a *moving* window, so it has to be recomputed as time passes
    // and not only when a swap fires — otherwise a coin that pumped and then went
    // quiet would keep showing its old number forever.
    // Arc blocks are ~0.5s (Robinhood was ~0.1s), so the same wall-clock drift
    // needs a FIFTH of the interval: 1200 blocks ≈ 10 minutes. Leaving this at
    // 6000 would have silently stretched the window to ~50 minutes.
    Clock: {
      chain: "arc",
      interval: 1_200,
      startBlock: START_BLOCK,
    },
  },
});
