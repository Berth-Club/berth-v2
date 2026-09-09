// Uniswap V4 PoolManager — the ONE event this indexer needs from it.
//
// Hand-written rather than generated: `packages/contracts/scripts/gen-abis.mjs`
// pulls OUR contracts from the launchpad repo, and Uniswap's periphery does not
// live there. Kept to a single event so there is nothing to drift.
//
// Shape per the v2 backend guide §6.5. `id` is the pool id (keccak of the
// PoolKey) and is indexed, so it is topic1.
export const PoolManagerAbi = [
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "id", type: "bytes32", indexed: true, internalType: "PoolId" },
      { name: "sender", type: "address", indexed: true, internalType: "address" },
      { name: "amount0", type: "int128", indexed: false, internalType: "int128" },
      { name: "amount1", type: "int128", indexed: false, internalType: "int128" },
      { name: "sqrtPriceX96", type: "uint160", indexed: false, internalType: "uint160" },
      { name: "liquidity", type: "uint128", indexed: false, internalType: "uint128" },
      { name: "tick", type: "int24", indexed: false, internalType: "int24" },
      { name: "fee", type: "uint24", indexed: false, internalType: "uint24" },
    ],
    anonymous: false,
  },
] as const
