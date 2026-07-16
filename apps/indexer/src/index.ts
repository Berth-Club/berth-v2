import { ponder } from "ponder:registry";
import { and, count, desc, eq, gt, lte } from "ponder";
import { coin, swap, holder, feeBalance, feeRecipient, captain } from "ponder:schema";

// Tick-space math lives in lib/ so it can be unit-checked without Ponder's
// virtual modules: `node lib/ticks.ts`. Read the comments there before touching
// anything tick-related — the token ordering is NOT what it looks like.
import {
  WETH9,
  isCoinToken0,
  toCoinTick,
  poolRange,
  curveProgress,
  pctChange,
} from "../lib/ticks";

/** Mint source / burn sink. Never counts as a holder. */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const DAY = 86_400n;

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** Holder row id. Lowercased so it matches the `hex()` columns, which store lowercase. */
function holderId(coinAddr: string, address: string): string {
  return `${coinAddr.toLowerCase()}-${address.toLowerCase()}`;
}

/**
 * Real 24h price change, in percent, or null when there's nothing to compare to.
 *
 * Takes COIN-SPACE ticks (see toCoinTick), where price = 1.0001^tick is WETH per
 * whole coin for either token ordering — so this needs no ordering knowledge.
 *
 * We only ever need the *ratio* of two prices, and 1.0001^a / 1.0001^b collapses
 * to 1.0001^(a-b), so we never evaluate the huge exponentials themselves.
 *
 * Returns null when no swap is older than 24h: a coin with no history to compare
 * against must show nothing, never a fabricated 0.
 */
async function change24hFor(
  context: any,
  coinAddr: `0x${string}`,
  tickNow: number,
  now: bigint,
): Promise<number | null> {
  // The newest swap at or before the cutoff = the price as of 24h ago.
  const [prior] = await context.db.sql
    .select({ tick: swap.tick })
    .from(swap)
    .where(and(eq(swap.coin, coinAddr), lte(swap.timestamp, now - DAY)))
    .orderBy(desc(swap.timestamp))
    .limit(1);

  if (!prior) return null;
  return pctChange(tickNow, prior.tick);
}

async function bumpCaptain(
  context: any,
  address: `0x${string}`,
  patch: { coinsCreated?: number; buys?: number; sells?: number; volumeWeth?: bigint },
  timestamp: bigint,
) {
  await context.db
    .insert(captain)
    .values({
      address,
      coinsCreated: patch.coinsCreated ?? 0,
      buys: patch.buys ?? 0,
      sells: patch.sells ?? 0,
      volumeWeth: patch.volumeWeth ?? 0n,
      firstSeenAt: timestamp,
    })
    .onConflictDoUpdate((row: any) => ({
      coinsCreated: row.coinsCreated + (patch.coinsCreated ?? 0),
      buys: row.buys + (patch.buys ?? 0),
      sells: row.sells + (patch.sells ?? 0),
      volumeWeth: row.volumeWeth + (patch.volumeWeth ?? 0n),
    }));
}

// ---------------------------------------------------------------------------
// Launches
// ---------------------------------------------------------------------------

