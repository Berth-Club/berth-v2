import { onchainTable, index, relations } from "ponder";

/**
 * A launched coin. One TokenLaunched event fully populates a discovery row —
 * no extra chain reads needed for the harbor grid.
 */
export const coin = onchainTable(
  "coin",
  (t) => ({
    address: t.hex().primaryKey(),
    creator: t.hex().notNull(),
    tokenId: t.bigint().notNull(),
    pool: t.hex().notNull(),
    supply: t.bigint().notNull(),
    tickLower: t.integer().notNull(),
    tickUpper: t.integer().notNull(),
    protocolFeeBps: t.integer().notNull(),
    devBuyEthIn: t.bigint().notNull(),
    name: t.text().notNull(),
    symbol: t.text().notNull(),
    metadataURI: t.text().notNull(),
    createdAt: t.bigint().notNull(),
    createdBlock: t.bigint().notNull(),

    // --- market state, maintained from pool Swap events ---
    /** Latest pool tick. null until the first swap. */
    tick: t.integer(),
    sqrtPriceX96: t.bigint(),
    /** 0–1 progress along the range toward graduation. */
    curve: t.real().notNull().default(0),
    graduated: t.boolean().notNull().default(false),
    /** Cumulative WETH volume, wei. */
    volumeWeth: t.bigint().notNull().default(0n),
    swapCount: t.integer().notNull().default(0),
    lastTradeAt: t.bigint(),
  }),
  (t) => ({
    creatorIdx: index().on(t.creator),
    poolIdx: index().on(t.pool),
    createdIdx: index().on(t.createdAt),
  }),
);

/** Every swap on a launched pool. Drives charts + the activity ticker. */
export const swap = onchainTable(
  "swap",
  (t) => ({
    id: t.text().primaryKey(), // `${txHash}-${logIndex}`
    coin: t.hex().notNull(),
    sender: t.hex().notNull(),
    recipient: t.hex().notNull(),
    /** true = someone bought the coin (WETH in). */
    isBuy: t.boolean().notNull(),
    /** Absolute amounts, wei. */
    amountToken: t.bigint().notNull(),
    amountWeth: t.bigint().notNull(),
    tick: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (t) => ({
    coinIdx: index().on(t.coin),
    tsIdx: index().on(t.timestamp),
    recipientIdx: index().on(t.recipient),
  }),
);

/**
 * Fees owed to an account, per token — mirrors FeeLocker.availableFees.
 * `collect` (LpLocker) moves fees position -> escrow; `claim` (FeeLocker)
 * moves escrow -> wallet. Kept as separate numbers on purpose.
 */
export const feeBalance = onchainTable(
  "fee_balance",
  (t) => ({
    id: t.text().primaryKey(), // `${owner}-${token}`
    owner: t.hex().notNull(),
    token: t.hex().notNull(),
    /** Currently sitting in escrow, withdrawable via claim(). */
    claimable: t.bigint().notNull().default(0n),
    /** Lifetime total ever deposited to escrow for this owner/token. */
    lifetimeEarned: t.bigint().notNull().default(0n),
    /** Lifetime total ever withdrawn to wallet. */
    lifetimeClaimed: t.bigint().notNull().default(0n),
    updatedAt: t.bigint().notNull(),
  }),
  (t) => ({
    ownerIdx: index().on(t.owner),
  }),
);

/** The immutable bps split registered for each locked position. */
export const feeRecipient = onchainTable(
  "fee_recipient",
  (t) => ({
    id: t.text().primaryKey(), // `${tokenId}-${index}`
    tokenId: t.bigint().notNull(),
    addr: t.hex().notNull(),
    bps: t.integer().notNull(),
  }),
  (t) => ({
    tokenIdIdx: index().on(t.tokenId),
    addrIdx: index().on(t.addr),
  }),
);

/** Per-account rollup for the leaderboard / user pages. */
export const captain = onchainTable("captain", (t) => ({
  address: t.hex().primaryKey(),
  coinsCreated: t.integer().notNull().default(0),
  buys: t.integer().notNull().default(0),
  sells: t.integer().notNull().default(0),
  volumeWeth: t.bigint().notNull().default(0n),
  firstSeenAt: t.bigint().notNull(),
}));

export const coinRelations = relations(coin, ({ many }) => ({
  swaps: many(swap),
}));

export const swapRelations = relations(swap, ({ one }) => ({
  coinRef: one(coin, { fields: [swap.coin], references: [coin.address] }),
}));
