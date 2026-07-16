# Information Architecture: Arcane Launchpad

> Degen/playful memecoin launchpad on Robinhood Chain (4663). Brand "Arcane" — mystical-degen:
> launching a token is a **Summon**, earned fees are **Spoils**, buying through the curve is **Ascension**.
> Stack: Next.js App Router (`apps/web/app/`) + shadcn/Tailwind, viem-only. Source of truth for
> product scope: `docs/plans/2026-07-15-001-feat-launchpad-web-app-plan.md`.

## Site Map

- **Landing** `/` — marketing hero, what/why, live stats ticker, primary CTA → Explore, secondary CTA → Summon
- **Explore** `/explore` — the market: token grid + "Just Summoned" rail, search/sort/filter
- **Summon** `/summon` — create-a-token stepper (image → identity → dev-buy → predicted address → sign)
- **Token** `/token/[address]` — detail + trade: price, chart, buy/sell, graduation, holders, activity
- **Portfolio** `/portfolio` — the "my stuff" hub (wallet-gated)
  - **Holdings** `/portfolio` — tokens the connected wallet holds (default tab)
  - **Rewards** `/portfolio/rewards` — claimable LP fees; collect + claim
  - **Created** `/portfolio/created` — tokens this wallet launched
- **Leaderboard** `/leaderboard` — top coins / creators (vlad-inspired; Phase 2)
- **Not found / wrong network** — handled by layout states, not routes

