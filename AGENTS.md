> New here? Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first for the big
> picture (what the app is, how web/indexer/contracts/DB fit together, how to run,
> test, and deploy). This file is the strict conventions + tripwires.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:contracts-and-abis -->
# Contract addresses, ABIs, and the indexer

The launchpad contracts are developed in a separate repo
(`launchpad-contracts-v2`, github.com/Berth-Club/launchpad-contracts-v2 —
private). This repo *consumes* them. Read that repo's `docs/CONCEPTS.md` and
`docs/BACKEND.md` before changing anything on this page; they are the authority
and they are good.

**v2 is a different system from v1.4, not a redeploy of it.** Uniswap V4 instead
of V3, a phantom-reserve position instead of a bonding curve, identity stored on
the token instead of in a metadata URI, and **no graduation at all** — the pool
that exists in second one is the pool the token lives in forever. If you find
code or copy that talks about graduating, it is a leftover; delete it.

## Addresses — one source of truth

**All on-chain addresses live in `@workspace/contracts`** (`packages/contracts/src/index.ts`):
`CONTRACTS`, `WALLETS`, `SYSTEM`, `CONSTANTS`, `START_BLOCK`, `CHAIN`. Both the
web app (`apps/web/lib/chain.ts`) and the indexer (`apps/indexer/ponder.config.ts`)
import from it.

- **Never** hard-code an address in app code, and **never** add
  `NEXT_PUBLIC_LAUNCH_FACTORY` / `LAUNCH_FACTORY` / `START_BLOCK` env vars back.
  The web env once pointed at the old factory while the indexer watched the new
  one; launches landed on a contract nothing indexed. The package exists so the
  two can never diverge.
- A new deployment = edit `packages/contracts/src/index.ts`. That's it. Both
  services redeploy on it (see railway.json watch patterns below).

## ABIs — generated, never hand-edited

`apps/web/lib/abis/*.ts` and `apps/indexer/abis/berth.ts` are written by
**`node packages/contracts/scripts/gen-abis.mjs`**, which pulls the JSON straight
from the contracts repo with `gh api` (the repo is private, so `gh` must be
authenticated). Do not hand-edit the output. Run the generator after every
contracts deployment.

The one hand-written ABI is `apps/indexer/abis/pool-manager.ts` — Uniswap's
periphery does not live in our contracts repo. It carries a single event.

## The indexer event shape is load-bearing

Ponder filters logs by **topic0 = keccak of the event's type signature**. If an
ABI here has drifted from the deployed contract, the indexer matches **zero
logs with no error** — indistinguishable from "nobody has launched yet". This
is why the ABIs are generated rather than typed.

Two v2 traps in particular:

- `BerthClubLaunchFactory` and `BerthClubMultiLaunchFactory` emit events with the
  **same names and different shapes**. Key any decoder by (address, topic0),
  never by name.
- `TokenLaunched` carries only `(token, poolId, deployer, pairToken,
  launchConfigId, poolFee)`. Name, symbol, logo, description and socials are
  read off the **token contract** (`getTokenInfo()`), and the economics off
  `factory.getLaunchedToken()`. Two extra reads per launch, deliberately.

## V4 is a singleton — do not reintroduce a `factory()` source

v1.4 watched every pool through a ponder `factory()` source, which sent the whole
discovered address list in one `eth_getLogs`. Arc's public endpoint caps that at
~20 addresses and reports the overflow as `"requested range too large"` — a
message about the ADDRESS count that ponder reads as a BLOCK range problem, so it
shrank the range forever and stalled with no error. Working around it needed a
patched `factoryAddressCountThreshold` (`patches/ponder@0.16.10.patch`, now
deleted along with `PONDER_FACTORY_ADDRESS_THRESHOLD`).

**None of that applies to V4.** Pools have no addresses; every swap on the chain
comes from the one `PoolManager` and is identified by `id` (the pool id). One
address to watch, no matter how many launches. The cost is that the source sees
every pool on Arc — `src/index.ts` drops a `Swap` whose pool id has no coin row.

If that volume ever becomes the problem, the fix is a poolId filter, **not** a
return to address lists. And never add a `factory()` source whose event is ERC20
`Transfer`: a factory source defeats ponder's bloom-filter skip (child addresses
are unknown when the filter runs, so matching collapses to topic0 alone), and
`Transfer`'s topic0 is in nearly every block. That cost this project a multi-day
outage.

Holder data comes from Arcscan (Blockscout) in `apps/web/lib/holders.ts`, not
from the indexer. Keep it that way. The indexer keeps only what it is uniquely
good at: launches, trades, and fees.

