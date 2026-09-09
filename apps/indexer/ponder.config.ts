import { createConfig } from "ponder";

import { LaunchFactoryAbi, LaunchLockerAbi } from "./abis/berth";
import { PoolManagerAbi } from "./abis/pool-manager";

// Arc Testnet (5042002). Addresses + deploy block come from @workspace/contracts
// — the SAME module apps/web reads — so the indexer and the frontend can never
// watch different factories. They diverged once (a stale web env vs a newer
// indexer env) and launches landed on a contract nothing indexed. A new
// deployment is a one-line bump in that package, not a per-service env change.
import { CONTRACTS, START_BLOCK, CHAIN, SYSTEM } from "@workspace/contracts";

export default createConfig({
  chains: {
    arc: {
      id: CHAIN.id,
      // Deliberately NOT ponder's PONDER_RPC_URL_<chainId> convention: that bakes
      // the chain id into the key, so every chain change strands a dead variable.
      // RPC_URL survives a move.
      //
      // Two endpoints, both optional: RPC_URL is the free/public one, RPC_URL_PAID
      // the Alchemy key. Ponder keeps a bucket per hostname and, on a 429 or a
      // timeout, deactivates that endpoint and reactivates it after a backoff —
      // so the free RPC dying fails over to the paid one with no redeploy.
      rpc: [process.env.RPC_URL ?? CHAIN.defaultRpc, process.env.RPC_URL_PAID].filter(
        (url): url is string => Boolean(url),
      ),
      // Pin the eth_getLogs span. Ponder auto-tunes this from error messages, but
      // `confirmedRange` is a one-way latch: once a small value is learned it
      // never grows back. Measured on the public RPC: 5000 blocks is comfortably
      // inside what it accepts. NOTE this DISABLES ponder's retry-shrink, so a
      // value the endpoint rejects is a hard error — do not raise it without
      // re-measuring.
      ethGetLogsBlockRange: 5_000,
    },
  },
  contracts: {
    LaunchFactory: {
      chain: "arc",
      abi: LaunchFactoryAbi,
      address: CONTRACTS.launchFactory,
      startBlock: START_BLOCK,
    },
    LaunchLocker: {
      chain: "arc",
      abi: LaunchLockerAbi,
      address: CONTRACTS.launchLocker,
      startBlock: START_BLOCK,
    },
    /**
     * NOT WATCHED: BerthClubFeeEscrow.
     *
     * Its four events (Credited/CreditedToken/Claimed/ClaimedToken) were four
     * separate log filters — nearly half this indexer's RPC load — to maintain a
     * balance the web app deliberately reads live from the chain anyway
     * (`FeeEscrow.balanceOf`), because that number gates a signature and must
     * not be an indexer block stale. Indexing it bought nothing and cost the
     * most. Add it back only if you need claim HISTORY, which nothing does yet.
     */
    /**
     * Uniswap V4 is a SINGLETON, and this is the reason v2 deleted a whole class
     * of outage from this file.
     *
     * v1.4 watched every pool a launch created through a ponder `factory()`
     * source, which meant sending the entire discovered address list in one
     * eth_getLogs. Arc's public endpoint caps that list at ~20 addresses and
     * reports the overflow as "requested range too large" — a message about the
     * ADDRESS count that ponder reads as a BLOCK range problem, so it shrank the
     * range forever and stalled at a fixed percentage with no error. Working
     * around it needed a patched `factoryAddressCountThreshold`.
     *
     * In V4 there are no pool addresses. Every swap on the chain is emitted by
     * this one contract and identified by `id` (the pool id), so there is one
     * address to watch no matter how many launches exist. The trade-off is that
     * this source sees EVERY pool on Arc, ours or not — the handler drops a Swap
     * whose pool id we have no coin for.
     *
     * If that volume ever becomes the problem, the fix is a poolId filter, not a
     * return to address lists.
     */
    PoolManager: {
      chain: "arc",
      abi: PoolManagerAbi,
      address: SYSTEM.uniswapV4.poolManager,
      startBlock: START_BLOCK,
    },
  },
  blocks: {
    // change24h is a *moving* window, so it has to be recomputed as time passes
    // and not only when a swap fires — otherwise a coin that pumped and then went
    // quiet would keep showing its old number forever.
    // Arc blocks are ~0.5s, so 1200 blocks ≈ 10 minutes.
    Clock: {
      chain: "arc",
      interval: 1_200,
      startBlock: START_BLOCK,
    },
  },
});
