# Contract Overview (for the designer)

Plain-language map of what the on-chain system does, framed for building the UI. No Solidity needed.
Source of truth: `launchpad-contracts/`. Chain: **Robinhood Chain (id 4663)**.

---

## The one-liner

**A coin launch is a single transaction that mints a token, puts 100% of it into a Uniswap v3 pool,
and throws away the keys to that liquidity — forever.** There's no bonding curve; the pool *is* the
curve. Nobody (not even us, not even the creator) can pull the liquidity or mint more. That
"can't-be-rugged" property is the entire product.

---

## The four contracts, in human terms

| Contract | Think of it as | The designer cares because… |
|---|---|---|
| **LaunchFactory** | the "create a coin" button | the only thing users call to launch; holds the current settings (fee split, curve, caps). |
| **LaunchToken** | the coin itself (an ERC-20) | fixed supply, no owner, no mint, no freeze. It's inert — it just gets traded. |
| **LpLocker** | a vault that owns the liquidity forever | holds every coin's LP position; there is **no withdraw**. It collects trading fees. |
| **FeeLocker** | the rewards piggy bank | where earned fees sit until someone claims them. Permissionless, no admin. |

Only **LaunchFactory** has an admin at all, and their power is limited to *pausing new launches* and
tuning settings for *future* launches. They can't touch any coin, pool, or fee that already exists.

---

## What a "coin" is, and its lifecycle

Every coin is identical in economics — only the name/ticker/image differ. Fixed **100B supply**, always.

```
[ created ] ──trading──> [ live, X% to graduation ] ──range fully bought──> [ graduated ]
     │                          │                                                │
  one tx:                  price climbs as                                 no more curve to
  mint + pool + lock       people buy through                             climb; it's now a
  + optional dev-buy       the v3 range                                   normal v3 market
```

- **created** — the launch tx finished; the coin now exists and is tradable immediately.
- **live** — people are buying/selling; the coin has a **graduation %** = how far the price has climbed
  through the range. This is the progress bar on every card. (We call reaching the top **graduated**.)
- **graduated** — the whole range has been bought through (~6.9 WETH of buys). Show a `graduated` badge.
  It keeps trading normally after this; nothing breaks.

There is **no separate "graduation event," no migration, no new pool.** Graduation is just "the price
reached the top of the range." This is a key difference from pump.fun/vlad, which migrate at graduation.

---

## The three user journeys

### 1. Create a coin (`/summon`)
The creator supplies **cosmetics only**: name, ticker, image/metadata, and an **optional dev-buy**
(their own first buy, in ETH). They do **not** choose supply, price, or fees — those are fixed for
every coin.

Design must surface:
- A **predicted coin address** *before* they sign (the contract can compute it up front). Show it in
  the review step — makes the launch feel real.
- The **dev-buy cap**: a creator can take **at most ~2% of supply** in their first buy (≈0.0045 ETH on
  this curve). Over that, the launch **reverts** — so **block it in the UI before signing** with a clear
  message, don't let them pay gas to fail.
- It's **one transaction** that does everything. Communicate the atomicity ("mint + pool + lock, one
  click").

### 2. Trade a coin (`/token/[address]`)
Ordinary buy/sell against the Uniswap v3 pool. Buy = ETH→coin, sell = coin→ETH.

Design must surface:
- **Price impact / thin liquidity.** The *entire* market has only **~6.9 WETH of exit liquidity**. Big
  trades move price hard, and once graduated there's no more upside room. The amber **price-impact
  warning** is not optional polish — it's honesty. (Already built into the trade panel.)
- **Graduation progress** as context for where on the curve they're buying.
- No deadline field on trades (a chain detail) — nothing to show, just don't invent a "transaction
  deadline" input.

### 3. Claim rewards (`/portfolio` → rewards)
Every trade generates a **1% fee**. Fees are split between the **creator** and the **protocol**
(default 50/50; the creator always gets at least half). Fees pile up on the locked position.

