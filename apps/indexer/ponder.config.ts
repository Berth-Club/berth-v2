import { parseAbiItem } from "abitype";
import { createConfig, factory } from "ponder";

import {
  LaunchFactoryAbi,
  LpLockerAbi,
  FeeLockerAbi,
  LaunchTokenAbi,
  UniswapV3PoolAbi,
} from "./abis/berth";

// Deployed on Robinhood Chain (4663) — verified on-chain: factory <-> lockers
// wired both ways, factoryLocked = true, LpLocker ownership renounced (0x0).
const LAUNCH_FACTORY = "0x5DA172F7D4464DDCD43e748E9458DbdBE943c016";
const LP_LOCKER = "0x022A133a1FDD513dC06AD3b8BaD30b454C074b4d";
const FEE_LOCKER = "0xC4Cc6784d32a3732fB991D0E5bA5553757B54E1a";

/** Block the LaunchFactory was deployed in (found by binary search). */
const START_BLOCK = 11_105_088;

/** Every launch emits this — carries everything a discovery row needs. */
const tokenLaunchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed creator, uint256 indexed tokenId, address pool, uint256 supply, int24 tickLower, int24 tickUpper, uint16 protocolFeeBps, uint256 devBuyEthIn, string name, string symbol, string metadataURI)",
);

export default createConfig({
  chains: {
    robinhood: {
      id: 4663,
      rpc: process.env.PONDER_RPC_URL_4663 ?? "https://rpc.mainnet.chain.robinhood.com",
    },
  },
  contracts: {
    LaunchFactory: {
      chain: "robinhood",
      abi: LaunchFactoryAbi,
      address: LAUNCH_FACTORY,
      startBlock: START_BLOCK,
    },
    LpLocker: {
      chain: "robinhood",
      abi: LpLockerAbi,
      address: LP_LOCKER,
      startBlock: START_BLOCK,
    },
    FeeLocker: {
      chain: "robinhood",
      abi: FeeLockerAbi,
      address: FEE_LOCKER,
      startBlock: START_BLOCK,
    },
    // Factory pattern: every pool a launch creates, discovered from the `pool`
    // param of TokenLaunched. Drives price + graduation progress.
    LaunchPool: {
      chain: "robinhood",
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
      chain: "robinhood",
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
    // ~0.1s blocks here, so 6000 blocks ≈ 10 minutes of drift at worst.
    Clock: {
      chain: "robinhood",
      interval: 6_000,
      startBlock: START_BLOCK,
    },
  },
});
