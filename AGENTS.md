> New here? Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first for the big
> picture (what the app is, how web/indexer/contracts/DB fit together, how to run,
> test, and deploy). This file is the strict conventions + tripwires.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:contracts-and-abis -->
# Contract addresses, ABIs, and the indexer

The launchpad contracts are developed in a separate repo (`arc-launchpad`,
github.com/Arcane-build/arc-launchpad). This repo *consumes* them. Two things
drift silently and cause real outages if you get them wrong, so they have
strict conventions.

## Addresses — one source of truth

**All on-chain addresses live in `@workspace/contracts`** (`packages/contracts/src/index.ts`):
`CONTRACTS` (launchFactory / lpLocker / feeLocker), `START_BLOCK`, `CHAIN_ID`.
Both the web app (`apps/web/lib/chain.ts`) and the indexer
(`apps/indexer/ponder.config.ts`) import from it.

- **Never** hard-code an address in app code, and **never** add
  `NEXT_PUBLIC_LAUNCH_FACTORY` / `LAUNCH_FACTORY` / `START_BLOCK` env vars back.
  The web env once pointed at the old factory while the indexer watched the new
  one; launches landed on a contract nothing indexed. The package exists so the
  two can never diverge.
- A new deployment = edit `packages/contracts/src/index.ts`. That's it. Both
  services redeploy on it (see railway.json watch patterns below).

## ABIs — generated, never hand-edited

Frontend ABIs (`apps/web/lib/abis/*.ts`) and the indexer's event ABIs
(`apps/indexer/abis/berth.ts`) are **generated from `arc-launchpad/abi/*.json`**,
the source of truth. Do not hand-edit them. On a contract change, pull the new
`arc-launchpad` and regenerate the `.ts` from the JSON (keep the AUTO-GENERATED
header). The header pins *which contract interface*, not an address — addresses
live in the package.

## The indexer event shape is load-bearing

Ponder filters logs by **topic0 = keccak of the event's type signature**. If
`ponder.config.ts`'s `TokenLaunched` `parseAbiItem` (and the matching entry in
`abis/berth.ts`) is off by a single field/type, topic0 changes, and the indexer
matches **zero launches with no error** — indistinguishable from "nobody has
launched yet". After any contract-event change, verify the signature against a
real on-chain log (`cast keccak "TokenLaunched(...)"` vs the deployed factory's
log topic0) before assuming it works.

## Arc's public RPC caps eth_getLogs at ~20 ADDRESSES

The launchpad watches every pool a launch creates via a `factory()` source, so
ponder sends the whole discovered address list in one `eth_getLogs`. Arc's public
endpoint rejects a list longer than about 20 (measured: 20 passes, 24 fails) and
every launch adds one, so this is a limit the project grows into.

The failure is nasty because the error lies. Arc reports the address-count limit
as `"requested range too large"`. Ponder reads that as a BLOCK range problem and
halves the range, which can never help, so it shrinks 500 -> 25 -> 1 and stalls
at a fixed percentage forever with no error.

**The fix is `PONDER_FACTORY_ADDRESS_THRESHOLD`.** Above that many child
addresses ponder drops the address list and queries by topic0 alone, filtering
client-side (`sync-historical/index.ts:494`). Upstream hardcodes the threshold to
`1000` in BOTH 0.16.10 and 0.17.9 with no env override, so
`patches/ponder@0.16.10.patch` makes it configurable. Keep the value BELOW the
number of launched pools or every log query fails again.

Measured on the public RPC: topic-only returns 996 logs for a 5000-block span in
1s; the 44-address form fails at any span, even a single block.

**If you upgrade ponder, re-apply the patch** and re-check that
`factoryAddressCountThreshold` still gates the same branch.

## The `factory()` bloom trap — never add an ERC20 Transfer source

**Do not add a ponder `factory()` source whose event is ERC20 `Transfer`.** It
cost this project a multi-day indexer outage and it fails in a way that looks
like nothing is wrong.

Ponder normally skips `eth_getLogs` for a block whose bloom filter cannot hold
your events. A `factory()` source defeats that skip: the child addresses are
unknown when the filter runs, so the address half of the match is forced true
and matching collapses to **topic0 alone**. topic0 for `Transfer` is carried by
nearly every block on a live chain, so the indexer pulls the logs of *every*
block — the whole chain's ERC20 traffic, by everyone — to observe the handful of
transfers our own tokens have had.

On Arc that is not merely expensive, it is fatal:

- The public RPC caps `eth_getLogs` at **~20 addresses** (measured: 20 passes, 24
  fails). Every launch adds one child address, so past ~20 coins every log query
  fails outright — a limit you grow into, not an outage.
- It reports that address-count limit as `"requested range too large"`. Ponder
  reads that as a *block* range problem and shrinks the range, which can never
  help. It shrinks 500 → 25 → 1, still fails, and **stalls at a fixed percentage
  forever with no error**.

Holder data now comes from Arcscan (Blockscout) in `apps/web/lib/holders.ts`, not
from the indexer. Keep it that way. The indexer keeps only what it is uniquely
good at: launches, trades, and fees.

**Related: there is no RPC request cap.** `maxRequestsPerSecond` is `@deprecated`
in ponder 0.16 and does nothing — the `50` that used to sit in `ponder.config.ts`
typechecked and was ignored. The only real lever is keeping the per-block
workload small.

## Deploying a new contract version — checklist

1. Bump addresses + `START_BLOCK` in `packages/contracts/src/index.ts`.
2. Pull `arc-launchpad`, regenerate the ABIs; if `deploy`/`predictTokenAddress`
   args or any indexed event changed, update the call sites and
   `ponder.config.ts` event to match.
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
