/**
 * Shared, non-secret config for berth.club on Arc — the single source of truth
 * that BOTH the web app and the indexer import, so nothing here can drift
 * between them (a stale copy of an address or the USDC predeploy has caused real
 * bugs before). Env is reserved for secrets and per-deployment URLs only.
 *
 * Exports: CHAIN (metadata), SYSTEM (fixed on-chain addresses we don't own),
 * CONSTANTS (decimals/economics), CONTRACTS + START_BLOCK (our v2 deployment).
 *
 * v2 — github.com/Berth-Club/launchpad-contracts-v2, deployments/5042002.json.
 * This is a different system from v1.4, not a redeploy of it: Uniswap V4
 * instead of V3, a phantom-reserve position instead of a bonding curve, and
 * NO GRADUATION — the pool that exists in second one is the pool the token
 * lives in forever.
 */

/** Arc testnet chain metadata. RPC endpoint itself is env (carries a key); this
 *  is the public fallback + everything that never changes. */
export const CHAIN = {
  id: 5042002,
  name: "Arc Testnet",
  // NATIVE view — 18 decimals, correct for msg.value / gas / balances.
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  explorerUrl: "https://testnet.arcscan.app",
  defaultRpc: "https://rpc.testnet.arc.network",
  /** Public endpoints viem falls back to when the primary errors or times out.
   *  Both answer chain id 5042002 and send `Access-Control-Allow-Origin: *`,
   *  so they work from the browser. Ordered by preference. */
  fallbackRpcs: ["https://arc-testnet.drpc.org", "https://5042002.rpc.thirdweb.com"],
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
} as const

/** Addresses fixed on Arc that we consume but don't deploy: the USDC predeploy
 *  and the Uniswap V4 singleton. */
export const SYSTEM = {
  /**
   * USDC predeploy — the 6-decimal ERC20 FACE of the native balance.
   *
   * v2 refuses this address anywhere an asset can be named (quote asset,
   * market, pricing anchor, route hop) and reverts with `NativeAliasNotAllowed`:
   * a launch quoted in it would be a second order book over the same balances,
   * priced 1e12 away from the first. Native is `address(0)` / `msg.value` at 18
   * decimals. Keep using this ONLY for `balanceOf` reads of the ERC20 face.
   */
  usdc: "0x3600000000000000000000000000000000000000",
  /** The native asset as v2 names it. Not a token — `address(0)`, 18 decimals. */
  native: "0x0000000000000000000000000000000000000000",
  /** Uniswap V4. Pools are a PoolKey/poolId pair, never an address. */
  uniswapV4: {
    poolManager: "0x6d0d1461D20054326b1697EA21ccdA774aFf7156",
    positionManager: "0xE2c1A1342E10688A8D682ea94095fB6a899baFc1",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    /** Launch pools are hookless with tick spacing 10; the LP fee is dynamic
     *  per launch — `(baseFeeBps + creatorTaxBps) * 100` pips. */
    hooks: "0x0000000000000000000000000000000000000000",
    tickSpacing: 10,
  },
} as const satisfies {
  usdc: `0x${string}`
  native: `0x${string}`
  uniswapV4: {
    poolManager: `0x${string}`
    positionManager: `0x${string}`
    permit2: `0x${string}`
    hooks: `0x${string}`
    tickSpacing: number
  }
}

/** Decimal + economic constants of the system. */
export const CONSTANTS = {
  /** Native (18dp) units per ERC20 USDC (6dp) unit. */
  nativePerUsdc: 1_000_000_000_000n,
  /** ERC20-face decimals. NEVER format a native amount with this — the v2 docs
   *  call `formatUnits(nativeAmount, 6)` the single most likely integration bug;
   *  it overstates by 1e12. Native amounts are 18dp. */
  usdcDecimals: 6,
  /** Native + launched-token decimals. */
  nativeDecimals: 18,
  coinDecimals: 18,
  /** Every launch mints exactly this, and the token has no mint function. */
  supplyTokens: 1_000_000_000,
  /** LAUNCH_SUPPLY, in wei. */
  supplyWei: 1_000_000_000_000_000_000_000_000_000n,
  /**
   * The quote the curve behaves as if the pool already held, in NATIVE wei.
   * `openingPrice = phantomQuote / supply`, so `openingFDV = phantomQuote` —
   * every launch opens at a 5,000 USDC fully-diluted valuation.
   */
  phantomQuoteNative: 5_000_000_000_000_000_000_000n,
  /** LAUNCH_FEE, native wei. 0.1 USDC. */
  launchFeeNative: 100_000_000_000_000_000n,
  /** Splitter's cut to the buyback wallet; the rest goes to treasury. */
  buybackBps: 6000,
} as const

/** Block BerthClubFeeEscrow (the first v2 contract) was deployed in — the
 *  indexer's backfill start. */