ponder.on("LaunchFactory:TokenLaunched", async ({ event, context }) => {
  const a = event.args;

  // The event's ticks are coin-space; the real pool/NFPM range is mirrored when
  // the coin is token1. Verified for $SMOKE: event [-268600,-199400] vs the
  // on-chain position [199400, 268600].
  const coinIsToken0 = isCoinToken0(a.token);
  const { poolTickLower, poolTickUpper } = poolRange(a.tickLower, a.tickUpper, coinIsToken0);

  await context.db.insert(coin).values({
    address: a.token,
    creator: a.creator,
    tokenId: a.tokenId,
    pool: a.pool,
    supply: a.supply,
    tickLower: a.tickLower,
    tickUpper: a.tickUpper,
    coinIsToken0,
    poolTickLower,
    poolTickUpper,
    protocolFeeBps: a.protocolFeeBps,
    devBuyEthIn: a.devBuyEthIn,
    name: a.name,
    symbol: a.symbol,
    metadataURI: a.metadataURI,
    createdAt: event.block.timestamp,
    createdBlock: event.block.number,
    // In coin space a fresh pool always starts at tickLower => 0 progress. (In
    // pool space that's poolTickUpper when the coin is token1 — the same point.)
    tick: a.tickLower,
    poolTick: coinIsToken0 ? poolTickLower : poolTickUpper,
    curve: 0,
    graduated: false,
    // No swaps yet => nothing to compare against => no 24h change.
    change24h: null,
  });

  // The launch tx mints the supply and funds the LP *before* it emits
  // TokenLaunched (verified on chain: the token's Transfer logs are at logIndex
  // 4/8/13, this event at 17). Those Transfer handlers ran first and already
  // wrote holder rows, but had no coin row to bump — so seed the count here.
  const [seed] = await context.db.sql
    .select({ n: count() })
    .from(holder)
    .where(and(eq(holder.coin, a.token), gt(holder.balance, 0n)));

  if (seed && seed.n > 0) {
    await context.db.update(coin, { address: a.token }).set({ holderCount: seed.n });
  }

  await bumpCaptain(context, a.creator, { coinsCreated: 1 }, event.block.timestamp);
});

// ---------------------------------------------------------------------------
// Trading — drives price, graduation progress and volume
// ---------------------------------------------------------------------------

ponder.on("LaunchPool:Swap", async ({ event, context }) => {
  const { amount0, amount1, tick, sqrtPriceX96, sender, recipient } = event.args;

  // Find the coin this pool belongs to.
  const [c] = await context.db.sql
    .select()
    .from(coin)
    .where(eq(coin.pool, event.log.address))
    .limit(1);
  if (!c) return; // not one of ours

  // Which amount is WETH depends on the pool's token ordering — NOT fixed.
  // A positive amount means that token went INTO the pool, so WETH in => a buy.
  const wethDelta = c.coinIsToken0 ? amount1 : amount0;
  const tokenDelta = c.coinIsToken0 ? amount0 : amount1;
  const isBuy = wethDelta > 0n;
  const amountWeth = abs(wethDelta);
  const amountToken = abs(tokenDelta);

  // Normalise once, then all the range math below is ordering-agnostic.
  const coinTick = toCoinTick(tick, c.coinIsToken0);
  const progress = curveProgress(coinTick, c.tickLower, c.tickUpper);

  await context.db.update(coin, { address: c.address }).set({
    tick: coinTick,
    poolTick: tick,
    sqrtPriceX96,
    curve: progress,
    // Coin space always climbs toward tickUpper, whichever side the coin is on.
    graduated: coinTick >= c.tickUpper,
    volumeWeth: c.volumeWeth + amountWeth,
    swapCount: c.swapCount + 1,
    lastTradeAt: event.block.timestamp,
    // This swap is at `now`, so it can never be its own 24h-ago comparison point.
    change24h: await change24hFor(context, c.address, coinTick, event.block.timestamp),
  });

  await context.db.insert(swap).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    coin: c.address,
    sender,
    recipient,
    isBuy,
    amountToken,
    amountWeth,
    tick: coinTick,
    timestamp: event.block.timestamp,
    block: event.block.number,
    txHash: event.transaction.hash,
  });

  await bumpCaptain(
    context,
    recipient,
    isBuy ? { buys: 1, volumeWeth: amountWeth } : { sells: 1, volumeWeth: amountWeth },
    event.block.timestamp,
  );
});

// ---------------------------------------------------------------------------
// Holders — rebuilt purely from ERC20 Transfer logs
// ---------------------------------------------------------------------------

/**
 * Applies a signed delta to one holder's balance.
 * Returns the resulting change in the coin's holder count: -1, 0 or +1.
 */
