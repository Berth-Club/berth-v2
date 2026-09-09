import { ponder } from "ponder:registry";
import { and, desc, eq, gte, lte } from "ponder";
import { coin, swap, feeCollection, captain } from "ponder:schema";

import { CONTRACTS, SYSTEM } from "@workspace/contracts";
import { LauncherTokenAbi, LaunchFactoryAbi } from "../abis/berth";
import { pctChange, toCoinTick } from "../lib/ticks";

const NATIVE = SYSTEM.native as `0x${string}`;
const DAY = 86_400n;

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/**
 * Real 24h price change, in percent, or null when there's nothing to compare to.
 *
 * We only ever need the RATIO of two prices, and 1.0001^a / 1.0001^b collapses
 * to 1.0001^(a−b), so the huge exponentials are never evaluated.
 *
 * Returns null when no swap is older than 24h: a coin with no history must show
 * nothing, never a fabricated 0.
 */
async function change24hFor(
  context: any,
  coinAddr: `0x${string}`,
  tickNow: number,
  now: bigint,
): Promise<number | null> {
  const [prior] = await context.db.sql
    .select({ tick: swap.tick })
    .from(swap)
    .where(and(eq(swap.coin, coinAddr), lte(swap.timestamp, now - DAY)))
    // Block, then timestamp: Arc's timestamps are non-decreasing rather than
    // strictly increasing (sub-second blocks share one), so timestamp alone
    // cannot order two swaps in the same second.
    .orderBy(desc(swap.timestamp), desc(swap.block))
    .limit(1);

  if (!prior) return null;
  return pctChange(tickNow, prior.tick);
}

async function bumpCaptain(
  context: any,
  address: `0x${string}`,
  patch: { coinsCreated?: number; buys?: number; sells?: number; volumeNative?: bigint },
  timestamp: bigint,
) {
  await context.db
    .insert(captain)
    .values({
      address,
      coinsCreated: patch.coinsCreated ?? 0,
      buys: patch.buys ?? 0,
      sells: patch.sells ?? 0,
      volumeNative: patch.volumeNative ?? 0n,
      firstSeenAt: timestamp,
    })
    .onConflictDoUpdate((row: any) => ({
      coinsCreated: row.coinsCreated + (patch.coinsCreated ?? 0),
      buys: row.buys + (patch.buys ?? 0),
      sells: row.sells + (patch.sells ?? 0),
      volumeNative: row.volumeNative + (patch.volumeNative ?? 0n),
    }));
}

// ---------------------------------------------------------------------------
// Launches
// ---------------------------------------------------------------------------

/**
 * TokenLaunched carries only `(token, poolId, deployer, pairToken,
 * launchConfigId, poolFee)` — identity and economics are NOT in the event any
 * more. So this handler reads both: `getTokenInfo()` off the token (immutable,
 * set in its constructor) and `getLaunchedToken()` off the factory.
 *
 * That is two extra RPC calls per launch, which is the right trade: the
 * alternative is a `data:` metadata URI packed into the event, which is what
 * v1.4 did and what made a stale ABI silently poison every coin row.
 */
ponder.on("LaunchFactory:TokenLaunched", async ({ event, context }) => {
  const token = event.args.token as `0x${string}`;
  const pairToken = event.args.pairToken as `0x${string}`;

  const [info, record, name, symbol, supply] = await Promise.all([
    context.client.readContract({
      abi: LauncherTokenAbi,
      address: token,
      functionName: "getTokenInfo",
    }),
    context.client.readContract({
      abi: LaunchFactoryAbi,
      address: CONTRACTS.launchFactory,
      functionName: "getLaunchedToken",
      args: [token],
    }),
    context.client.readContract({ abi: LauncherTokenAbi, address: token, functionName: "name" }),
    context.client.readContract({ abi: LauncherTokenAbi, address: token, functionName: "symbol" }),
    context.client.readContract({
      abi: LauncherTokenAbi,
      address: token,
      functionName: "totalSupply",
    }),
  ]);

  // Currency ordering: native is address(0) and sorts first, so the coin is
  // currency1 on a native-quoted pool. Derived, never assumed.
  const coinIsToken0 =
    pairToken !== NATIVE && token.toLowerCase() < pairToken.toLowerCase();

  /**
   * getTokenInfo returns a POSITIONAL tuple, not a named object: viem only
   * builds an object when a function has a single tuple output, and this one
   * has four. Reading `info.logo` here silently yielded undefined and every
   * coin landed with empty art and no description — caught against the real
   * launch 0x251E…FCd3, not by the typechecker.
   */
  const [, logo, description, socials] = info as readonly [
    `0x${string}`,
    string,
    string,
    { twitter: string; telegram: string; discord: string; website: string; farcaster: string },
  ];

  await context.db.insert(coin).values({
    address: token,
    creator: event.args.deployer as `0x${string}`,
    poolId: event.args.poolId as `0x${string}`,
    pairToken,
    creatorFeeRecipient: (record as any).creatorFeeRecipient,
    poolFee: Number(event.args.poolFee),
    baseFeeBps: Number((record as any).baseFeeBps),
    creatorTaxBps: Number((record as any).creatorTaxBps),
    protocolFeeShareBps: Number((record as any).protocolFeeShareBps),
    phantomQuote: (record as any).phantomQuote,
    supply: supply as bigint,
    positionId: (record as any).positionId,
    tickLower: Number((record as any).tickLower),
    tickUpper: Number((record as any).tickUpper),
    liquidity: (record as any).liquidity,
    coinIsToken0,
    name: name as string,
    symbol: symbol as string,
    logo,
    description,
    twitter: socials.twitter,
    telegram: socials.telegram,
    discord: socials.discord,
    website: socials.website,
    farcaster: socials.farcaster,
    createdAt: event.block.timestamp,
    createdBlock: event.block.number,
  });

  await bumpCaptain(
    context,
    event.args.deployer as `0x${string}`,
    { coinsCreated: 1 },
    event.block.timestamp,
  );
});

