---
date: 2026-07-22
topic: arc-production
---

# berth.club on Arc — production

## Problem Frame

berth.club's contracts are deployed on Arc testnet (5042002) by the contract
developer, from `Arcane-build/arc-launchpad`. The frontend is partially rewired
to them and cannot launch a coin. The live site
(`bridgedotclub-web-production.up.railway.app`) still serves a Robinhood build
from 17 July, because Railway deploys from `main` and every Arc change is
uncommitted.

Goal: a push-ready Arc build, proven end-to-end against the deployed contracts,
so that publishing is one push. **The stale-production symptom above is NOT
fixed this round** — going public is a separate, later decision.

## Architecture

```
browser ──1. mine vanity salts (Web Worker) ─────────────┐
        └─2. deploy(config, curveId, salts[]) ──────► LaunchFactory 0xb7738F…
                                                          │ creates token+pool,
                                                          │ locks LP, dev-buys
                                                          ▼
        ┌──────────── reads ──────── Ponder indexer ◄── TokenLaunched / Swap
        ▼                                  │
   Next.js app ─── trades ──────────► SwapRouter02 0xB5D2…
                                       (approve + exactInputSingle, no wrap)
```

## Requirements

**Launching (the critical path)**

- R1. A creator can launch a coin end to end from the wizard, against the
  deployed contracts.
- R2. The wizard mines vanity salts in the browser without freezing the UI, and
  shows progress. Every token address must end in `8787` or the factory reverts.
- R3. Salts are mined against `tokenInitCodeHash(config)` read live from the
  chain, and against the connected wallet. Both are inputs to the address, so
  salts are invalidated and re-mined whenever the config or the wallet changes.
- R4. Several candidate salts are submitted, not one, so a squatted pool cannot
  brick a launch. The factory accepts up to 32 and uses the first free one.
- R5. Before signing, the creator sees the actual address their coin will land
  on, and is told if no candidate is usable rather than being left to a revert.

**Trading and display**

- R6. Buying and selling both work against the deployed pools. Both directions
  need an allowance first — the quote asset is an ordinary ERC20.
- R7. Dollar figures are derived from the curve config read from the deployed
  factory, not from constants. Against preset 0 today that reads ~$4,923 opening
  market cap and $20,000 graduation. The ~$100 dev-buy cap is *derived*
  (`openingMcap x bps/(1-bps)`), not readable on-chain, so it is shown as
  approximate and the on-chain simulation — not that number — blocks signing.
  The admin can rewrite the preset at any time; these are today's readings.
- R8. On the four surfaces this round rewires — launch wizard, token page, trade
  panel, harbor list — no figure is fabricated: an unavailable value renders as a
  dash. A genuine zero renders as 0; a stale figure is marked stale rather than
  silently shown, so a dead indexer cannot look like "nobody is trading".
- R8b. Coin-supplied strings (name, symbol, everything parsed from metadataURI)
  are untrusted and permanent. They are length-capped, rendered as text, and any
  URI derived from them is scheme-allowlisted before use.

**Indexing**

- R9. The indexer reads the deployed factory from its deploy block and reflects
  launches, trades, holders and fee balances within roughly a minute.
- R10. A launch with a dev buy shows the price the dev buy produced, not the
  opening price, **and** counts it in volume, swap count and the activity feed.
  The dev-buy swap is emitted *before* the event that reveals the pool, so an
  events-only indexer silently misses it — verified in the deployed contract's
  `deploy()` ordering. Both the price and the trade row must be synthesised at
  launch rather than recovered from the log.
- R10b. Graduation progress comes from the factory's `graduationStatus()`, never
  from tick position. Graduation is an owner-set USDC threshold on paired
  principal; the range runs to MAX_USABLE_TICK, so a coin that has genuinely
  graduated sits ~2.4% along its tick range. A tick-based bar reads 2% at the
  finish line and never flips.
- R11. Indexing survives unattended. The public Arc RPC has already killed it
  three times (73s timeouts on `eth_getLogs`).

**Deployment**

- R12. The Arc build is committed, and the exact Railway change set for both
  services — env var names and values, and a fresh indexer namespace — is written
  down and checked against the code paths that read it. **Nothing is applied to
  the live Railway project**: changing a variable triggers a redeploy of the
  currently-deployed Robinhood build, which would take production down during a
  round that promised not to touch it. That the Railway build succeeds is
  explicitly UNVERIFIABLE this round; the first push is an unproven step and
  needs its own rollback plan.
- R13. The Railway configuration needed to go live is worked out and written
  down — env vars for both services, and a clean indexer namespace so Arc data
  cannot collide with the Robinhood-era rows already in Postgres.

## Success Criteria

- A tester who did not build it, with faucet USDC, launches a coin through the
  wizard and sees it appear in the harbor within a minute. **The access
  mechanism must be named** (tunnel with its origin added to the Privy allowlist,
  or a screen-shared local session with the tester driving their own wallet) —
  otherwise this silently degrades to "we tested it ourselves".
- A second party buys it, and price, volume, holder count and graduation
  progress all move.
- For one launched coin, every dollar figure in the UI is reconciled
  digit-for-digit against values computed independently from on-chain reads.
  Not "off by 1e12" — that tests only the last bug found; a 4x curve error or a
  1e6 native/ERC20 mix-up passes it.
