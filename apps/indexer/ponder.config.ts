import { parseAbiItem } from "abitype";
import { createConfig, factory } from "ponder";

import {
  LaunchFactoryAbi,
  LpLockerAbi,
  FeeLockerAbi,
  UniswapV3PoolAbi,
} from "./abis/berth";

// Arc Testnet (5042002). Addresses + deploy block come from @workspace/contracts
// — the SAME module apps/web reads — so the indexer and the frontend can never
// watch different factories. They diverged once (a stale web env vs a newer
// indexer env) and launches landed on a contract nothing indexed. A new
// deployment is a one-line bump in that package, not a per-service env change.
import { CONTRACTS, START_BLOCK, CHAIN } from "@workspace/contracts";

const LAUNCH_FACTORY = CONTRACTS.launchFactory;
const LP_LOCKER = CONTRACTS.lpLocker;
const FEE_LOCKER = CONTRACTS.feeLocker;

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
      id: CHAIN.id,
      // Deliberately NOT ponder's PONDER_RPC_URL_<chainId> convention: that bakes
      // the chain id into the key, so every chain change strands a dead variable
      // (this file previously carried PONDER_RPC_URL_4663). RPC_URL survives a move.
      //
      // Two endpoints, both optional: RPC_URL is the free/public one, RPC_URL_PAID
      // the Alchemy key. Ponder keeps a bucket per hostname and, on a 429 or a
      // timeout, deactivates that endpoint, decays its rps limit, and reactivates
      // it after a backoff -- so the free RPC dying fails over to the paid one
      // with no redeploy. Note it POOLS rather than strictly prioritises: healthy
      // endpoints share traffic by latency, so the paid key sees requests even
      // while the public one is up.
      rpc: [
        process.env.RPC_URL ?? CHAIN.defaultRpc,
        process.env.RPC_URL_PAID,
      ].filter((url): url is string => Boolean(url)),
      // The pool filter is a factory() source, so ponder sends every discovered
      // pool address in one eth_getLogs. Arc's PUBLIC rpc caps that list at ~20
      // addresses (measured: 20 passes, 24 fails) and rejects the request with
      // "requested range too large" -- a message about the ADDRESS count that
      // ponder reads as a BLOCK range problem, so it shrinks the range forever
      // and never recovers.
      //
      // Ponder already has the escape: above `factoryAddressCountThreshold` it
      // drops the address list and queries by topic0 alone, filtering child
      // addresses client-side (sync-historical/index.ts:494). That threshold is
      // hardcoded to 1000 in 0.16.10 AND 0.17.9, so we patch it to read
      // PONDER_FACTORY_ADDRESS_THRESHOLD (patches/ponder@0.16.10.patch) and set
      // it below the pool count. Measured on the public rpc: the topic-only
      // query returns 996 logs for a 5000-block span in 1s, where the
      // 44-address form fails at any span at all.
      // Pin the eth_getLogs span. Ponder auto-tunes this from error messages,
      // but the address-filtered era taught it a tiny range (observed: 50 blocks)
      // and it never recovers -- `estimatedRange` only grows while
      // `confirmedRange` is unset, and once set it is a one-way latch. 50-block
      // spans meant ~17,000 requests for the remaining backfill instead of ~171.
      //
      // Measured on the public RPC, topic-only: 5000 blocks -> 2636 logs in 0.9s,
      // 10000 -> 3874 in 2.0s, 20000 -> 6700 in 2.9s, 50000 -> rejected. 5000
      // leaves a wide margin. NOTE this DISABLES ponder's retry-shrink for
      // getLogs (sync-historical/index.ts:210), so a value the endpoint rejects
      // becomes a hard error rather than a slow recovery -- do not raise it
      // without re-measuring.
      ethGetLogsBlockRange: 5_000,
      // THERE IS NO REQUEST CAP ANY MORE. `maxRequestsPerSecond: 50` used to sit
      // here; in ponder 0.16 that option is @deprecated and does nothing — it
      // typechecked and was ignored (observed: the limiter self-settled to 3
      // rps regardless). The only real lever is keeping the per-block workload
      // small, which is why there is no ERC20 Transfer source below.
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
