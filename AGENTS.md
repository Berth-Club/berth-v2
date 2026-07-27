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
