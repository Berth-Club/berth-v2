"use client"

import * as React from "react"
import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"
import { FACE_OPTIONS } from "@/lib/coin"
import { useFx } from "@/components/fx-provider"
import { useWallet } from "@/components/wallet-provider"
import { useImageUpload } from "@/lib/use-image-upload"
import { explorerTx } from "@/lib/chain"
import { CoinAvatar } from "@/components/coin-avatar"
import {
  DEV_BUY_CAP_USDC,
  buildConfig,
  normalizeTicker,
  parseUsdcInput,
  useLaunch,
} from "@/lib/launch"

const STEPS = ["Papers", "Sea trial", "Set sail"] as const

/**
 * Dev-buy quick picks. Sourced from DEV_BUY_CAP_USDC so MAX lands exactly ON the
 * boundary — the cap is only ~0.00445 USDC, so generic amounts (0.1, 0.5) would
 * every one of them revert with DevBuyExceedsCap.
 */
const DEV_BUY_PRESETS: { label: string; value: string }[] = [
  { label: "none", value: "0" },
  { label: "1 USDC", value: "1" },
  { label: "10 USDC", value: "10" },
  { label: `MAX · ${DEV_BUY_CAP_USDC} USDC`, value: String(DEV_BUY_CAP_USDC) },
]

