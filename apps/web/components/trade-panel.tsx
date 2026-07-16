"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"
import { fmtAmount } from "@/lib/format"
import { useFx } from "@/components/fx-provider"
import type { Coin } from "@/lib/mock"

// ~6.9 WETH buys through the whole range — the total exit liquidity.
const EXIT_WETH = 6.9
const CHIPS = ["0.05", "0.1", "0.5", "1"]

type Side = "buy" | "sell"

export function TradePanel({ coin }: { coin: Coin }) {
  const [side, setSide] = React.useState<Side>("buy")
  const [amount, setAmount] = React.useState("")
  const { celebrate } = useFx()

  const eth = parseFloat(amount) || 0
  // remaining range = (100 − grad%)/100 × 6.9 WETH
  const remaining = (1 - coin.curve) * EXIT_WETH
  const impact = eth ? Math.min(95, (eth / EXIT_WETH) * 100) : 0
  const showImpact = side === "buy" && eth >= EXIT_WETH * 0.03
  const overshoots = side === "buy" && eth > remaining && !coin.graduated
  const receive = eth * 1_450_000_000

  function submit() {
    if (side === "buy") celebrate("Loaded up, captain 🫡")
    else celebrate("Cashed out, captain 🌊")
    setAmount("")
  }

  return (
    <div className="rounded-panel bg-hull flex flex-col gap-4 border p-[18px]">
      {/* buy / sell segmented toggle */}
      <div className="bg-deep flex gap-1 rounded-btn p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
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
        <label className="text-mist text-xs">
          {side === "buy" ? "Amount (ETH)" : `Amount ($${coin.ticker})`}
        </label>
        <div className="bg-deep flex items-center gap-2 rounded-btn border py-1 pl-3.5 pr-1">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.0"
            className="tabular w-full bg-transparent py-2 text-[20px] outline-none"
          />
          <span className="text-mist pr-2 text-[15px]" aria-hidden>
            Ξ
          </span>
        </div>
        <div className="flex gap-2">
          {CHIPS.map((c) => (
            <button
              key={c}
              onClick={() => setAmount(c)}
              className="btn-quiet rounded-chip tabular px-2.5 py-1 text-xs"
            >
              {c} Ξ
            </button>
          ))}
        </div>
      </div>

      {eth > 0 && (
        <div className="flex flex-col gap-1.5 text-[13px]">
          <div className="flex justify-between">
            <span className="text-mist">You receive</span>
            <span className="tabular">
              {fmtAmount(receive)} ${coin.ticker}
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
            border: "1px solid rgba(251,191,36,.4)",
            background: "rgba(251,191,36,.08)",
            color: "#FBBF24",
          }}
        >
          ⚠️ Price impact ~<span className="tabular">{impact.toFixed(0)}</span>% — the entire market
          has ~6.9 WETH of exit liquidity.
        </div>
      )}

      {/* auto-refund note — dashed lime */}
      {overshoots && (
        <div
          className="rounded-btn text-lime p-2.5 text-[13px]"
          style={{ border: "1px dashed rgba(163,230,53,.5)", background: "rgba(163,230,53,.06)" }}
        >
          This buy overshoots the range — the extra ETH auto-refunds.
        </div>
      )}

      {/* NOTE: SwapRouter02 has no deadline field — do not add one. */}
      <button
        onClick={submit}
        className={cn(
          "btn-deck w-full py-3 text-[19px]",
          side === "buy" ? "btn-lime" : "btn-red"
        )}
      >
        {side === "buy" ? "FULL SAIL ⚓" : "ABANDON SHIP 😭"}
      </button>
      <p className="text-faint text-center text-[11px]">
        Wallet + live quotes are mocked — wiring lands with the indexer &amp; contracts
      </p>
    </div>
  )
}
