import { parseAbiItem } from "abitype";
import { createConfig, factory } from "ponder";

import {
  LaunchFactoryAbi,
  LpLockerAbi,
  FeeLockerAbi,
  LaunchTokenAbi,
  UniswapV3PoolAbi,
} from "./abis/berth";

// Arc Testnet (5042002). Env-driven because the stack has not been deployed to
// Arc yet — deploy with launchpad-contracts/script/Deploy.s.sol, then set these
// alongside START_BLOCK. They must match apps/web/lib/chain.ts CONTRACTS.
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

/** Every launch emits this — carries everything a discovery row needs. */
const tokenLaunchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed creator, uint256 indexed tokenId, address pool, uint256 supply, int24 tickLower, int24 tickUpper, uint16 protocolFeeBps, uint256 devBuyEthIn, string name, string symbol, string metadataURI)",
);

export default createConfig({
  chains: {
    arc: {
      id: 5042002,
      rpc: process.env.PONDER_RPC_URL_5042002 ?? "https://rpc.testnet.arc.network",
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