/** The fee mode is mutable through a 3-day timelock, so the cache must follow. */
ponder.on("LaunchFactory:CreatorFeeRecipientUpdated", async ({ event, context }) => {
  await context.db
    .update(coin, { address: event.args.token as `0x${string}` })
    .set({ creatorFeeRecipient: event.args.newRecipient as `0x${string}` })
    .catch(() => {});
});

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

/**
 * Every swap on Arc passes through the V4 singleton, so this source sees pools
 * that are none of ours. A coin lookup by pool id is the filter — no match, no
 * row, no work.
 */
ponder.on("PoolManager:Swap", async ({ event, context }) => {
  const poolId = event.args.id as `0x${string}`;

  const [row] = await context.db.sql
    .select()
    .from(coin)
    .where(eq(coin.poolId, poolId))
    .limit(1);
  if (!row) return;

  /**
   * `amount0`/`amount1` are the SWAPPER's balance delta, not the pool's:
   * negative = they paid it in, positive = they received it. On a native-quoted
   * pool (currency0 = native) a buy is amount0 < 0.
   */
  const a0 = event.args.amount0 as bigint;
  const a1 = event.args.amount1 as bigint;
  const quoteIsCurrency0 = !row.coinIsToken0;
  const quoteDelta = quoteIsCurrency0 ? a0 : a1;
  const coinDelta = quoteIsCurrency0 ? a1 : a0;

  // Quote paid in = a buy.
  const isBuy = quoteDelta < 0n;
  const amountNative = abs(quoteDelta);
  const amountToken = abs(coinDelta);

  // The LP fee is taken from the INPUT, in pips.
  const amountIn = isBuy ? amountNative : amountToken;
  const feePaid = (amountIn * BigInt(event.args.fee)) / 1_000_000n;

  const poolTick = Number(event.args.tick);
  const tick = toCoinTick(poolTick, row.coinIsToken0);

  await context.db.insert(swap).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    coin: row.address,
    sender: event.args.sender as `0x${string}`,
    isBuy,
    amountToken,
    amountNative,
    feePaid,
    tick,
    timestamp: event.block.timestamp,
    block: event.block.number,
    txHash: event.transaction.hash,
  });

  await context.db.update(coin, { address: row.address }).set((c: any) => ({
    tick,
    poolTick,
    sqrtPriceX96: event.args.sqrtPriceX96,
    volumeNative: c.volumeNative + amountNative,
    swapCount: c.swapCount + 1,
    lastTradeAt: event.block.timestamp,
  }));

  const change = await change24hFor(context, row.address, tick, event.block.timestamp);
  if (change !== null) {
    await context.db.update(coin, { address: row.address }).set({ change24h: change });
  }

  // `sender` is whatever contract called swap — the router for our own trades —
  // so the trader is the transaction's `from`, not the event's sender.
  await bumpCaptain(
    context,
    event.transaction.from as `0x${string}`,
    { buys: isBuy ? 1 : 0, sells: isBuy ? 0 : 1, volumeNative: amountNative },
    event.block.timestamp,
  );
});

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

/**
 * The backbone of fee accounting AND of holder-reward attribution: the holder
 * vault is shared across every opted-in launch, so summing these per
 * (token, asset) since the last harvest is the ONLY way to know whose fees a
 * pooled payout came from.
 */
ponder.on("LaunchLocker:FeesCollected", async ({ event, context }) => {
  const token = event.args.token as `0x${string}`;
  const [row] = await context.db.sql.select().from(coin).where(eq(coin.address, token)).limit(1);

  await context.db.insert(feeCollection).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    coin: token,
    currency0: event.args.currency0 as `0x${string}`,
    currency1: event.args.currency1 as `0x${string}`,
    protocolAmount0: event.args.protocolAmount0,
    protocolAmount1: event.args.protocolAmount1,
    creatorAmount0: event.args.creatorAmount0,
    creatorAmount1: event.args.creatorAmount1,
    creatorFeeRecipient: row?.creatorFeeRecipient ?? NATIVE,
    timestamp: event.block.timestamp,
    block: event.block.number,
  });
});

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/**
 * change24h is a MOVING window, so it has to be recomputed as time passes and
 * not only when a swap fires — otherwise a coin that pumped and then went quiet
 * would keep showing its old number forever.
 */
ponder.on("Clock:block", async ({ event, context }) => {
  // Only coins that traded in the last 48h can have a change24h that MOVES as
  // the window slides: past that, the figure is already null and stays null.
  // Scanning every coin here was the one query in this file whose cost grew
  // with the size of the harbor rather than with activity.
  const cutoff = event.block.timestamp - 2n * DAY;
  const rows = await context.db.sql
    .select({ address: coin.address, tick: coin.tick })
    .from(coin)
    .where(gte(coin.lastTradeAt, cutoff));

  for (const row of rows) {
    if (row.tick === null) continue;
    const change = await change24hFor(context, row.address, row.tick, event.block.timestamp);
    await context.db.update(coin, { address: row.address }).set({ change24h: change });
  }
});
