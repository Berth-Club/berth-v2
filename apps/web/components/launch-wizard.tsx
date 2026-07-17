"use client"

import * as React from "react"
import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"
import { FACE_OPTIONS } from "@/lib/coin"
import { useFx } from "@/components/fx-provider"
import { useWallet } from "@/components/wallet-provider"
import { explorerTx } from "@/lib/chain"
import {
  DEV_BUY_CAP_ETH,
  buildConfig,
  normalizeTicker,
  parseEthInput,
  useLaunch,
} from "@/lib/launch"

const STEPS = ["Papers", "Sea trial", "Set sail"] as const

/**
 * Dev-buy quick picks. Sourced from DEV_BUY_CAP_ETH so MAX lands exactly ON the
 * boundary — the cap is only ~0.00445 Ξ, so generic amounts (0.1, 0.5) would
 * every one of them revert with DevBuyExceedsCap.
 */
const DEV_BUY_PRESETS: { label: string; value: string }[] = [
  { label: "none", value: "0" },
  { label: "0.001 Ξ", value: "0.001" },
  { label: "0.0025 Ξ", value: "0.0025" },
  { label: `MAX · ${DEV_BUY_CAP_ETH} Ξ`, value: String(DEV_BUY_CAP_ETH) },
]

export function LaunchWizard() {
  const [step, setStep] = React.useState(0)
  const [name, setName] = React.useState("")
  const [ticker, setTicker] = React.useState("")
  const [lore, setLore] = React.useState("")
  const [emoji, setEmoji] = React.useState(FACE_OPTIONS[0]!)
  const [devBuy, setDevBuy] = React.useState("")
  const { celebrate } = useFx()
  const { connected, wrongNetwork, switchToRobinhood, connect } = useWallet()

  const valueWei = parseEthInput(devBuy)
  const tickerUp = normalizeTicker(ticker) || "TICKER"

  // Memoized: this object is a query key for the predict read and the deploy
  // simulation. A fresh identity every render would refetch forever.
  //
  // lore and emoji ARE deps: they go into metadataURI, which is a constructor
  // arg and therefore part of the CREATE2 initcode hash. Leave them out and the
  // previewed address stops matching the one that actually gets deployed.
  const config = React.useMemo(
    () =>
      name.trim() && normalizeTicker(ticker)
        ? buildConfig(name, ticker, lore, emoji)
        : undefined,
    [name, ticker, lore, emoji]
  )

  // The simulation is a full deploy eth_call — only run it on the review step,
  // where it is about to gate a signature.
  const launch = useLaunch(config, valueWei, step === 1)

  const devEth = valueWei !== undefined ? Number(devBuy) || 0 : 0
  // Advisory only — instant, works before connecting. The authority is the
  // on-chain simulation on the review step (launch.blocked).
  const overCap = devEth > launch.capEth
  const devPct = (devEth / launch.capEth) * launch.capPct
  const badDevBuy = valueWei === undefined

  const canAdvance = !!config && !overCap && !badDevBuy

  const gate = !connected
    ? { label: "Connect wallet to launch", act: connect }
    : wrongNetwork
      ? { label: "Switch to Robinhood Chain", act: switchToRobinhood }
      : undefined

  // Fire once, on the receipt — never on click. The real token address only
  // exists after TokenLaunched is parsed out of the mined receipt.
  const celebrated = React.useRef(false)
  React.useEffect(() => {
    if (launch.status === "done" && !celebrated.current) {
      celebrated.current = true
      celebrate(`$${tickerUp} has left the shipyard 🚢`)
      setStep(2)
    }
  }, [launch.status, celebrate, tickerUp])

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
              onChange={(e) => setTicker(normalizeTicker(e.target.value))}
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
              style={{ borderColor: overCap || badDevBuy ? "#F87171" : "#263A28" }}
            >
              <input
                value={devBuy}
                onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.0"
                inputMode="decimal"
                className="tabular w-full bg-transparent py-2.5 outline-none"
              />
              <span className="text-mist" aria-hidden>Ξ</span>
            </div>
          </Field>
          {/* Presets are derived from the live cap, not typed out — a hardcoded
              list would drift the moment the boundary moves, and "MAX" has to
              land exactly ON the cap rather than a hair over it (0.0045 reverts). */}
          <div className="-mt-2 flex flex-wrap gap-2">
            {DEV_BUY_PRESETS.map(({ label, value }) => {
              const active = devBuy === value
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDevBuy(value)}
                  aria-pressed={active}
                  className={cn(
                    "btn-quiet rounded-chip tabular px-2.5 py-1 text-xs transition-colors",
                    active && "border-lime text-lime"
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
          {badDevBuy ? (
            <p className="text-[13px]" style={{ color: "#F87171" }}>
              That dev-buy isn&apos;t a number.
            </p>
          ) : overCap ? (
            <p className="text-[13px]" style={{ color: "#F87171" }}>
              Over the cap — max dev-buy is <span className="tabular">{launch.capEth} Ξ</span> (~
              {launch.capPct}% of supply). The launch would revert on-chain; we won&apos;t let you pay
              gas to fail.
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
              {launch.predicted ? (
                <div className="tabular mt-1 break-all text-[13px]">{launch.predicted}</div>
              ) : launch.predictFailed ? (
                <div className="mt-1 flex flex-col items-start gap-1.5">
                  <p className="text-[13px]" style={{ color: "#F87171" }}>
                    The shipyard couldn&apos;t find a berth for this name. Nudge the name or ticker.
                  </p>
                  <button onClick={launch.retryPredict} className="btn-deck btn-quiet px-3 py-1.5 text-xs">
                    Sound it again
                  </button>
                </div>
              ) : (
                <div className="text-faint mt-1 text-[13px]">
                  {gate ? "Connect on Robinhood Chain to sound the address." : "Sounding the address…"}
                </div>
              )}
            </div>
          </div>

          {launch.blocked && !gate && (
            <p className="text-[13px]" style={{ color: "#F87171" }}>
              {launch.blocked}
            </p>
          )}
          {/* A dead button with no reason is the worst of both worlds: it knows
              something is wrong and won't say what. Name the wait too. */}
          {launch.checking && !gate && !launch.blocked && (
            <p className="text-mist text-[13px]">
              Checking the launch against the chain…
            </p>
          )}
          {launch.error && (
            <p className="text-[13px]" style={{ color: "#F87171" }}>
              {launch.error}
            </p>
          )}

          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(0)}
              disabled={launch.status === "signing" || launch.status === "mining"}
              className="btn-deck btn-quiet px-4 py-2.5 text-sm disabled:opacity-40"
            >
              ← Edit
            </button>
            {gate ? (
              <button onClick={gate.act} className="btn-deck btn-gold px-6 py-3 text-[19px]">
                {gate.label}
              </button>
            ) : (
              <button
                onClick={launch.launch}
                disabled={!launch.ready || launch.status === "signing" || launch.status === "mining"}
                className="btn-deck btn-lime px-6 py-3 text-[19px] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {launch.status === "signing"
                  ? "Check your wallet…"
                  : launch.status === "mining"
                    ? "Leaving the yard…"
                    : "Set sail 🚢"}
              </button>
            )}
          </div>
          {launch.hash && (
            <a
              href={explorerTx(launch.hash)}
              target="_blank"
              rel="noreferrer"
              className="text-mist text-center text-xs underline"
            >
              Track the transaction ↗
            </a>
          )}
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
            {launch.token && (
              <Link href={`/token/${launch.token}`} className="btn-deck btn-lime px-5 py-2.5 text-base">
                View your coin
              </Link>
            )}
            <Link href="/" className="btn-deck btn-quiet px-5 py-2.5 text-base">
              Back home
            </Link>
          </div>
          {launch.hash && (
            <a
              href={explorerTx(launch.hash)}
              target="_blank"
              rel="noreferrer"
              className="text-mist mt-1 text-xs underline"
            >
              View the launch transaction ↗
            </a>
          )}
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