export function LaunchWizard() {
  const [step, setStep] = React.useState(0)
  const [name, setName] = React.useState("")
  const [ticker, setTicker] = React.useState("")
  const [lore, setLore] = React.useState("")
  const [twitter, setTwitter] = React.useState("")
  const [telegram, setTelegram] = React.useState("")
  const [website, setWebsite] = React.useState("")
  const [dragging, setDragging] = React.useState(false)

  // Accept the first dropped/picked image whose type is one the pin route allows.
  const [emoji, setEmoji] = React.useState(FACE_OPTIONS[0]!)
  const [devBuy, setDevBuy] = React.useState("")
  const { celebrate } = useFx()
  const { connected, wrongNetwork, switchToArc, connect, getAccessToken } = useWallet()
  const upload = useImageUpload(getAccessToken)

  // If the creator picked art before connecting, the pin failed on auth. Retry
  // it ONCE the moment a wallet connects, so they don't have to re-pick. The ref
  // stops an infinite loop if a token genuinely never arrives — after one auto
  // attempt the "Retry upload" button takes over.
  const retryUpload = upload.retry
  const autoRetried = React.useRef(false)
  React.useEffect(() => {
    if (!connected) {
      autoRetried.current = false
      return
    }
    if (upload.status === "error" && upload.needsAuth && !autoRetried.current) {
      autoRetried.current = true
      retryUpload()
    }
  }, [connected, upload.status, upload.needsAuth, retryUpload])

  const acceptFile = React.useCallback(
    (files: FileList | null) => {
      const f = files?.[0]
      if (f && /^image\/(png|jpeg|webp|gif)$/.test(f.type)) upload.pick(f)
    },
    [upload]
  )

  const valueWei = parseUsdcInput(devBuy)
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
        ? buildConfig(name, ticker, lore, emoji, upload.imageUri ?? undefined, {
            twitter: twitter.trim() || undefined,
            telegram: telegram.trim() || undefined,
            website: website.trim() || undefined,
          })
        : undefined,
    [name, ticker, lore, emoji, upload.imageUri, twitter, telegram, website]
  )

  // The simulation is a full deploy eth_call — only run it on the review step,
  // where it is about to gate a signature.
  const launch = useLaunch(config, valueWei, step === 1)

  const devUsdc = valueWei !== undefined ? Number(devBuy) || 0 : 0
  // Advisory only — instant, works before connecting. The authority is the
  // on-chain simulation on the review step (launch.blocked).
  const overCap = devUsdc > launch.capUsdc
  const devPct = (devUsdc / launch.capUsdc) * launch.capPct
  const badDevBuy = valueWei === undefined

  // The image is part of metadataURI, so a pin in flight means the config (and
  // thus the mined address) is not final yet — block until it settles. An
  // upload OUTAGE or unconfigured pinning unlocks the degraded emoji-only launch
  // rather than trapping the user (R6).
  const degradedAllowed = upload.outage || !upload.available
  const imageBlocking = upload.status === "uploading" || (!upload.imageUri && !degradedAllowed)
  const canAdvance = !!config && !overCap && !badDevBuy && !imageBlocking

  const gate = !connected
    ? { label: "Connect wallet to launch", act: connect }
    : wrongNetwork
      ? { label: "Switch to Arc Testnet", act: switchToArc }
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
                ? { background: "rgba(198,255,61,.12)", border: "1px solid rgba(198,255,61,.45)" }
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

          <Field label="Links (optional)">
            <div className="flex flex-col gap-2">
              <input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="https://x.com/yourcoin" className={inputCls} inputMode="url" />
              <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="https://t.me/yourcoin" className={inputCls} inputMode="url" />
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://yourcoin.xyz" className={inputCls} inputMode="url" />
            </div>
          </Field>

          <Field label="Dev-buy (optional) — your own first buy">
            <div
              className="bg-deep flex items-center gap-2 rounded-btn border pl-3.5 pr-3"
              style={{ borderColor: overCap || badDevBuy ? "#ff8f6e" : "rgba(94,147,234,0.2)" }}
            >
              <input
                value={devBuy}
                onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.0"
                inputMode="decimal"
                className="tabular w-full bg-transparent py-2.5 outline-none"
              />
              <span className="text-mist" aria-hidden>USDC</span>
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
            <p className="text-[13px]" style={{ color: "#ff8f6e" }}>
              That dev-buy isn&apos;t a number.
            </p>
          ) : overCap ? (
            <p className="text-[13px]" style={{ color: "#ff8f6e" }}>
              Over the cap — max dev-buy is <span className="tabular">{launch.capUsdc} USDC</span> (~
              {launch.capPct}% of supply). The launch would revert on-chain; we won&apos;t let you pay
              gas to fail.
            </p>
          ) : (
            devUsdc > 0 && (
              <p className="text-mist text-[13px]">
                ≈ <span className="tabular">{devPct.toFixed(2)}</span>% of supply
              </p>
            )
          )}

          <Field label="Coin art">
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                acceptFile(e.dataTransfer.files)
              }}
              className="rounded-btn flex items-center gap-3 border border-dashed p-2.5 transition-colors"
              style={{ borderColor: dragging ? "#c6ff3d" : "rgba(94,147,234,0.2)", background: dragging ? "rgba(198,255,61,.06)" : "transparent" }}
            >
              {/* Preview is the LOCAL file (object URL), not the gateway — a
                  just-pinned CID can briefly 404 and would flash the fallback. */}
              <div
                className="bg-deep rounded-chip relative grid size-16 shrink-0 place-items-center overflow-hidden"
                style={{ border: "1px solid rgba(94,147,234,0.2)" }}
              >
                {upload.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={upload.previewUrl}
                    alt="coin art preview"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-2xl" aria-hidden>
                    {emoji}
                  </span>
                )}
                {upload.status === "uploading" && (
                  <span className="text-foam absolute inset-0 grid place-items-center bg-black/50 text-[11px] font-bold">
                    pinning…
                  </span>
                )}
              </div>
              <div className="flex flex-col items-start gap-1.5">
                <label className="btn-deck btn-quiet rounded-btn cursor-pointer px-3.5 py-2 text-xs">
                  {upload.imageUri ? "Replace image" : "Upload image"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      acceptFile(e.target.files)
                      e.target.value = "" // allow re-picking the same file
                    }}
                  />
                </label>
                {upload.status === "uploading" ? (
                  <p className="text-mist text-[13px]">Pinning to IPFS…</p>
                ) : upload.status === "done" ? (
                  <p className="text-lime text-[13px]">Pinned ✓ — this is your coin&apos;s face.</p>
                ) : upload.status === "error" && upload.needsAuth ? (
                  // Not an outage — just not signed in (or a token glitch). If a
                  // wallet is connected, offer a retry; otherwise offer connect.
                  <button
                    type="button"
                    onClick={() => (connected ? upload.retry() : connect())}
                    className="text-lime text-[13px] underline underline-offset-2"
                  >
                    {connected ? "Retry upload →" : "Connect your wallet to upload art →"}
                  </button>
                ) : upload.status === "error" && !upload.outage ? (
                  <p className="text-[13px]" style={{ color: "#ff8f6e" }}>
                    {upload.error}
                  </p>
                ) : upload.status === "error" && upload.outage ? (
                  <p className="text-gold text-[13px]">
                    Art upload is unavailable right now — you can launch with a face instead.
                  </p>
                ) : (
                  <p className="text-mist text-[13px]">PNG, JPEG, WebP or GIF. Becomes your coin&apos;s face.</p>
                )}
              </div>
            </div>
            <p className="text-faint mt-1.5 text-[11px]">Drag an image here, or use the button.</p>
          </Field>

          <Field label="Fallback face">
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
                  style={{ border: `1px solid ${emoji === e ? "#c6ff3d" : "rgba(94,147,234,0.2)"}` }}
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
            {upload.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={upload.previewUrl}
                alt={`${tickerUp} art`}
                className="size-20 rounded-2xl object-cover"
                style={{ border: "1px solid rgba(94,147,234,0.2)" }}
              />
            ) : upload.imageUri ? (
              <CoinAvatar image={upload.imageUri} emoji={emoji} ticker={tickerUp} size={80} className="rounded-2xl" style={{ border: "1px solid rgba(94,147,234,0.2)" }} />
            ) : (
              <span className="text-5xl" aria-hidden>{emoji}</span>
            )}
            <div className="font-display text-xl">{name}</div>
            <div className="text-mist tabular text-sm">${tickerUp}</div>
            {lore && <p className="text-mist max-w-sm text-[13px]">{lore}</p>}
          </div>

          <div className="rounded-panel bg-hull grid gap-2 border p-[26px]" style={{ borderRadius: 20 }}>
            <Row k="Supply — fixed, every coin" v="100,000,000,000" mono />
            <Row k="Team allocation" v="0%" />
            <Row k="Liquidity" v="Locked forever 🔒" />
            <Row k="Your dev-buy" v={`${devUsdc} USDC`} mono />
            <div className="mt-2">
              <div className="text-mist text-xs">Predicted coin address — computed before you sign</div>
              {launch.predicted ? (
                <div className="tabular mt-1 break-all text-[13px]">{launch.predicted}</div>
              ) : launch.predictFailed ? (
                <div className="mt-1 flex flex-col items-start gap-1.5">
                  <p className="text-[13px]" style={{ color: "#ff8f6e" }}>
                    The shipyard couldn&apos;t find a berth for this name. Nudge the name or ticker.
                  </p>
                  <button onClick={launch.retryPredict} className="btn-deck btn-quiet px-3 py-1.5 text-xs">
                    Sound it again
                  </button>
                </div>
              ) : launch.mining ? (
                // Indeterminate on purpose. Completion is geometrically
                // distributed -- a percentage bar would be a fabricated number
                // that stalls near the end or jumps straight to done. Count
                // candidates actually found, and show the real work done.
                <div className="mt-1" role="status" aria-live="polite">
                  <div className="text-[13px]">
                    Sounding for a berth ending{" "}
                    <span className="tabular">8787</span>
                    {launch.miningAttempts > 0 && (
                      <span className="text-faint">
                        {" "}· {launch.miningAttempts.toLocaleString()} soundings
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-white/40 transition-[width] duration-300"
                      style={{ width: `${Math.max(4, launch.miningProgress * 100)}%` }}
                    />
                  </div>
                  <p className="text-faint mt-1 text-[11px]">
                    Every berth.club coin lands on an address ending 8787. Your browser is
                    finding yours — a few seconds.
                  </p>
                </div>
              ) : (
                <div className="text-faint mt-1 text-[13px]" role="status" aria-live="polite">
                  {gate ? "Connect on Arc Testnet to sound the address." : "Sounding the address…"}
                </div>
              )}
            </div>
          </div>

          {launch.blocked && !gate && (
            <p className="text-[13px]" style={{ color: "#ff8f6e" }}>
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
            <p className="text-[13px]" style={{ color: "#ff8f6e" }}>
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
              <button onClick={gate.act} className="btn-deck btn-lime px-6 py-3 text-[19px]">
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
          {upload.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={upload.previewUrl}
              alt={`${tickerUp} art`}
              className="animate-bob size-24 rounded-2xl object-cover"
              style={{ border: "1px solid rgba(94,147,234,0.2)" }}
            />
          ) : upload.imageUri ? (
            <CoinAvatar
              image={upload.imageUri}
              emoji={emoji}
              ticker={tickerUp}
              size={96}
              className="animate-bob rounded-2xl"
              style={{ border: "1px solid rgba(94,147,234,0.2)" }}
            />
          ) : (
            <span className="animate-bob text-6xl" aria-hidden>{emoji}</span>
          )}
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
    <div className="flex justify-between py-1.5 text-sm" style={{ borderBottom: "1px solid rgba(94,147,234,0.14)" }}>
      <span className="text-mist">{k}</span>
      <span className={cn(mono && "tabular")}>{v}</span>
    </div>
  )
}