export const START_BLOCK = 61245603 as const

/**
 * v2 deployment on 5042002.
 *
 * The two stacks are exclusive: a token belongs to `launchFactory` (one pool)
 * OR `multiLaunchFactory` (up to five pools, one per quote asset), never both.
 *
 * `holderVault` and `burnVault` are not just plumbing — they are the two
 * non-default values of a launch's `creatorFeeRecipient`, i.e. the "to holders"
 * and "buyback & burn" choices on the launch form, and the labels the app reads
 * an existing launch's fee mode back out of.
 */
export const CONTRACTS = {
  // single-market stack
  launchFactory: "0xe9CaE120d765E773fFa07550b42aC2A8E0cdB22E",
  launchLocker: "0xF54AeB7EcE61b7ddDB2680F5C682e91D36Db3029",
  launchDeployer: "0x8a9E18d824546F628AB38eD22dbFC2c02807Ae60",
  positionMinter: "0xDbbF07799953207D8E1aE2AfEeE6f61A06aBb733",
  router: "0xb7F2fe66b9796d3100bc08a9b9d36CCAa03783df",
  referenceRegistry: "0x30129240EF04bCE14C8ba8BB9436C95c20d64879",

  // multi-market stack
  multiLaunchFactory: "0xb1aB15CFF490187ee3EcFC7BaB207b53AF01c4E3",
  multiLaunchLocker: "0x371fce159F2aD5732aEC3fBc2a7c7Cb64845Ea7f",
  multiLaunchDeployer: "0x19f691F8bEF0afBc9DA02E8ee67f8e15f2a7c878",
  multiPositionMinter: "0x2E7aA851B77851CF848235010c267E0e480214D1",
  multiRouter: "0xBDEA4b48da563912237F5101909E612d0C7646Bd",
  multiReferenceRegistry: "0xE7ab3ec6E0A57411957d5D64995Add298F0eD069",

  // shared
  feeEscrow: "0xa3f8F9c5Fe873183Bd118c752AeFd61642Da656e",
  quotePricer: "0x533A1A9203333bf3e63E53b7c5e9F3603583e528",

  // fee routing — no owners, nothing configurable
  feeSplitter: "0x6aAda3fc879086ebF3C523aC458156cD519b38E6",
  holderVault: "0x01936EdC4c0067d79272126D3AB0cc78E654DAEC",
  burnVault: "0x72c22032a43A6E41b812B55020fFd9Ef6BAF8f37",
  disperseV2: "0x6F587068755dc9793793234A3C5528c31E8c4C06",
} as const satisfies Record<string, `0x${string}`>

/** Wallets the deployment nominates. Display/labelling only — the app never
 *  writes to them. */
export const WALLETS = {
  protocolFeeRecipient: "0x5830323De0E4424ECC54746808F6b3e27e74C2f8",
  treasury: "0x20269CB2985C0B62308A9963Fd15719b205890D6",
  buyback: "0xA78376C8deB924931924271F8ef00CbC0E56DA8F",
  distributor: "0x0dF97157e29DE5fdf32670003D04BfB147e83518",
} as const satisfies Record<string, `0x${string}`>

/** The three values `creatorFeeRecipient` can take, and what each one means.
 *  The choice is permanent for the two vault modes. */
export const FEE_MODES = {
  keep: null,
  holders: CONTRACTS.holderVault,
  burn: CONTRACTS.burnVault,
} as const

/* ────────────────────────────── harbormaster ─────────────────────────────── */

/**
 * The epoch clock, shared by the agent and the vault.
 *
 * `epoch = floor((now - HM_GENESIS) / HM_EPOCH_SECONDS)`. The vault derives the
 * same index from `block.timestamp`, so both sides MUST read these two numbers
 * from here. A worker that computed weeks differently from the contract would
 * post a root for an epoch the vault thinks is still open, and the revert would
 * be the first anyone heard of it.
 *
 * Genesis is a Monday 00:00:00 UTC so epoch boundaries land on Monday midnight.
 */
export const HM_GENESIS = 1_767_571_200 as const // 2026-01-05T00:00:00Z, a Monday
export const HM_EPOCH_SECONDS = 604_800 as const // 7 days

/**
 * Wallets excluded from earning on berth's own coin.
 *
 * The vault exists to pay people other than the people who built the thing, so
 * the agent scores these zero with the reason stated on the line. Addresses have
 * one home, and this is it — never an env var, or the web app and the agent
 * could disagree about who counts as the team.
 */
// Annotated rather than `as const`: an empty `as const` array types as the
// empty tuple, so every consumer that iterates it gets `never` and fails to
// compile until the first address is added. The annotation keeps the list
// usable while it is still empty.
export const TEAM_WALLETS: readonly `0x${string}`[] = []