Getting paid is **two distinct steps** — keep them visually separate:
1. **collect** — sweep fees off the locked position into the rewards escrow. (Anyone can trigger it.)
2. **claim** — withdraw your escrow balance to your wallet.

So a reward can be "earned but not yet collected," "collected and claimable," or "claimed." A creator
can also hand their fee stream to a different address (rotate the recipient), but only their own slot.

---

## Money & numbers cheat-sheet

| Thing | Value | UI note |
|---|---|---|
| Supply (every coin) | **100,000,000,000** (100B) | fixed; never a user input |
| Opening market cap | ~0.216 WETH | very low — early buys are cheap in % terms |
| Graduation market cap | ~219 WETH | ~1000× range top to bottom |
| Cost to buy through whole range | **~6.9 WETH** | = total exit liquidity. Drives impact warnings. |
| Trading fee | **1%** per trade | the source of creator rewards |
| Fee split | creator vs protocol, default **50/50** | creator always ≥ 50% |
| Max dev-buy | **~2% of supply** (~0.0045 ETH) | block over-cap before signing |

Numbers are **data** — always render them mono/tabular (there's a `.tabular` helper + `NumberDisplay`).

---

## The trust story (use this for landing / marketing copy)

What **cannot** happen — these are the selling points:
- **Liquidity can't be pulled.** The LP is locked in a vault with no withdraw. Forever.
- **No more coins can be minted.** Supply is fixed at creation.
- **No admin over your coin.** Once launched, nobody can pause it, freeze it, blocklist you, or change it.
- **Rewards can't be frozen or redirected.** Claiming is permissionless and always pays the owner.
- **No bonding curve, no migration.** It's real Uniswap v3 liquidity from block one.

What an admin *can* do (be honest, but it's narrow): pause *new* launches, and tune settings (curve,
fee split, caps) for *future* launches only. Never anything to a coin that already exists.

---

## What each screen reads (data model, roughly)

- **Explore / cards** → coin list + metadata (name/ticker/image), market cap, graduation %, holder
  count, created-by + age. (From launch events + the pool's current price.)
- **Token page** → all of the above + price history, holders, recent trades, links to the pool/position.
- **Create** → the predicted address + the current dev-buy cap.
- **Portfolio** → the connected wallet's holdings, its claimable reward balances, and the coins it
  created.

All of this comes from an **indexer** (not built yet) plus a few live reads. Today the UI runs on
**mock data** (`apps/web/lib/mock.ts`) with the same shape.

---

## Edge cases & states worth designing for

- **Thin liquidity** → prominent price-impact warning on any non-trivial buy/sell.
- **Dev-buy over cap** → inline block in the create flow, before signing.
- **Graduated coin** → badge + "no more curve" framing; trading continues normally.
- **Buying more than the pool can absorb** → the extra ETH is auto-refunded (contract handles it); UI
  can reassure "you'll only pay for what fills."
- **Address-preview failure** → astronomically rare, but the create flow should degrade gracefully
  (retry) rather than assume it always returns.
- **Wallet not connected / wrong network (must be 4663)** → gate write actions (buy/sell/create/claim)
  with a connect / switch-network prompt.
- **Reward states** → earned-but-not-collected vs claimable vs claimed; and **collect ≠ claim**.
- **Empty states** → no coins yet, nothing to claim, no holdings.

---

## Naming (our lowercase-degen labels ↔ what they mean on-chain)

| UI word | On-chain reality |
|---|---|
| **create** a coin | the one-tx launch |
| **graduation / graduated** | price climbed through the whole v3 range (~6.9 WETH bought) |
| **rewards** | accrued 1% LP trading fees |
| **collect** | move fees from the locked position → escrow |
| **claim** | withdraw escrow → your wallet |
| **liquidity locked forever** | the LP vault has no withdraw path |

> Bottom line for design: sell the **safety** (locked, no rug), be **honest about the thin liquidity**,
> and keep **collect vs claim** distinct. Everything else is a normal token-trading UI.
