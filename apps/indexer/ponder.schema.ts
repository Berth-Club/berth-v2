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
    /**
     * COIN-SPACE range, exactly as TokenLaunched emits it: ticks of "WETH per
     * whole coin", so higher = coin more expensive, and graduation is at
     * tickUpper. Compare these ONLY against `coin.tick`/`swap.tick`, which are
     * normalised into the same space. See src/index.ts `toCoinTick`.
     */
    tickLower: t.integer().notNull(),
    tickUpper: t.integer().notNull(),
    /**
     * Uniswap token ordering for this pool. The deployed factory does NOT force
     * the coin to token0 — it mirrors the tick range when the coin sorts above
     * WETH9 instead. Verified on chain for $SMOKE: pool.token0() = WETH9.
     */
    coinIsToken0: t.boolean().notNull(),
    /**
     * The REAL pool/NFPM-space range (what slot0.tick and positions() report).
     * Equals [tickLower, tickUpper] when coinIsToken0, else the mirrored
     * [-tickUpper, -tickLower]. Stored so the web app never has to re-derive it.
     */
    poolTickLower: t.integer().notNull(),
    poolTickUpper: t.integer().notNull(),
    protocolFeeBps: t.integer().notNull(),
    devBuyEthIn: t.bigint().notNull(),
    name: t.text().notNull(),
    symbol: t.text().notNull(),
    metadataURI: t.text().notNull(),
    createdAt: t.bigint().notNull(),
    createdBlock: t.bigint().notNull(),

    // --- market state, maintained from pool Swap events ---
    /**
     * Latest tick in COIN SPACE (negated when the coin is token1), so
     * `1.0001^tick` is always WETH per whole coin regardless of pool ordering.
     * NOT the raw slot0 tick — use poolTick for that.
     */
    tick: t.integer(),
    /** Raw slot0-space tick, as the pool itself reports it. */
    poolTick: t.integer(),
    /** Raw slot0 sqrtPriceX96 — pool space, i.e. token1 per token0. */
    sqrtPriceX96: t.bigint(),
    /** 0–1 progress along the range toward graduation. */
    curve: t.real().notNull().default(0),
    graduated: t.boolean().notNull().default(false),
    /** Cumulative WETH volume, wei. */
    volumeWeth: t.bigint().notNull().default(0n),
    swapCount: t.integer().notNull().default(0),
    lastTradeAt: t.bigint(),
    /** Addresses holding a non-zero balance. The locked LP pool is one of them. */
    holderCount: t.integer().notNull().default(0),
    /**
     * Price change over the last 24h, in percent. NULLABLE on purpose: null means
     * "no trade older than 24h to compare against", which the UI must render as
     * nothing rather than a fake 0.
     */
    change24h: t.real(),
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
    /** COIN-SPACE tick after the swap — see coin.tick. Drives the 24h change. */
    tick: t.integer().notNull(),
    timestamp: t.bigint().notNull(),
    block: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (t) => ({
    coinIdx: index().on(t.coin),
    tsIdx: index().on(t.timestamp),
    recipientIdx: index().on(t.recipient),
    // Serves the 24h lookback: newest swap for a coin at or before a cutoff.
    coinTsIdx: index().on(t.coin, t.timestamp),
  }),
);

/**
 * Token balance per address, per coin. Rebuilt from ERC20 Transfer logs, so it
 * needs no chain reads. The zero address is never a holder (mint/burn endpoint).
 */
export const holder = onchainTable(
  "holder",
  (t) => ({
    id: t.text().primaryKey(), // `${coin}-${address}`, both lowercased
    coin: t.hex().notNull(),
    address: t.hex().notNull(),
    balance: t.bigint().notNull().default(0n),
  }),
  (t) => ({
    coinIdx: index().on(t.coin),
    addressIdx: index().on(t.address),
    // Serves "holders of this coin, biggest first" and the holderCount seed.
    coinBalanceIdx: index().on(t.coin, t.balance),
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
  holders: many(holder),
}));

export const swapRelations = relations(swap, ({ one }) => ({
  coinRef: one(coin, { fields: [swap.coin], references: [coin.address] }),
}));

export const holderRelations = relations(holder, ({ one }) => ({
  coinRef: one(coin, { fields: [holder.coin], references: [coin.address] }),
}));