> **Voice:** lowercase-degen (vlad.fun / pump.fun register). Controls read `[ create a coin ]`,
> `now trending`, `sort: 🔥`. The earlier mystical framing (Summon / Ascension / Spoils) is dialled
> back to plain degen terms: **create**, **graduation / graduated**, **rewards**. The `collect` vs
> `claim` distinction stays (it's two real transactions), just lowercased.

Deliberately excluded from v1 (see plan Scope Boundaries): admin console, docs/FAQ (link out), settings.

## Navigation Model

Structure follows vlad.fun / pump.fun: a **collapsible left sidebar** for nav and a **persistent live
activity ticker** across the top, rather than a top nav bar.

- **Primary navigation** — **left sidebar** (desktop), collapsible to icons-only:
  - lowercase items: `explore` · `create` · `portfolio` · `leaderboard`, an emphasized
    `[ create a coin ]` CTA (magenta gradient), and a `follow us on 𝕏` link at the bottom.
  - The `arcane` wordmark sits at the sidebar top (collapses to `a.`).
- **Top bar** — a slim sticky header holding the **live activity ticker** (streaming buys + launches,
  e.g. `0x265…e326 bought 0.42 eth of $PEPE`, `0xf5c…fabf created $WAGMI 1m ago`), a
  **search / paste-a-contract** field, and the **Connect** button.
- **Secondary navigation**:
  - **Portfolio** uses tabs: Holdings / Rewards / Created (path segments, shareable).
  - **Token page** uses in-page anchored sections/tabs (Chart · Trade · Holders · Activity), not routes.
  - **Explore** uses a filter/sort bar (chips: `newest` / `market cap` / `almost graduated`, `sort: 🔥`).
- **Utility navigation**:
  - Wallet menu (address, balance, disconnect), **network guard** (prompt to switch to 4663 when on the
    wrong chain), and a footer (contract addresses on the explorer, socials, "not audited" notice).
- **Mobile navigation**:
  - Sidebar is hidden; a **bottom tab bar** shows the 3 primary tabs: explore · **create** (center,
    emphasized CTA) · portfolio. Leaderboard is sidebar-only.
  - Connect lives in the top bar; the network-switch prompt is a sticky banner.
  - Token page trade panel becomes a sticky bottom sheet.

## Content Hierarchy

### Landing `/`
1. **Hero + primary CTA** — one-line pitch ("Summon a coin. Liquidity locked forever.") and "Enter App" → `/explore`. The whole reason the page exists.
2. **Trust-at-a-glance** — the un-ruggable hook: LP locked forever, no mint, no admin over your token. This is the differentiator; say it immediately.
3. **Live proof** — a "Just Summoned" ticker + headline stats (tokens summoned, total volume). Shows the thing is alive.
4. **How it works** — 3 steps (Summon → Ascend → Spoils). Secondary.
5. **Footer** — addresses, socials, risk/"not audited" disclaimer.

### Explore `/explore`
1. **"Just Summoned" rail** — horizontally-scrolling newest launches, live. The dopamine hook up top.
2. **Filter/sort bar** — sort (Newest · Market cap · Almost Ascended) + search. Controls the grid below.
3. **Token grid** — cards: image, name/symbol, market cap (mono), **graduation meter**, holders, quick-buy. The 80%-of-time content.
4. **Load more / pagination** — infinite scroll; keep it out of the way.

### Summon `/summon`
1. **Stepper progress** — where you are (Identity → Image → Dev-buy → Review). Orientation first.
2. **Active step form** — one decision at a time; large inputs.
3. **Live predicted address + preview card** — `predictTokenAddress` result shown as the card it'll become. Makes it feel real before signing.
4. **Cost/risk summary + Summon button** — dev-buy amount, cap warning if over `maxDevBuyBps`, gas note, sign.

### Token `/token/[address]`
1. **Identity + price** — image, name/symbol, big mono price, 24h change, market cap. Who/what/how-much.
2. **Trade panel** — buy/sell, quick-amount chips, slippage, **exit-liquidity/price-impact warning** (this curve has ~6.9 WETH total exit). Primary action; sticky on desktop, bottom-sheet on mobile.
3. **Graduation meter** — progress along the curve toward Ascension (current tick → `tickUpper`).
4. **Chart** — price history (Phase 2 full OHLC; Phase 1 sparkline/last-trades).
5. **Holders + Activity** — distribution and recent swaps. Below the fold.
6. **Provenance/links** — creator, locked-position + pool on the explorer, metadata. Reassurance, secondary.

### Portfolio `/portfolio` (+ tabs)
1. **Wallet summary** — connected address, total value, quick "claim all spoils" if any pending.
2. **Tab content**:
   - **Holdings** — tokens owned, balance, value, link to each token page.
   - **Spoils** — per-token claimable fees, `collectFees` (top up) + `claim`/`claimMany` (withdraw), with the collect-then-claim split explained in plain language.
   - **My Summons** — tokens you launched, each with its market state and its creator fee stream.

## User Flows

### Discover → Trade (the core loop)
1. User lands on `/explore` (or arrives from Landing CTA).
2. Sees the "Just Summoned" rail + grid; sorts/searches.
3. Clicks a card → `/token/[address]`.
4. Reviews price + graduation + **exit-liquidity warning**.
5. Enters a buy amount (or quick-chip) → sees quote/impact.
   - If wallet disconnected → prompt Connect.
   - If on wrong chain → prompt Switch to 4663.
   - If quote fails / range exhausted at `tickUpper` → buy disabled with reason.
6. Signs `exactInputSingle` (WETH→token) → balances + price bar update.

### Summon a token
1. User clicks `Summon` (nav or center CTA).
   - If disconnected/wrong chain → gate with Connect/Switch first.
2. Steps through Identity (name/symbol) → Image (upload → `metadataURI`) → optional Dev-buy (quick chips).
   - If dev-buy exceeds `maxDevBuyBps` → inline block before signing.
3. Sees **live predicted address** and the card preview.
4. Signs `deploy(config)` with `msg.value`.
   - On success → confetti/"summon" burst → deep-link to `/token/[newAddress]`.
   - Indexer picks up `TokenLaunched`; token appears in Explore + My Summons.

### Claim Spoils (fees)
1. User opens `/portfolio/spoils`.
2. Sees claimable balances per token (indexer `feeBalance`, verified against on-chain `availableFees`).
   - Optional: `collectFees(tokenId)` first to sweep fresh fees from the locked position into the escrow.
3. `claim(token)` or `claimMany(tokens)` → tokens sent to wallet → rows zero out.
   - Zero-balance tokens are skipped, not errored (matches contract behavior).

### Connect / Network guard (cross-cutting)
1. Any write action while disconnected → Connect Wallet modal.
2. Connected but chain ≠ 4663 → persistent "Switch to Robinhood Chain" prompt; writes disabled until switched.

## Naming Conventions

| Concept | Label in UI | Notes |
|---|---|---|
| Launch a token | **Summon** | Core brand verb; nav item and CTA. |
| The create flow | **Summon** (page) | `/summon`. |
| Newly launched tokens | **Just Summoned** | Explore rail + Landing ticker. |
| Buying through the curve | **Ascension** / "Ascending" | Progress language; the meter = graduation toward `tickUpper`. |
| The graduation point (~6.9 WETH bought through) | **Ascended** | Fully bought-through state. |
| Earned LP fees | **Spoils** | Portfolio tab; the claimable stream. |
| Move fees from position → escrow | **Collect** | Maps to `LpLocker.collectFees`. |
| Withdraw fees escrow → wallet | **Claim** | Maps to `FeeLocker.claim` / `claimMany`. Keep Collect vs Claim distinct. |
| Tokens you launched | **My Summons** | Portfolio tab. |
| Tokens you hold | **Holdings** | Portfolio tab. Plain word on purpose. |
| Connect wallet | **Connect** | Standard; don't get cute here. |
| Total supply / market cap / price | shown in **monospace** | Numbers are data — always mono, never restyled per screen. |

> Rule: pick one word per concept and use it everywhere. **Collect ≠ Claim** — never blur them; they are
> two different transactions with different effects.

## Component Reuse Map

| Component | Used on | Behavior differences |
|---|---|---|
| `AppHeader` (nav + Connect + network guard) | all app pages | Lighter variant on Landing (logo + Enter App + Connect only). |
| `MobileTabBar` | all app pages (mobile) | Center Summon CTA emphasized; hidden on Landing. |
| `TokenCard` | Explore grid, Just Summoned rail, Portfolio (Holdings, My Summons) | Compact variant in the rail; owner-context (fee stream) on My Summons. |
| `GraduationMeter` | TokenCard, Token page, Summon preview | Same tick→progress math from `packages/contracts`; sizes differ. |
| `TradePanel` | Token page | Sticky (desktop) vs bottom-sheet (mobile). |
| `WalletGate` / `NetworkGuard` | Summon, Portfolio, any write | Blocks the action, prompts Connect/Switch. |
| `NumberDisplay` (mono, formatted) | everywhere numbers appear | Consistent decimals/units via viem `formatUnits`. |
| `AppFooter` | Landing + app | Addresses/explorer links + risk notice. |

## Content Growth Plan

- **Explore** is the main growth surface — token count grows unbounded. Handled by: server-side sort/filter
  from the indexer, infinite-scroll pagination, and search. "Just Summoned" rail is bounded (latest N).
- **Token page activity/holders** grow per token — paginated, most-recent-first, backed by indexer.
- **Portfolio** grows with the user's activity — paginated per tab; "claim all" scales via `claimMany`.
- **Landing stats** are aggregate counters from the indexer — fixed layout, changing numbers.
- No CMS. All dynamic content comes from the Ponder indexer API + on-chain reads; metadata images from Blob.

## URL Strategy

- **Pattern**: flat, resource-first. `/explore`, `/summon`, `/token/[address]`, `/portfolio[/tab]`.
- **Dynamic segments**:
  - `[address]` — the launched ERC20 address (checksummed viem `Address`), canonical id for a token.
  - Portfolio tabs as **path segments** (`/portfolio`, `/portfolio/spoils`, `/portfolio/summons`) so a tab
    is shareable/bookmarkable.
- **Query parameters** (Explore only, all optional, shareable filter state):
  - `?sort=new|mcap|ascending` · `?q=<search>` · pagination via cursor (`?cursor=`).
- **No wallet address in the URL** — Portfolio is always "the connected wallet." (A public
  `/creator/[address]` profile is a Phase 2 addition if needed.)
- Token page is the shareable unit — canonical, SEO/OG-friendly (name, symbol, image from metadata).

---

## Note for the plan / build

The scaffold routes live at `apps/web/app/` (not `apps/web/src/app/`). The plan's file paths should be
corrected to `apps/web/app/...` accordingly. This IA adds two things beyond the plan's four surfaces: a
**marketing Landing** at `/` (Explore moves to `/explore`) and a **Portfolio hub** that absorbs the
plan's Unit 7 "Fees" as its Spoils tab and adds Holdings + My Summons.
