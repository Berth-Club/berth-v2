"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { formatUnits } from "viem"

import { cn } from "@workspace/ui/lib/utils"
import { CoinAvatar } from "@/components/coin-avatar"
import { fmtAmount } from "@/lib/format"
import { useFx } from "@/components/fx-provider"
import { useWallet } from "@/components/wallet-provider"
import { useTrade, SLIPPAGE_CHOICES, DEFAULT_SLIPPAGE_BPS, type Side } from "@/lib/trade"
import { explorerTx, USDC, COIN_DECIMALS } from "@/lib/chain"
import type { Coin } from "@/lib/coin"

// ~8,787 USDC buys through the whole range -- the graduation threshold read
// from the deployed factory's curve preset 0 (getCurveConfig(0) => -439000,
// 8787e6). Not a constant of the system: the factory admin can rewrite the
// preset, so treat this as today's reading.
const EXIT_NATIVE = 8787
const PERCENTS = [25, 50, 75, 100] as const

/** USDC amounts are small and precision matters — no compact notation. */
function fmtUsdc(n: number): string {
  if (n === 0) return "0"
  if (n < 0.000001) return "<0.000001"
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 })
}

/** Three pulsing dots — the "quoting" placeholder while a swap quote loads. */
function Dots() {
  return (
    <span className="inline-flex items-center gap-1.5 align-middle" role="status" aria-label="quoting">
      {[0, 160, 320].map((d) => (
        <span
          key={d}
          className="size-2 animate-pulse rounded-full bg-current opacity-40"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  )
}

/** The official USDC mark (public/usdc.png, from CoinGecko). Plain <img>: it's a
 *  small static brand asset, already a transparent circle. */
function UsdcMark() {
  return <img src="/usdc.png" alt="" width="15" height="15" className="block shrink-0" aria-hidden />
}

/** The settings gear on the collapsed slippage pill. */
function GearIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#93a8c4"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function AssetChip({ coin, usdc }: { coin: Coin; usdc: boolean }) {
  return (
    <span
      className="bg-hull flex shrink-0 items-center gap-[7px] rounded-full px-3 py-[7px] text-[13.5px] font-semibold"
      style={{ border: "1px solid rgba(148,168,196,.25)" }}
    >
      {usdc ? (
        <UsdcMark />
      ) : (
        <CoinAvatar
          image={coin.image}
          emoji={coin.emoji}
          name={coin.name}
          ticker={coin.ticker}
          size={16}
          className="rounded-full"
        />
      )}
      {usdc ? "USDC" : `$${coin.ticker}`}
    </span>
  )
}

/**
 * The swap card. Two stacked wells (spend on top, receive below) with a ⇅ that
 * flips the side, per the v3 design — no buy/sell segmented tabs.
 *
 * When disconnected the CTA reads "Connect wallet" and connects. It never
 * scolds: the button is always the next step, never an error message.
 */
export function TradePanel({ coin, creatorName }: { coin: Coin; creatorName?: string | null }) {
  const params = useSearchParams()
  // ⚡ Snap buy lands here with ?buy=100. It pre-fills, never auto-submits.
  const seeded = params.get("buy")
  const [side, setSide] = React.useState<Side>("buy")
  const [amount, setAmount] = React.useState(seeded && /^\d+(\.\d+)?$/.test(seeded) ? seeded : "")
  const [slippage, setSlippage] = React.useState<bigint>(DEFAULT_SLIPPAGE_BPS)
  // Slippage lives in a collapsed pill; Adjust opens presets + a custom % field.
  const [slipOpen, setSlipOpen] = React.useState(false)
  const [slipCustom, setSlipCustom] = React.useState("")
  const [lastTx, setLastTx] = React.useState<`0x${string}`>()
  const { celebrate } = useFx()
  const { connected, wrongNetwork, connect, switchToArc } = useWallet()
  const trade = useTrade(coin, side, amount, slippage)

  const buying = side === "buy"
  const spend = parseFloat(amount) || 0
  const remaining = (1 - coin.curve) * EXIT_NATIVE
  const impact = spend ? Math.min(95, (spend / EXIT_NATIVE) * 100) : 0
  const showImpact = buying && spend >= EXIT_NATIVE * 0.03
  const overshoots = buying && spend > remaining && !coin.graduated

  const spendDecimals = buying ? USDC.decimals : COIN_DECIMALS
  const balance =
    trade.balance !== undefined ? Number(formatUnits(trade.balance, spendDecimals)) : undefined
  // A held bag is worth saying out loud — it's the context for a sell.
  const holding =
    !buying && balance !== undefined && balance > 0
      ? `You're holding ${fmtAmount(balance)} $${coin.ticker}.`
      : null

  const { success, hash, reset } = trade
  React.useEffect(() => {
    if (!success || !hash) return
    setLastTx(hash)
    celebrate(side === "buy" ? "Loaded up, captain 🫡" : "Cashed out, captain 🌊")
    setAmount("")
    reset()
  }, [success, hash, side, celebrate, reset])

  function flip() {
    setSide(buying ? "sell" : "buy")
    setAmount("")
  }

  // The current tolerance as a percent, for the collapsed pill: 500n bps -> "5".
  const slipLabel = (Number(slippage) / 100).toString()
  // A typed custom % -> bps. Keeps useTrade's slippage as the single bigint bps
  // source; the presets and this field just write to it.
  function setCustomSlip(v: string) {
    const clean = v.replace(/[^0-9.]/g, "").slice(0, 4)
    setSlipCustom(clean)
    const n = parseFloat(clean)
    if (Number.isFinite(n) && n > 0) setSlippage(BigInt(Math.round(n * 100)))
  }

  const receive = trade.quoting ? (
    <Dots />
  ) : trade.amountOut === undefined || spend === 0 ? (
    "0"
  ) : buying ? (
    fmtAmount(trade.amountOutFloat)
  ) : (
    fmtUsdc(trade.amountOutFloat)
  )

  return (
    <div className="glass w-full min-w-0 self-start p-5 lg:max-w-[400px] lg:flex-[1_1_290px]">
      {/* identity */}
      <div className="mb-4 flex items-center gap-3">
        <CoinAvatar
          image={coin.image}
          emoji={coin.emoji}
          name={coin.name}
          ticker={coin.ticker}
          size={44}
          className="bg-deep rounded-[10px]"
          style={{ border: "1px solid rgba(148,168,196,.2)" }}
        />
        <div className="min-w-0">
          <div className="font-display truncate text-[18px]">{coin.name}</div>
          <div className="text-faint text-[12.5px]">
            ${coin.ticker} · by{" "}
            <Link
              href={`/u/${coin.creatorAddress}`}
              className={`text-gold hover:underline ${creatorName ? "" : "tabular"}`}
            >
              {creatorName ?? coin.creator}
            </Link>
          </div>
        </div>
      </div>

      {/* spend well */}
      <div className="well p-4">
        <div className="text-faint mb-2 flex justify-between text-[12.5px]">
          <span>Sell</span>
          <span className="tabular">
            {balance === undefined
              ? "—"
              : `${buying ? fmtUsdc(balance) : fmtAmount(balance)} ${buying ? "USDC" : `$${coin.ticker}`}`}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            aria-label={buying ? "Amount in USDC" : `Amount in $${coin.ticker}`}
            className="tabular min-w-0 flex-1 bg-transparent text-[26px] font-semibold outline-none"
          />
          <AssetChip coin={coin} usdc={buying} />
        </div>
      </div>

      {/* flip */}
      <button
        type="button"
        onClick={flip}
        title="Flip"
        aria-label={buying ? "Switch to selling" : "Switch to buying"}
        className="bg-hull text-gold hover:border-lime relative z-[2] mx-auto -my-3.5 grid size-9 place-items-center rounded-full text-[15px] transition-colors"
        style={{ border: "1px solid rgba(148,168,196,.3)" }}
      >
        ⇅
      </button>

      {/* receive well */}
      <div className="well p-4">
        <div className="text-faint mb-2 flex justify-between text-[12.5px]">
          <span>Buy</span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="tabular min-w-0 flex-1 truncate text-[26px] font-semibold">{receive}</div>
          <AssetChip coin={coin} usdc={!buying} />
        </div>
        <div className="text-faint mt-1.5 text-[12.5px]">fee 1% — split with the creator</div>
      </div>

      {/* % of available balance */}
      <div className="mt-3.5 flex gap-2">
        {PERCENTS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={!trade.balance}
            onClick={() =>
              trade.balance &&
              setAmount(formatUnits((trade.balance * BigInt(p)) / 100n, spendDecimals))
            }
            className="well text-body2 hover:border-lime hover:text-lime flex-1 rounded-xl py-2 text-center text-[12.5px] font-semibold transition-colors disabled:opacity-40"
          >
            {p}%
          </button>
        ))}
      </div>

      {/* slippage — a collapsed pill (`5% ⚙ Adjust`) that expands to 1/2/5%
          presets + a custom % field; "Done" collapses it again. */}
      <div className="text-mist my-3.5 flex flex-wrap items-center gap-2 text-[13px]">
        <span>Slippage</span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {slipOpen && (
            <>
              {SLIPPAGE_CHOICES.map((s) => {
                const on = slippage === s.bps && !slipCustom
                return (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => {
                      setSlippage(s.bps)
                      setSlipCustom("")
                    }}
                    aria-pressed={on}
                    className="rounded-full px-3 py-[5px] text-xs font-semibold transition-colors"
                    style={{
                      background: on ? "rgba(137,167,219,.12)" : "transparent",
                      color: on ? "#89a7db" : "#93a8c4",
                      border: `1px solid ${on ? "#89a7db" : "rgba(148,168,196,.2)"}`,
                    }}
                  >
                    {s.label}
                  </button>
                )
              })}
              <div
                className="flex items-center gap-px rounded-full px-[11px] py-[5px]"
                style={{
                  background: slipCustom ? "rgba(137,167,219,.12)" : "transparent",
                  border: `1px solid ${slipCustom ? "#89a7db" : "rgba(148,168,196,.2)"}`,
                }}
              >
                <input
                  inputMode="decimal"
                  value={slipCustom}
                  onChange={(e) => setCustomSlip(e.target.value)}
                  placeholder="Custom"
                  aria-label="Custom slippage percent"
                  className="tabular w-[52px] bg-transparent text-right text-xs font-semibold outline-none"
                />
                <span
                  className="text-xs font-semibold"
                  style={{ color: slipCustom ? "#89a7db" : "#6e82a0" }}
                >
                  %
                </span>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setSlipOpen((o) => !o)}
            className="bg-deep text-foam flex items-center gap-[7px] rounded-full px-[13px] py-[6px] text-[12.5px] font-semibold"
            style={{ border: "1px solid rgba(148,168,196,.14)" }}
          >
            <span className="tabular">{slipLabel}%</span>
            <GearIcon />
            <span>{slipOpen ? "Done" : "Adjust"}</span>
          </button>
        </div>
      </div>

      {showImpact && (
        <Notice tone="warn">
          ⚠️ Price impact ~<span className="tabular">{impact.toFixed(0)}</span>% — this size moves the
          whole market.
        </Notice>
      )}
      {overshoots && (
        <Notice tone="dashed">This buy overshoots the range — the extra USDC auto-refunds.</Notice>
      )}
      {holding && <Notice tone="quiet">⚓ {holding}</Notice>}
      {trade.disabledReason && <Notice tone="quiet">{trade.disabledReason}</Notice>}

      {/* NOTE: SwapRouter02 has no deadline field — do not add one. See lib/trade.ts. */}
      {!connected ? (
        <button onClick={connect} className="btn-glossy w-full py-[15px] text-base">
          Connect wallet
        </button>
      ) : wrongNetwork ? (
        <button onClick={switchToArc} className="btn-glossy w-full py-[15px] text-base">
          Switch to Arc
        </button>
      ) : (
        <button
          onClick={trade.submit}
          disabled={!trade.canSubmit}
          className={cn("w-full py-[15px] text-base", buying ? "btn-glossy" : "btn-sell")}
        >
          {buying ? `Buy $${coin.ticker}` : `Sell $${coin.ticker}`}
        </button>
      )}

      {trade.busy && (
        <p className="text-mist mt-2 text-center text-[12px]">
          {trade.approving ? `Approving $${coin.ticker}…` : "Signing and sailing… hold fast."}
        </p>
      )}

      {trade.error && !trade.busy && (
        <p className="mt-2 text-center text-[12px]" style={{ color: "#de8092" }}>
          {trade.error}
        </p>
      )}

      {lastTx && (
        <a
          href={explorerTx(lastTx)}
          target="_blank"
          rel="noreferrer"
          className="text-gold mt-2 block text-center text-[12px] underline underline-offset-2"
        >
          View last trade on the explorer ↗
        </a>
      )}
    </div>
  )
}

function Notice({ tone, children }: { tone: "warn" | "dashed" | "quiet"; children: React.ReactNode }) {
  const style =
    tone === "warn"
      ? { background: "rgba(137,167,219,.08)", border: "1px solid rgba(137,167,219,.4)", color: "#89a7db" }
      : tone === "dashed"
        ? { background: "rgba(137,167,219,.06)", border: "1px dashed rgba(137,167,219,.45)", color: "#c6d5ea" }
        : { background: "rgba(137,167,219,.06)", border: "1px solid rgba(137,167,219,.28)", color: "#89a7db" }

  return (
    <div className="mb-3 rounded-[9px] px-3 py-2.5 text-[13px]" style={style}>
      {children}
    </div>
  )
}
