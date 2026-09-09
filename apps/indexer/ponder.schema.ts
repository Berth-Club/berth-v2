import { onchainTable, index, relations } from "ponder";

/**
 * A launched coin on contracts v2.
 *
 * `TokenLaunched` no longer carries identity — it is
 * `(token, poolId, deployer, pairToken, launchConfigId, poolFee)` and nothing
 * else. Name, symbol, logo, description and socials are read off the TOKEN
 * (immutable, set at launch); the economics come from
 * `factory.getLaunchedToken`; the position's range and liquidity arrive in the
 * same transaction on `LaunchPositionMinted`.
 *
 * There is no graduation column set here because v2 has no graduation: the
 * position IS the curve, it never migrates, and there is no threshold to cross.
 */
export const coin = onchainTable(
  "coin",
  (t) => ({
    address: t.hex().primaryKey(),
    /** `deployer` on the event — who signed the launch. */
    creator: t.hex().notNull(),
    /** keccak of the PoolKey. V4 pools have no address. */
    poolId: t.hex().notNull(),
    /** Quote asset. `0x0` = native USDC, which is the common case. */
    pairToken: t.hex().notNull(),
    /** Where the creator's fee share goes — the holder vault and the burn vault
     *  are the two non-default values. Mutable through a 3-day timelock, so it
     *  is maintained from CreatorFeeRecipientUpdated, not frozen at launch. */
    creatorFeeRecipient: t.hex().notNull(),
    /** LP fee in pips = (baseFeeBps + creatorTaxBps) * 100. */
    poolFee: t.integer().notNull(),
    /** All three frozen at launch; they drive the fee split. */
    baseFeeBps: t.integer().notNull().default(0),
    creatorTaxBps: t.integer().notNull().default(0),
    protocolFeeShareBps: t.integer().notNull().default(0),
    /** Opening reserve in the quote's own decimals. Opening FDV == this. */
    phantomQuote: t.bigint().notNull().default(0n),
    supply: t.bigint().notNull(),

    // --- the locked position, from LaunchPositionMinted ---
    positionId: t.bigint().notNull().default(0n),
    tickLower: t.integer().notNull().default(0),
    tickUpper: t.integer().notNull().default(0),
    liquidity: t.bigint().notNull().default(0n),
    /**
     * Uniswap currency ordering. Native USDC is `address(0)`, so on a
     * native-quoted pool it always sorts first and the coin is currency1 —
     * i.e. this is false for the common case. Stored rather than assumed so an
     * ERC-20-quoted launch doesn't silently invert every price.
     */
    coinIsToken0: t.boolean().notNull().default(false),

    // --- identity, read off the token contract ---
    name: t.text().notNull(),
    symbol: t.text().notNull(),
    /** ipfs:// URI, or "" when the creator launched without art. */
    logo: t.text().notNull().default(""),
    description: t.text().notNull().default(""),
    twitter: t.text().notNull().default(""),
    telegram: t.text().notNull().default(""),
    discord: t.text().notNull().default(""),
    website: t.text().notNull().default(""),
    farcaster: t.text().notNull().default(""),

    createdAt: t.bigint().notNull(),
    createdBlock: t.bigint().notNull(),

    // --- market state, maintained from PoolManager Swap events ---
    /**
     * Latest tick in COIN SPACE (negated when the coin is currency1), so
     * `1.0001^tick` is always quote-per-whole-coin regardless of ordering.
     * NOT the raw pool tick — use poolTick for that.
     */
    tick: t.integer(),
    poolTick: t.integer(),
    sqrtPriceX96: t.bigint(),
    /** Cumulative quote-side volume, wei. */
    volumeNative: t.bigint().notNull().default(0n),
    swapCount: t.integer().notNull().default(0),
    lastTradeAt: t.bigint(),
    /**
     * Price change over the last 24h, percent. NULLABLE on purpose: null means
     * "no trade older than 24h to compare against", which the UI must render as
     * nothing rather than a fake 0.
     */
    change24h: t.real(),
  }),
  (t) => ({
    creatorIdx: index().on(t.creator),
    poolIdIdx: index().on(t.poolId),
    createdIdx: index().on(t.createdAt),
    createdBlockIdx: index().on(t.createdBlock),
    recipientIdx: index().on(t.creatorFeeRecipient),
  }),
);

/** Every swap on a launched pool. Drives charts + the activity ticker. */
export const swap = onchainTable(
  "swap",
  (t) => ({
    id: t.text().primaryKey(), // `${txHash}-${logIndex}`
    coin: t.hex().notNull(),
    /**
     * The address that called `swap` on the PoolManager. For a trade through
     * BerthClubRouter that is the ROUTER, not the trader — v2 exposes the user
     * only via the router's own Zap events or the tx `from`.
     */
    sender: t.hex().notNull(),
    /** true = someone bought the coin (quote in). */
    isBuy: t.boolean().notNull(),
    /** Absolute amounts, wei. */
    amountToken: t.bigint().notNull(),
    amountNative: t.bigint().notNull(),
    /** LP fee paid, in the INPUT currency: amountIn * fee / 1e6. */
    feePaid: t.bigint().notNull().default(0n),
    /** COIN-SPACE tick after the swap — see coin.tick. Drives the 24h change. */
    tick: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (t) => ({
    coinIdx: index().on(t.coin),
    tsIdx: index().on(t.timestamp),
    // Serves the 24h lookback: newest swap for a coin at or before a cutoff.
    coinTsIdx: index().on(t.coin, t.timestamp),
    // Every trade LIST orders by block, not timestamp — Arc's timestamps are
    // non-decreasing, so two swaps in one second cannot be ordered by time.
    blockIdx: index().on(t.block),
    coinBlockIdx: index().on(t.coin, t.block),
  }),
);

/**
 * One row per `FeesCollected`. This is the backbone of fee accounting AND of
 * holder-reward attribution: the vault is shared across every opted-in launch,
 * so the only way to know which launch a pooled payout came from is to sum
 * these per (token, asset) since the last harvest.
 */
export const feeCollection = onchainTable(
  "fee_collection",
  (t) => ({
    id: t.text().primaryKey(), // `${txHash}-${logIndex}`
    coin: t.hex().notNull(),
    currency0: t.hex().notNull(),
    currency1: t.hex().notNull(),
    protocolAmount0: t.bigint().notNull(),
    protocolAmount1: t.bigint().notNull(),
    creatorAmount0: t.bigint().notNull(),
    creatorAmount1: t.bigint().notNull(),
    /** Who the creator side was credited to when this fired. */
    creatorFeeRecipient: t.hex().notNull(),
    timestamp: t.bigint().notNull(),
    block: t.bigint().notNull(),
  }),
  (t) => ({
    coinIdx: index().on(t.coin),
    tsIdx: index().on(t.timestamp),
  }),
);

/** Per-account rollup for the leaderboard / user pages. */
export const captain = onchainTable("captain", (t) => ({
  address: t.hex().primaryKey(),
  coinsCreated: t.integer().notNull().default(0),
  buys: t.integer().notNull().default(0),
  sells: t.integer().notNull().default(0),
  volumeNative: t.bigint().notNull().default(0n),
  firstSeenAt: t.bigint().notNull(),
}));

export const coinRelations = relations(coin, ({ many }) => ({
  swaps: many(swap),
}));

export const swapRelations = relations(swap, ({ one }) => ({
  coinRef: one(coin, { fields: [swap.coin], references: [coin.address] }),
}));
