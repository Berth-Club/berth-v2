// Event ABIs for the berth.club launchpad on Robinhood Chain (4663).
//
// NOTE: these are the *event* ABIs, verified against real on-chain logs — the
// deployed LaunchFactory's runtime differs from the repo source (it is missing
// MAX_PROTOCOL_FEE_BPS()), so do not assume the function ABI matches. Events do.

export const LaunchFactoryAbi = [
  {
    type: "event",
    name: "TokenLaunched",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "pool", type: "address", indexed: false },
      { name: "supply", type: "uint256", indexed: false },
      { name: "tickLower", type: "int24", indexed: false },
      { name: "tickUpper", type: "int24", indexed: false },
      { name: "protocolFeeBps", type: "uint16", indexed: false },
      { name: "devBuyEthIn", type: "uint256", indexed: false },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DevBuyRefunded",
    inputs: [
      { name: "creator", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const

export const LpLockerAbi = [
  {
    type: "event",
    name: "PositionRegistered",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      {
        name: "recipients",
        type: "tuple[]",
        indexed: false,
        components: [
          { name: "addr", type: "address" },
          { name: "bps", type: "uint16" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "FeesCollected",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "token0", type: "address", indexed: false },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "token1", type: "address", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeesAllocated",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const

export const FeeLockerAbi = [
  {
    type: "event",
    name: "FeesDeposited",
    inputs: [
      { name: "feeOwner", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "depositor", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeesClaimed",
    inputs: [
      { name: "feeOwner", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "caller", type: "address", indexed: false },
    ],
  },
] as const

/** Uniswap v3 pool — only what we index. */
export const UniswapV3PoolAbi = [
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount0", type: "int256", indexed: false },
      { name: "amount1", type: "int256", indexed: false },
      { name: "sqrtPriceX96", type: "uint160", indexed: false },
      { name: "liquidity", type: "uint128", indexed: false },
      { name: "tick", type: "int24", indexed: false },
    ],
  },
] as const
