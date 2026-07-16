# Design Tokens: launchpad (Arcane)

**Derived from:** the Arcane brand direction in the plan (`docs/plans/2026-07-15-001-...-plan.md`,
"Design Direction & UI Inspiration") — mystical-degen, **dark-first**. Not a named philosophy from
`/frontend-design`; this is a bespoke degen-neon system.

**Where the tokens live (consumable):** `packages/ui/src/styles/globals.css` — extended, not replaced.
The scaffold's shadcn **base-nova** semantic variables are overridden with the Arcane palette in OKLCH,
so every shadcn component inherits the theme with zero per-component work. Brand-semantic tokens are
added on top and exposed as Tailwind utilities via the `@theme inline` block.

## Choices & deviations

- **OKLCH, not hex.** Matches the scaffold's existing format and gives perceptually even hover/active
  steps. Hex targets from the brief were converted (e.g. base `#0A0A0F` → `oklch(0.14 0.012 285)`,
  violet `#8B5CF6` → `oklch(0.65 0.2 293)`, magenta `#EC4899` → `oklch(0.66 0.24 350)`, acid green
  `#4ADE80` → `oklch(0.82 0.19 148)`).
- **Dark is the default, `:root` is light.** The product ships dark; `.dark` carries the real Arcane
  theme and `:root` is a faithful daytime variant (deeper accents for contrast on white). Toggled by
  next-themes via the `.dark` class — so no `[data-theme]`/media-query block (next-themes owns that).
  **Unit 3 should set next-themes `defaultTheme="dark"`.**
- **Chunky radius.** `--radius: 1rem` (up from 0.625) for the rounded-2xl button/card feel; the
  `radius-*` scale derives from it.
- **Two accent identities, kept distinct:** violet `--primary`/`--arcane` = identity/links/focus;
  magenta `--summon` = the launch CTA only. Don't blur them.

## Token map

| Group | Tokens | Notes |
|---|---|---|
| Surfaces | `--background`, `--card`, `--popover`, `--secondary`, `--muted` | Near-black → elevated violet-tinted panels (dark). |
| Text | `--foreground`, `--muted-foreground`, `--*-foreground` pairs | Softened white in dark (not pure #fff). |
| Identity | `--primary`, `--arcane`, `--ring` | Arcane violet. Focus ring is violet. |
| Market meaning | `--gain` (acid green), `--loss` (red), `--warning` (amber) | `--warning` = exit-liquidity / price-impact callouts. |
| Launch CTA | `--summon` (hot magenta) + `--summon-foreground` | Reserve for the Summon action. |
| Graduation | `--ascend` | Progress toward Ascension; = gain green. |
| Charts | `--chart-1..5` | violet → magenta → green → amber → blue. |
| Effects | `--glow-arcane`, `--glow-summon`, `--gradient-arcane`, `--shadow-sm/md/lg` | Signature violet→magenta gradient; soft glows for hover. |
| Type | `--font-sans` (Inter), `--font-display` (Clash Display/Space Grotesk), `--font-mono` (Geist Mono/JetBrains Mono) | next/font overrides these in Unit 3; stacks are fallbacks. |
| Radius | `--radius` + `--radius-sm..4xl` | Chunky. |

## Usage rules

- **Numbers are always mono.** Apply the `.tabular` helper (defined in `globals.css`) to every price,
  market cap, %, and balance — mono + `tabular-nums` so figures align. Format values with viem
  `formatUnits`/`formatEther`, never hand-rolled.
- **Semantic over raw.** Components use `bg-summon`, `text-gain`, `text-loss`, `border-warning`,
  `bg-primary`, etc. — never hardcode hex/oklch. New brand tokens generate utilities automatically via
  `@theme inline`.
- **Effects via vars:** `box-shadow: var(--glow-summon)` on the launch button; `background:
  var(--gradient-arcane)` for hero/summon surfaces.
- **Gain/loss are meaning, not decoration** — only use them for actual up/down market state.

## Next

Fonts must be wired with next/font in **Unit 3** (set `--font-sans`, `--font-display`, `--font-mono`
and `defaultTheme="dark"`). A grain/noise texture overlay (brief) is a component concern, not a token —
add as a utility/overlay component when building the app shell.
