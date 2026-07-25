"use client"

import * as React from "react"
import { formatUnits } from "viem"

import { cn } from "@workspace/ui/lib/utils"
import { fmtAmount } from "@/lib/format"
import { useFx } from "@/components/fx-provider"
import { useWallet } from "@/components/wallet-provider"
import { useTrade, type Side } from "@/lib/trade"
import { explorerTx, USDC, COIN_DECIMALS } from "@/lib/chain"
import type { Coin } from "@/lib/coin"

// ~20,000 USDC buys through the whole range -- the graduation threshold read
// from the deployed factory's curve preset 0 (getCurveConfig(0) => -444600,
// 20000e6). Not a constant of the system: the factory admin can rewrite the
// preset, so treat this as today's reading.
const EXIT_NATIVE = 20000
const CHIPS = ["50", "100", "500", "1000"]
const SELL_CHIPS: [string, bigint][] = [
  ["25%", 25n],
  ["50%", 50n],
  ["MAX", 100n],
]

/** ETH amounts are small and precision matters — no compact notation. */
function fmtUsdc(n: number): string {
  if (n === 0) return "0"
  if (n < 0.000001) return "<0.000001"
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 })
}

export function TradePanel({ coin }: { coin: Coin }) {
  const [side, setSide] = React.useState<Side>("buy")
  const [amount, setAmount] = React.useState("")
  const [lastTx, setLastTx] = React.useState<`0x${string}`>()
  const { celebrate } = useFx()
  const { connected, wrongNetwork, connect, switchToArc } = useWallet()
  const trade = useTrade(coin, side, amount)

  const eth = parseFloat(amount) || 0
  // remaining range = (100 − grad%)/100 × 5000 USDC
  const remaining = (1 - coin.curve) * EXIT_NATIVE
  const impact = eth ? Math.min(95, (eth / EXIT_NATIVE) * 100) : 0
  const showImpact = side === "buy" && eth >= EXIT_NATIVE * 0.03
  const overshoots = side === "buy" && eth > remaining && !coin.graduated

  const { success, hash, reset } = trade
  React.useEffect(() => {
    if (!success || !hash) return
    setLastTx(hash)
    celebrate(side === "buy" ? "Loaded up, captain 🫡" : "Cashed out, captain 🌊")
    setAmount("")
    reset()
  }, [success, hash, side, celebrate, reset])

  function setSideAndClear(s: Side) {
    setSide(s)
    setAmount("")
  }

  return (
    <div className="rounded-panel bg-hull flex flex-col gap-4 border p-[18px]">
      {/* buy / sell segmented toggle */}
      <div className="bg-deep flex gap-1 rounded-btn p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSideAndClear(s)}
            aria-pressed={side === s}
            className={cn(
              "font-display flex-1 rounded-[9px] py-2 text-[15px] capitalize transition-colors",
              side === s
                ? s === "buy"
                  ? "bg-lime text-lime-ink"
                  : "bg-tide text-[#1a0505]"
                : "text-mist hover:text-foam"
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {/* amount */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <label className="text-mist text-xs">
            {side === "buy" ? "Amount (USDC)" : `Amount ($${coin.ticker})`}
          </label>
          {trade.balance !== undefined && (
            <span className="text-faint tabular text-[11px]">
              {fmtUsdc(Number(formatUnits(trade.balance, side === "buy" ? USDC.decimals : COIN_DECIMALS)))}{" "}
              {side === "buy" ? "USDC" : `$${coin.ticker}`}
            </span>
          )}
        </div>
        <div className="bg-deep flex items-center gap-2 rounded-btn border py-1 pl-3.5 pr-1">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            className="tabular w-full bg-transparent py-2 text-[20px] outline-none"
          />
          <span className="text-mist pr-2 text-[15px]" aria-hidden>
            {side === "buy" ? "USDC" : `$${coin.ticker}`}
          </span>
        </div>
        <div className="flex gap-2">
          {side === "buy"
            ? CHIPS.map((c) => (
                <button
                  key={c}
                  onClick={() => setAmount(c)}
                  className="btn-quiet rounded-chip tabular px-2.5 py-1 text-xs"
                >
                  {c} USDC
                </button>
              ))
            : SELL_CHIPS.map(([label, pct]) => (
                <button
                  key={label}
                  disabled={!trade.balance}
                  onClick={() =>
                    trade.balance && setAmount(formatUnits((trade.balance * pct) / 100n, COIN_DECIMALS))
                  }
                  className="btn-quiet rounded-chip tabular px-2.5 py-1 text-xs disabled:opacity-40"
                >
                  {label}
                </button>
              ))}
        </div>
      </div>

      {eth > 0 && (
        <div className="flex flex-col gap-1.5 text-[13px]">
          <div className="flex justify-between">
            <span className="text-mist">You receive</span>
            <span className="tabular">
              {trade.quoting ? (
                <span className="text-mist">quoting…</span>
              ) : trade.amountOut === undefined ? (
                <span className="text-mist">—</span>
              ) : side === "buy" ? (
                `${fmtAmount(trade.amountOutFloat)} $${coin.ticker}`
              ) : (
                `${fmtUsdc(trade.amountOutFloat)} USDC`
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-mist">Fee</span>
            <span className="text-mist">1% — split with the creator</span>
          </div>
        </div>
      )}

      {/* price-impact warning — amber */}
      {showImpact && (
        <div
          className="rounded-btn p-2.5 text-[13px]"
          style={{
            border: "1px solid rgba(242,201,76,.4)",
            background: "rgba(242,201,76,.08)",
            color: "#f2c94c",
          }}
        >
          ⚠️ Price impact ~<span className="tabular">{impact.toFixed(0)}</span>% — the entire market
          has ~20,000 USDC of exit liquidity.
        </div>
      )}

      {/* auto-refund note — dashed lime */}
      {overshoots && (
        <div
          className="rounded-btn text-lime p-2.5 text-[13px]"
          style={{ border: "1px dashed rgba(198,255,61,.5)", background: "rgba(198,255,61,.06)" }}
        >
          This buy overshoots the range — the extra ETH auto-refunds.
        </div>
      )}

      {/* why the button is dead */}
      {trade.disabledReason && (
        <div className="text-mist rounded-btn bg-deep p-2.5 text-[13px]">{trade.disabledReason}</div>
      )}

      {/* NOTE: SwapRouter02 has no deadline field — do not add one. See lib/trade.ts. */}
      {!connected ? (
        <button onClick={connect} className="btn-deck btn-quiet w-full py-3 text-[19px]">
          CONNECT WALLET
        </button>
      ) : wrongNetwork ? (
        <button onClick={switchToArc} className="btn-deck btn-quiet w-full py-3 text-[19px]">
          SWITCH TO ROBINHOOD CHAIN
        </button>
      ) : (
        <button
          onClick={trade.submit}
          disabled={!trade.canSubmit}
          className={cn(
            "btn-deck w-full py-3 text-[19px] disabled:cursor-not-allowed disabled:opacity-40",
            side === "buy" ? "btn-lime" : "btn-red"
          )}
        >
          {side === "buy" ? "FULL SAIL ⚓" : "ABANDON SHIP 😭"}
        </button>
      )}

      {trade.busy && (
        <p className="text-mist text-center text-[12px]">
          {trade.approving ? `Approving $${coin.ticker}…` : "Signing and sailing… hold fast."}
        </p>
      )}

      {trade.error && !trade.busy && (
        <p className="text-center text-[12px]" style={{ color: "#ff8f6e" }}>
          {trade.error}
        </p>
      )}

      {lastTx && (
        <a
          href={explorerTx(lastTx)}
          target="_blank"
          rel="noreferrer"
          className="text-lime text-center text-[12px] underline underline-offset-2"
        >
          View last trade on the explorer ↗
        </a>
      )}
    </div>
  )
}
