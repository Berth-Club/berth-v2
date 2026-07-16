# berth.club

A fair-launch memecoin launchpad on **Robinhood Chain (chain id 4663)**.

A launch is a single transaction: mint a 100B-supply token, put 100% of it into a Uniswap v3 pool,
and lock the LP forever (there is no withdraw path). **No bonding curve, no migration** — "graduation"
just means price has climbed through the whole v3 range (~6.9 WETH of buys). After that it keeps
trading like any other v3 market.

> Deep water outside. Still water in here.

## Quick start

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # then fill in NEXT_PUBLIC_PRIVY_APP_ID
pnpm --filter web dev
```

The app runs without any env vars — the wallet button no-ops and the harbor shows demo data. For the
full experience, run the indexer too (below).

## Repo layout

| Path | What |
|---|---|
| `apps/web` | Next.js app (App Router) — the 7 screens |
| `apps/indexer` | Ponder indexer over the launchpad contracts on 4663 |
| `packages/ui` | shadcn/base-nova components + the design tokens |
| `.design/launchpad` | Design handoff: IA, tokens, tasks, contract overview |

The contracts live in a sibling repo (`launchpad-contracts`), not here.

## Environment

`apps/web/.env.local`:

```bash
NEXT_PUBLIC_PRIVY_APP_ID=            # from dashboard.privy.io — wallet connect no-ops without it
INDEXER_URL=http://localhost:42069   # optional; falls back to demo data when unreachable
NEXT_PUBLIC_ROBINHOOD_RPC=           # optional; defaults to the public RPC
```

`apps/indexer/.env.local`:

```bash
PONDER_RPC_URL_4663=https://rpc.mainnet.chain.robinhood.com
# DATABASE_URL=postgres://...        # omit to use pglite locally
```

## The indexer

```bash
cd apps/indexer && pnpm dev          # http://localhost:42069/graphql
```

Ponder indexes `LaunchFactory` / `LpLocker` / `FeeLocker` from the factory's deploy block
(**11105088**), plus a **factory source** that discovers every launch's Uniswap v3 pool from
`TokenLaunched.pool` and indexes its `Swap` events. That's what drives price, graduation progress and
volume.

It serves GraphQL + SQL-over-HTTP, so there's no separate API service. The web app reads it
server-side and **falls back to demo data when it's unreachable** — the harbor badge shows
`● live · chain 4663` or `● demo data` accordingly.

**Ponder is stateful** (persistent Node + Postgres). It cannot run on Vercel; host it separately.

## Deployed contracts (chain 4663)

| Contract | Address |
|---|---|
| LaunchFactory | `0x5DA172F7D4464DDCD43e748E9458DbdBE943c016` |
| LpLocker | `0x022A133a1FDD513dC06AD3b8BaD30b454C074b4d` |
| FeeLocker | `0xC4Cc6784d32a3732fB991D0E5bA5553757B54E1a` |

Verified on-chain: the factory and lockers are wired to each other, `factoryLocked = true`, and
**`LpLocker.owner() == address(0)`** — ownership is renounced, so no one can touch a locked position.

Uniswap v3 + WETH9 addresses are pinned in `apps/web/lib/chain.ts`, copied from the contracts repo's
`Addresses.sol`. **Do not look them up by name on the explorer** — chain 4663 is launchpad-heavy and
full of impostors.

## Domain rules (do not drift)

These come from the contracts. `.design/launchpad/CONTRACT_OVERVIEW.md` is the source of truth.

- **graduation / graduated** — never "bonding curve" or "migrates to DEX"
- **collect** (position → escrow, anyone can trigger) vs **claim** (escrow → wallet). Two separate
  transactions; keep them visually distinct
- **dev-buy** is capped at ~0.0045 Ξ (~2% of supply) and is blocked client-side — the launch would
  revert on-chain and the user shouldn't pay gas to fail
- Fixed **100B** supply; **1%** trade fee split creator/protocol (creator ≥ 50%)
- **~6.9 WETH is the entire market's exit liquidity** — this is why price-impact warnings exist and
  are not optional polish
- Opening market cap ~0.216 WETH; graduation ~219 WETH
- `SwapRouter02.exactInputSingle` has **no deadline field** — don't add one

## Design

Recreated from the berth.club handoff (`.design/launchpad/`). Fidelity is high — colours, type,
spacing, radii, shadows and copy are final intent.

- **Type**: Lilita One (display/buttons) + Space Grotesk (body); numbers always 700 + `tabular-nums`
- **Buttons**: hard offset "deck" shadow (`0 4px 0 <darker>`), hover lifts, active presses.
  **No soft shadows on actions** — see `.btn-deck` in `packages/ui/src/styles/globals.css`
- **Graduation meter**: flowing 4-colour gradient with a ⛵ riding the head of the fill
- Iconography is emoji, on purpose. The mascot and logo roundel are pure CSS. No raster assets.

## Status

Reads are live; **writes are not wired yet**.

- ✅ All 7 screens, live indexed data, Privy auth (wallet/email + embedded wallets), wrong-network gate
- ❌ Buy/sell, launch, collect/claim do **not** send transactions yet — they fire confetti and update
  local state only
- ⚠️ `change24h` and holders/recent-trades are still mock; ETH/USD is hardcoded at $3,400
- ⚠️ The deployed `LaunchFactory` runtime **does not match** the contracts repo source (it's missing
  `MAX_PROTOCOL_FEE_BPS()`). Event ABIs are verified against real logs; the function ABI should be
  reconciled before wiring writes
