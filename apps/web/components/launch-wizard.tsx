"use client"

import * as React from "react"
import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"
import { FACE_OPTIONS } from "@/lib/mock"
import { useFx } from "@/components/fx-provider"

// ~0.0045 Ξ ≈ the 2% maxDevBuyBps cap on the shipped curve.
const DEV_BUY_CAP_ETH = 0.0045
const STEPS = ["Papers", "Sea trial", "Set sail"] as const

export function LaunchWizard() {
  const [step, setStep] = React.useState(0)
  const [name, setName] = React.useState("")
  const [ticker, setTicker] = React.useState("")
  const [lore, setLore] = React.useState("")
  const [emoji, setEmoji] = React.useState(FACE_OPTIONS[0]!)
  const [devBuy, setDevBuy] = React.useState("")
  const { celebrate } = useFx()

  const devEth = parseFloat(devBuy) || 0
  const overCap = devEth > DEV_BUY_CAP_ETH
  const devPct = (devEth / DEV_BUY_CAP_ETH) * 2
  const tickerUp = ticker || "TICKER"
  // mock — real value comes from predictTokenAddress before signing (plan Unit 4)
  const predAddr = `0x0bd7f3a2${(ticker || "ship").toLowerCase().padEnd(4, "0").slice(0, 4)}9c1e5a77b204d3f8e6c1a90b2d4f`.slice(0, 42)

  const canAdvance = name.trim() && ticker.trim() && !overCap

  function setSail() {
    celebrate(`$${tickerUp} has left the shipyard 🚢`)
    setStep(2)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* step pills */}
      <ol className="flex items-center justify-center gap-2 text-[13px]">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={cn(
              "rounded-[20px] px-3.5 py-1.5 font-bold transition-colors",
              i === step ? "text-lime" : "text-mist"
            )}
            style={
              i === step
                ? { background: "rgba(163,230,53,.12)", border: "1px solid rgba(163,230,53,.45)" }
                : { border: "1px solid transparent" }
            }
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {/* step 1 — Papers */}
      {step === 0 && (
        <div className="rounded-panel bg-hull grid gap-4 border p-[26px]" style={{ borderRadius: 20 }}>
          <Field label="Coin name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Flagship" className={inputCls} />
          </Field>
          <Field label="Ticker">
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
              placeholder="FLAG"
              className={cn(inputCls, "tabular")}
            />
          </Field>
          <Field label="Lore (optional)">
            <textarea value={lore} onChange={(e) => setLore(e.target.value)} rows={3} placeholder="First ship out of the yard. Never sank." className={inputCls} />
          </Field>

          <Field label="Dev-buy (optional) — your own first buy">
            <div
              className="bg-deep flex items-center gap-2 rounded-btn border pl-3.5 pr-3"
              style={{ borderColor: overCap ? "#F87171" : "#263A28" }}
            >
              <input
                value={devBuy}
                onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.0"
                className="tabular w-full bg-transparent py-2.5 outline-none"
              />
              <span className="text-mist" aria-hidden>Ξ</span>
            </div>
          </Field>
          {overCap ? (
            <p className="text-[13px]" style={{ color: "#F87171" }}>
              Over the cap — max dev-buy is <span className="tabular">0.0045 Ξ</span> (~2% of supply).
              The launch would revert on-chain; we won&apos;t let you pay gas to fail.
            </p>
          ) : (
            devEth > 0 && (
              <p className="text-mist text-[13px]">
                ≈ <span className="tabular">{devPct.toFixed(2)}</span>% of supply
              </p>
            )
          )}

          <Field label="Pick a face">
            <div className="grid grid-cols-8 gap-2">
              {FACE_OPTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  aria-pressed={emoji === e}
                  className={cn(
                    "rounded-chip grid aspect-square place-items-center text-2xl transition-colors",
                    emoji === e ? "border-lime" : "hover:bg-bulwark"
                  )}
                  style={{ border: `1px solid ${emoji === e ? "#A3E635" : "#263A28"}` }}
                >
                  {e}
                </button>
              ))}
            </div>
          </Field>

          <div className="flex justify-end">
            <button
              disabled={!canAdvance}
              onClick={() => setStep(1)}
              className="btn-deck btn-lime px-5 py-2.5 text-base disabled:cursor-not-allowed disabled:opacity-40"
            >
              Sea trial →
            </button>
          </div>
        </div>
      )}

      {/* step 2 — Sea trial (review) */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className="rounded-panel bg-hull flex flex-col items-center gap-2 border p-6 text-center" style={{ borderRadius: 20 }}>
            <span className="text-5xl" aria-hidden>{emoji}</span>
            <div className="font-display text-xl">{name}</div>
            <div className="text-mist tabular text-sm">${tickerUp}</div>
            {lore && <p className="text-mist max-w-sm text-[13px]">{lore}</p>}
          </div>

          <div className="rounded-panel bg-hull grid gap-2 border p-[26px]" style={{ borderRadius: 20 }}>
            <Row k="Supply — fixed, every coin" v="100,000,000,000" mono />
            <Row k="Team allocation" v="0%" />
            <Row k="Liquidity" v="Locked forever 🔒" />
            <Row k="Your dev-buy" v={`${devEth} Ξ`} mono />
            <div className="mt-2">
              <div className="text-mist text-xs">Predicted coin address — computed before you sign</div>
              <div className="tabular mt-1 break-all text-[13px]">{predAddr}</div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(0)} className="btn-deck btn-quiet px-4 py-2.5 text-sm">
              ← Edit
            </button>
            <button onClick={setSail} className="btn-deck btn-lime px-6 py-3 text-[19px]">
              Set sail 🚢
            </button>
          </div>
          <p className="text-faint text-center text-xs">
            one transaction: mint + pool + lock the LP forever
          </p>
        </div>
      )}

      {/* step 3 — success */}
      {step === 2 && (
        <div className="rounded-panel bg-hull flex flex-col items-center gap-3 border p-12 text-center" style={{ borderRadius: 20 }}>
          <span className="animate-bob text-6xl" aria-hidden>{emoji}</span>
          <h2 className="font-display text-2xl">${tickerUp} has left the shipyard</h2>
          <p className="text-mist text-sm">Block confirmed. Calm seas and green candles, captain.</p>
          <div className="mt-2 flex gap-3">
            <Link href={`/token/${predAddr}`} className="btn-deck btn-lime px-5 py-2.5 text-base">
              View your coin
            </Link>
            <Link href="/" className="btn-deck btn-quiet px-5 py-2.5 text-base">
              Back home
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

const inputCls =
  "bg-deep w-full rounded-btn border px-3.5 py-2.5 text-sm outline-none focus:border-lime/60"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-mist text-xs">{label}</span>
      {children}
    </label>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between py-1.5 text-sm" style={{ borderBottom: "1px solid #1a281c" }}>
      <span className="text-mist">{k}</span>
      <span className={cn(mono && "tabular")}>{v}</span>
    </div>
  )
}
