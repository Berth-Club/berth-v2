import { ponder } from "ponder:registry";
import { coin, swap, feeBalance, feeRecipient, captain } from "ponder:schema";

/** Pinned WETH9 on Robinhood Chain (4663) — the quote asset of every pool. */
const WETH9 = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";

/**
 * Salt mining guarantees every launched token sorts below WETH9, so the coin is
 * always token0 and WETH is always token1. That's what makes `amount0`/`amount1`
 * unambiguous below, and why buyers push the tick UP.
 */
function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** 0–1 progress of `tick` through [lower, upper]. Clamped. */
function curveProgress(tick: number, lower: number, upper: number): number {
  if (upper <= lower) return 0;
  const p = (tick - lower) / (upper - lower);
  return Math.min(1, Math.max(0, p));
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

  await context.db.insert(coin).values({
    address: a.token,
    creator: a.creator,
    tokenId: a.tokenId,
    pool: a.pool,
    supply: a.supply,
    tickLower: a.tickLower,
    tickUpper: a.tickUpper,
    protocolFeeBps: a.protocolFeeBps,
    devBuyEthIn: a.devBuyEthIn,
    name: a.name,
    symbol: a.symbol,
    metadataURI: a.metadataURI,
    createdAt: event.block.timestamp,
    createdBlock: event.block.number,
    // pool is initialised at tickLower, so a fresh coin sits at 0 progress
    tick: a.tickLower,
    curve: 0,
    graduated: false,
  });

  await bumpCaptain(context, a.creator, { coinsCreated: 1 }, event.block.timestamp);
});

// ---------------------------------------------------------------------------
// Trading — drives price, graduation progress and volume
// ---------------------------------------------------------------------------

ponder.on("LaunchPool:Swap", async ({ event, context }) => {
  const { amount0, amount1, tick, sqrtPriceX96, sender, recipient } = event.args;

  // Find the coin this pool belongs to.
  const rows = await context.db.sql
    .select()
    .from(coin)
    .where((c: any) => c.pool.eq(event.log.address))
    .limit(1)
    .catch(() => []);
  const c = rows?.[0];
  if (!c) return; // not one of ours

  // token0 = the coin, token1 = WETH (guaranteed by salt mining).
  // amount1 > 0 means WETH went INTO the pool => a buy.
  const isBuy = amount1 > 0n;
  const amountWeth = abs(amount1);
  const amountToken = abs(amount0);

  const progress = curveProgress(tick, c.tickLower, c.tickUpper);

  await context.db.update(coin, { address: c.address }).set({
    tick,
    sqrtPriceX96,
    curve: progress,
    graduated: tick >= c.tickUpper,
    volumeWeth: c.volumeWeth + amountWeth,
    swapCount: c.swapCount + 1,
    lastTradeAt: event.block.timestamp,
  });

  await context.db.insert(swap).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    coin: c.address,
    sender,
    recipient,
    isBuy,
    amountToken,
    amountWeth,
    tick,
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