async function applyBalance(
  context: any,
  coinAddr: `0x${string}`,
  address: `0x${string}`,
  delta: bigint,
): Promise<number> {
  if (address === ZERO_ADDRESS) return 0; // mint/burn endpoint, not a holder

  const id = holderId(coinAddr, address);
  const prev = (await context.db.find(holder, { id }))?.balance ?? 0n;

  // Clamp at zero. A balance must never go negative even if we somehow saw a
  // send before its matching receive (reorg, or a token that mints oddly).
  const sum = prev + delta;
  const next = sum > 0n ? sum : 0n;

  await context.db
    .insert(holder)
    .values({ id, coin: coinAddr, address, balance: next })
    .onConflictDoUpdate({ balance: next });

  // Only crossing the zero boundary moves the count.
  return (next > 0n ? 1 : 0) - (prev > 0n ? 1 : 0);
}

ponder.on("LaunchToken:Transfer", async ({ event, context }) => {
  const { from, to, value } = event.args;
  if (value === 0n) return; // moves no balance, so it can't move the holder set

  const token = event.log.address;
  const delta =
    (await applyBalance(context, token, from, -value)) +
    (await applyBalance(context, token, to, value));

  if (delta === 0) return;

  // The launch-tx mints arrive before TokenLaunched, so the coin row may not
  // exist yet; TokenLaunched seeds holderCount from the rows we just wrote.
  const c = await context.db.find(coin, { address: token });
  if (!c) return;

  await context.db
    .update(coin, { address: token })
    .set({ holderCount: c.holderCount + delta });
});

// ---------------------------------------------------------------------------
// Clock — keeps the rolling 24h window honest between trades
// ---------------------------------------------------------------------------

ponder.on("Clock:block", async ({ event, context }) => {
  // Recompute change24h for traded coins. Without this the value would freeze at
  // whatever the last swap computed: a coin that pumped and then went quiet for
  // days would advertise that pump forever, instead of decaying to 0%.
  //
  // ponytail: full scan of traded coins each interval. Fine at launchpad scale
  // (tens–hundreds of coins); if it reaches thousands, narrow the filter to coins
  // whose lastTradeAt is within ~48h — older ones have already settled at 0.
  const coins = await context.db.sql.select().from(coin).where(gt(coin.swapCount, 0));

  for (const c of coins) {
    if (c.tick === null) continue;
    const next = await change24hFor(context, c.address, c.tick, event.block.timestamp);
    if (next === c.change24h) continue; // no write if nothing moved
    await context.db.update(coin, { address: c.address }).set({ change24h: next });
  }
});

// ---------------------------------------------------------------------------
// Fees: the split, then collect (position -> escrow), then claim (escrow -> wallet)
// ---------------------------------------------------------------------------

ponder.on("LpLocker:PositionRegistered", async ({ event, context }) => {
  const { tokenId, recipients } = event.args;
  for (const [i, r] of recipients.entries()) {
    await context.db.insert(feeRecipient).values({
      id: `${tokenId}-${i}`,
      tokenId,
      addr: r.addr,
      bps: r.bps,
    });
  }
});

/** Deposited into escrow => claimable goes UP. This is `collect`'s effect. */
ponder.on("FeeLocker:FeesDeposited", async ({ event, context }) => {
  const { feeOwner, token, amount } = event.args;
  if (amount === 0n) return;

  await context.db
    .insert(feeBalance)
    .values({
      id: `${feeOwner}-${token}`,
      owner: feeOwner,
      token,
      claimable: amount,
      lifetimeEarned: amount,
      lifetimeClaimed: 0n,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate((row: any) => ({
      claimable: row.claimable + amount,
      lifetimeEarned: row.lifetimeEarned + amount,
      updatedAt: event.block.timestamp,
    }));
});

/** Withdrawn to wallet => claimable goes to zero. This is `claim`'s effect. */
ponder.on("FeeLocker:FeesClaimed", async ({ event, context }) => {
  const { feeOwner, token, amount } = event.args;

  await context.db
    .insert(feeBalance)
    .values({
      id: `${feeOwner}-${token}`,
      owner: feeOwner,
      token,
      claimable: 0n,
      lifetimeEarned: amount,
      lifetimeClaimed: amount,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate((row: any) => ({
      claimable: row.claimable > amount ? row.claimable - amount : 0n,
      lifetimeClaimed: row.lifetimeClaimed + amount,
      updatedAt: event.block.timestamp,
    }));
});

export { WETH9 };
