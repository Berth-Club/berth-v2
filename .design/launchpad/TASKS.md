# Build Tasks: Arcane Launchpad

Generated from: `.design/launchpad/` (DESIGN direction in `docs/plans/2026-07-15-001-...-plan.md`,
`INFORMATION_ARCHITECTURE.md`, `DESIGN_TOKENS.md`)
Date: 2026-07-15

**Philosophy:** Arcane — mystical-degen, dark-first. Established in the first Foundation task.
**Build strategy:** These are **UI vertical slices built against mock/fixture data**. Live data +
transactions are the plan's engineering units (Unit 1 bindings, Unit 2 indexer, Unit 3 wallet) — noted
as dependencies where a slice later gets wired. Routes live under `apps/web/app/` (App Router).
**Existing to reuse:** `packages/ui` shadcn base-nova primitives (only `button.tsx` so far), design
tokens in `packages/ui/src/styles/globals.css`, `next-themes`, `lucide-react`.

## Foundation

- [x] **App shell + Arcane theme**: Wire fonts via `next/font` (Inter → `--font-sans`, Clash Display/Space Grotesk → `--font-display`, Geist Mono → `--font-mono`) in the root layout; set `next-themes` `defaultTheme="dark"`; build `AppHeader` (logo, `Explore/Summon/Portfolio` nav, Connect slot) + `AppFooter` (addresses/explorer links, "not audited" notice). Establishes the dark neon aesthetic immediately. _New components; reuses tokens + button._
- [x] **Shared number + status primitives**: `NumberDisplay` (mono `.tabular`, formats via viem `formatUnits`/`formatEther` — mock values for now), `StatusPill`, and a `GlowButton`/summon-CTA variant (magenta `--summon` + `--glow-summon`). _New components._ _Later wiring: viem formatting (plan Unit 1)._
- [x] **GraduationMeter**: Progress bar from current tick → `tickUpper` (Ascension), with `--ascend` fill and an "Ascended" state. Pure/presentational; takes a 0–1 progress prop. _New component; reuses tick math from plan Unit 1 later._
- [x] **TokenCard**: The core discovery unit — image, name/symbol, market cap (`NumberDisplay`), `GraduationMeter`, holder count, quick-buy button. Compact variant for the rail; owner variant (fee stream) for My Summons. _New component; reused across Explore, rail, Portfolio._

## Core UI

- [x] **Explore page (`/explore`)**: "Just Summoned" horizontal rail (compact `TokenCard`s) + filter/sort bar (chips: Newest / Market cap / Almost Ascended, search) + responsive token grid. Mock token fixtures. _Depends on: TokenCard. Later: indexer queries (plan Unit 2/5)._
- [x] **Token detail + trade page (`/token/[address]`)**: Identity + big mono price + 24h change, `GraduationMeter`, `TradePanel` (buy/sell toggle, quick-amount chips, slippage control, **exit-liquidity/price-impact warning** using `--warning` — this curve has ~6.9 WETH total exit), chart placeholder, holders + activity lists, provenance/explorer links. Mock data. _Depends on: GraduationMeter, NumberDisplay. Later: QUOTER_V2 quotes + SwapRouter02 swap (plan Unit 6, no deadline field)._
- [x] **Summon stepper (`/summon`)**: Multi-step flow — Identity (name/symbol) → Image (drop/upload) → Dev-buy (quick chips + inline cap warning when over `maxDevBuyBps`) → Review with **live predicted-address preview card** (the `TokenCard` it will become) → Summon button. Mock predict + submit. _Depends on: TokenCard, GlowButton. Later: metadata upload + predictTokenAddress + deploy() (plan Unit 4)._
- [x] **Portfolio hub (`/portfolio` + tabs)**: Tabbed layout — Holdings (owned `TokenCard`s), **Spoils** (per-token claimable rows with **Collect** and **Claim** as two visually-distinct actions + plain-language explainer), My Summons (owner `TokenCard`s). Mock balances. _Depends on: TokenCard, NumberDisplay. Later: availableFees read + collectFees/claim (plan Unit 7)._
- [ ] **Landing page (`/`)**: Hero with `--gradient-arcane` + one-line pitch and "Enter App" CTA → `/explore`, the un-ruggable trust points (LP locked forever, no mint, no admin over your token), a live "Just Summoned" ticker, and a 3-step "How it works" (Summon → Ascend → Spoils). _Reuses: TokenCard (ticker), tokens._

## Interactions & States

- [ ] **Wallet + network gating**: `WalletGate` (prompt Connect on any write action) and `NetworkGuard` (persistent "Switch to Robinhood Chain 4663" banner; writes disabled off-chain) as reusable wrappers, with their visual/empty states. _New components. Later: wagmi/RainbowKit wiring (plan Unit 3)._
- [ ] **Loading / empty / error states**: Skeletons for grid + token page, zero-states (no launches, nothing to claim), and error surfaces (quote failed, range exhausted at `tickUpper`, tx revert → human message). Covers: loading, empty, error across Explore, Token, Portfolio.
- [ ] **Motion pass (framer-motion)**: Install framer-motion. Number tickers, card hover lift + glow, live-updating "Just Summoned" rail, and the **summon confetti/burst** on successful launch. Respect `prefers-reduced-motion`. _New dependency: framer-motion._

## Responsive & Polish

- [ ] **Responsive pass**: Mobile bottom tab bar (Explore · Summon center-CTA · Portfolio), sticky `TradePanel` bottom-sheet on token page, grid/rail breakpoints. Breakpoints: sm 375 / md 768 / lg 1024 / xl 1280.
- [ ] **Accessibility pass**: Violet focus rings visible on all interactive elements, contrast check on neon-on-dark (esp. `muted-foreground`, gain/loss), keyboard nav through stepper + trade panel, reduced-motion honored, alt text on token images.

## Review

- [ ] **Design review**: Run `/design-review` against the brief once screens are built.