**There is no RPC request cap.** `maxRequestsPerSecond` is `@deprecated` in
ponder 0.16 and does nothing. The only real lever is keeping the per-block
workload small.

## Arc chain rules (docs.arc.io/llms.txt)

Arc's own AI-facing docs are at **https://docs.arc.io/llms.txt**; the canonical
runtime reference is
**https://docs.arc.io/arc/references/evm-differences.md**. Read the latter
before touching balances, gas, transaction history or value transfers. The four
that have already cost us something:

1. **`maxFeePerGas` below 20 Gwei is silently dropped.** No error, no receipt,
   never mined. We set no gas fields anywhere, so viem estimates from the chain
   and is safe — do not start hardcoding them.
2. **Gas is not free and has a floor.** A real v2 launch (0x7300ce…404e) used
   **2,623,127 gas at 21 Gwei = 0.055 USDC**. Any "can this wallet afford it"
   check must reserve gas on top of the value being sent; `GAS_HEADROOM_WEI` in
   `lib/launch.ts` and `SWAP_GAS_HEADROOM_WEI` in `lib/trade.ts` exist for that.
   A buy spends native USDC as `msg.value`, which is the same balance that pays
   gas, so spending the full balance always fails.
3. **Native USDC Transfer events come from the system emitter**
   `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE`, at 18 decimals — NOT from
   `0x3600…0000`. If we ever index USDC movement, filter the emitter only:
   counting both double-counts. (Holder data comes from Arcscan today, so this
   does not bite yet.)
4. **Block timestamps are non-decreasing, not strictly increasing.** Sub-second
   blocks share a timestamp. Order by `(blockNumber, logIndex)`, never by
   timestamp alone.

Also true and worth not re-deriving: finality is on inclusion (one confirmation
is enough, no reorg to unwind), and `address(0)` sends REVERT rather than
silently succeeding.

## Units: the trap that bites hardest

Arc's gas token is USDC and it has **two faces over one balance**:

| Face | Named as | Decimals |
|---|---|---|
| Native | `address(0)`, `msg.value` | **18** |
| ERC-20 | `0x3600…0000` | **6** |

Everything in v2 — every `phantomQuote`, every fee, every pool currency — is
**native, 18dp**. `formatUnits(nativeAmount, 6)` overstates by 1e12, and the
contracts repo calls it the single most likely integration bug. The ERC20 face is
refused outright as a quote asset (`NativeAliasNotAllowed`).

## Deploying a new contract version — checklist

1. Bump addresses + `START_BLOCK` in `packages/contracts/src/index.ts`.
2. Run `node packages/contracts/scripts/gen-abis.mjs`. If any call site's args or
   any indexed event changed, fix the call sites and handlers to match.
3. On the indexer Railway service, bump `DATABASE_SCHEMA` (Ponder refuses to
   reuse a schema a different app version created — it crash-loops otherwise).
4. Push. `railway.json` `watchPatterns` include `packages/**`, so a package
   change redeploys **both** web and indexer.
<!-- END:contracts-and-abis -->

<!-- BEGIN:database -->
# The database is shared with Ponder — drizzle-kit must never see its tables

The web app's tables (`apps/web/lib/db/schema.ts`, currently just `coin_comments`)
live on the **same Postgres the indexer uses**. Ponder owns its own tables and
recreates them on every reindex; nothing in the web schema may reference them.

`apps/web/drizzle.config.ts` pins `tablesFilter: ["coin_comments"]`. **This is a
safety rail, not tidiness.** Without it, drizzle-kit diffs Ponder's tables
against a schema that doesn't declare them and emits `DROP TABLE` for the lot —
`push` would execute that against the live indexer. Add every new table to both
the schema file and `tablesFilter`.

## Workflow

```
pnpm --filter web db:generate   # schema.ts -> drizzle/NNNN_*.sql (review the SQL!)
pnpm --filter web db:migrate    # apply; also runs from `pnpm start` on deploy
pnpm --filter web db:check      # assertions against a THROWAWAY db (it truncates)
```

- Migrations run at **startup**, from the `start` script, guarded on
  `DATABASE_URL` being set — an unset URL still degrades comments to
  read-empty/503 rather than blocking boot. Never issue DDL from a request
  handler; `coin_comments` used to be created that way and it left the table
  with no migration history.
- `drizzle/0000_coin_comments_baseline.sql` is hand-edited to `IF NOT EXISTS`
  because production already had the table before Drizzle existed. That is a
  one-off adoption fix — **do not** edit generated SQL in later migrations.
- Never run `db:push` against a deployed database. `generate` + `migrate` only.
<!-- END:database -->