- The indexer runs 24 hours unattended without dying, against whatever RPC is in
  place, with crashes recorded rather than silently restarted.

## Scope Boundaries

- **Arc testnet only.** Arc mainnet (5042) is live and its Uniswap stack is
  deployed, but it is explicitly out of scope.
- **No contract changes.** We consume the dev's deployment as-is. The vanity
  requirement is theirs and is not negotiable from our side.
- **No testnet disclosure work.** Considered and declined (see Key Decisions).
- **No custom domain.** The Railway URL is retained, so no DNS or Privy
  allowlist work. Deferred, not rejected.
- **No push and no deploy.** Work is committed locally only. Publishing is a
  separate, explicit decision.
- **No Postgres credential rotation.** Considered and declined this round.
- **Coin image upload stays unmerged.** It lives on `feat/coin-image-upload` and
  is not part of this push, so social cards stay bare.

## Key Decisions

- **Full launch + trade on day one**, not a trade-only or read-only first cut.
  A launchpad that cannot launch is not the product.
- **Salt mining is required, not chosen.** `VANITY_SUFFIX` is a Solidity
  `constant` in deployed bytecode with no admin toggle, so `deploy()` reverts
  without valid salts. The cost is ~65,536 hashes per salt (~1s measured).
- **`arc-launchpad` is the source of truth.** ABIs are generated from it and
  checked against deployed bytecode. The earlier local Arc port of
  `launchpad-contracts`, and the test factory deployed from it, are abandoned.
- **No testnet disclosure banner.** Raised twice, declined twice. The accepted
  risk, described accurately: the app labels faucet balances **"USDC"** —
  Circle's own product name, on Circle's own chain — beside dollar-denominated
  market caps. The footer chain id is not a usable signal, since testnet 5042002
  and live mainnet 5042 are a digit-group apart. A visitor cannot distinguish
  this from a real-money launchpad. Only a *banner* was ever priced; the
  one-line options (the word "testnet" in the page title, `tUSDC` on balance
  labels, a faucet link the audience needs anyway) were never considered.
- **Paid RPC is in scope**; custom domain and credential rotation are not.
- **Local commits only.** Railway deploys from `main`, so this round ends with
  the work committed and provably ready rather than live. That is deliberate:
  the last few sessions surfaced silent, expensive bugs (a stale event topic, a
  wrong quote asset, a 1e12 price error), and the diff touches the whole app.

## Dependencies / Assumptions

- The factory admin is the contract developer's key
  (`0x6F1313f206dB52139EB6892Bfd88aC9Ae36Dc54E`), not ours. Two consequences:
  the fee split is **50/50**, not the 90/10 chosen earlier, and only they can
  change it. Each launch freezes its own split permanently, so if 90/10 is still
  wanted it must be set **before the first real launch**.
- Railway deploys from `main`. With local-commits-only, production stays on the
  17 July Robinhood build until a later push is authorised.
- A paid RPC endpoint must be purchased before R11 can be met — and it is not
  established that any commercial provider serves Arc **testnet** 5042002. Verify
  availability before planning depends on it. Separately, resilience is a
  property of the consumer: bounded `eth_getLogs` ranges, backoff, and
  checkpointed resume are needed whichever endpoint is used.
- The ported miner adds one direct dependency to `apps/web`: `@noble/hashes`
  **v2** (`@noble/hashes/sha3.js`). The workspace resolves only v1.x transitively
  under viem, where the subpath has no `.js`. A deliberate exception to the
  viem-only convention: the hot loop must hash raw byte arrays, and routing it
  through viem costs ~2.8x.
- Verified on-chain, so R1 is not gated: `whitelistEnabled` is false and
  `launchFee` is 0 on the deployed factory. Both are admin-only setters on the
  developer's key and could change without notice.
- The admin key can also rewrite the curve preset, pause the factory, toggle the
  whitelist and redirect fees. The app needs an explicit paused/whitelisted state
  rather than a bare revert, and must read curve params live.

## Outstanding Questions

### Resolve Before Planning

None — both resolved: Railway URL retained, local commits only.

### Deferred to Planning

- [Affects R2][Technical] Does Turbopack resolve a TypeScript Web Worker entry?
  If not, the miner ships as a prebuilt file in `/public`.
- [Affects R2][Technical] Device baseline: the ~1s figure is one desktop core,
  unbundled ESM, one salt. The audience is mobile, and candidates multiply it.
- [Affects R3][Technical] Under Privy, is `msg.sender` always the displayed
  address? A smart account or relayer would invalidate every mined salt.

- [Affects R2][Technical] Worker count and candidate count — enough spares to
  resist squatting without making the user wait.
- [Affects R2][Technical] The reference miner must stay ESM; bundled to CommonJS
  it degrades ~4.8x. Needs verifying under the app's bundler.
- [Affects R11][Needs research] Which paid provider, and whether Ponder needs
  further rate-limiting alongside it.
- [Affects R13][Technical] Fresh `DATABASE_SCHEMA` versus a separate database.
- [Affects R9][Technical] Whether the indexer's Robinhood-era column names and
  handlers need more than the known quote-asset and event-shape changes.

## Next Steps

→ `/ce:plan` for structured implementation planning.
