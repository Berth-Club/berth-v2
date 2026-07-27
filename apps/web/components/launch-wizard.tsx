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
import { buildConfig, normalizeTicker, parseUsdcInput, useLaunch } from "@/lib/launch"

/**
 * Launch a coin. v3 is ONE view — form on the left, a live preview + the fee
 * table stuck to the right — not a stepper. The only other state is the success
 * card, which replaces the whole thing once the receipt lands.
 *
 * Everything under the hood is unchanged: IPFS pin, CREATE2 address mining, and
 * a deploy simulation that gates the signature.
 */
export function LaunchWizard() {
  const [launched, setLaunched] = React.useState(false)
  // Armed = the creator hit "Launch token" and opened the confirm modal. ALL the
  // heavy work (salt mining, predict, deploy simulation) is gated on this, so
  // nothing computes while they're still typing — it starts on the click.
  const [armed, setArmed] = React.useState(false)
  const [name, setName] = React.useState("")
  const [ticker, setTicker] = React.useState("")
  const [lore, setLore] = React.useState("")
  const [twitter, setTwitter] = React.useState("")
  const [telegram, setTelegram] = React.useState("")
  const [website, setWebsite] = React.useState("")
  const [dragging, setDragging] = React.useState(false)

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

  // HOLD the art on drop (local preview only, no upload). It pins later — see
  // the deferred-pin effect below — so we never upload art the creator replaces
  // or abandons.
  const acceptFile = React.useCallback(
    (files: FileList | null) => {
      const f = files?.[0]
      if (f && /^image\/(png|jpeg|webp|gif)$/.test(f.type)) upload.hold(f)
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

  // Deferred IPFS pin. The drop only HELD the file; pin it once the coin is a
  // real work-in-progress — valid papers + a connected wallet (the pin route is
  // authed) — i.e. right before its CID is needed for metadata + the address.
  // A bare drop, or one on an unfinished/disconnected form, never uploads.
  const pinNow = upload.pin
  React.useEffect(() => {
    if (upload.held && !upload.imageUri && upload.status === "idle" && connected && !!config) {
      pinNow()
    }
  }, [upload.held, upload.imageUri, upload.status, connected, config, pinNow])

  const devUsdc = valueWei !== undefined ? Number(devBuy) || 0 : 0
  const badDevBuy = valueWei === undefined

  // The image is part of metadataURI, so a pin in flight means the config (and
  // thus the mined address) is not final yet. But an image is OPTIONAL — "drag an
  // image, or pick a face" — so we only block while a file the creator actually
  // dropped is still pinning. Emoji-only (nothing held) launches freely. An
  // upload OUTAGE also unlocks the launch rather than trapping the creator.
  const degradedAllowed = upload.outage || !upload.available
  const imageBlocking =
    upload.status === "uploading" || (upload.held && !upload.imageUri && !degradedAllowed)

  // The simulation is a full deploy eth_call. Without a review step to hang it
  // on it runs whenever the form is genuinely launchable — which is the same
  // set of moments the old step-2 gate covered, minus the extra click.
  const formReady = !!config && !badDevBuy && !imageBlocking
  // Gated on `armed`: no salt grind or simulation until they click Launch.
  const launch = useLaunch(config, valueWei, armed && formReady && connected && !wrongNetwork)

  // Advisory only — instant, works before connecting. The authority is the
  // on-chain simulation (launch.blocked).
  const overCap = devUsdc > launch.capUsdc
  const devPct = (devUsdc / launch.capUsdc) * launch.capPct
  const canLaunch = formReady && !overCap

  const gate = !connected
    ? { label: "Connect wallet", act: connect }
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
      setLaunched(true)
    }
  }, [launch.status, celebrate, tickerUp])

  const face = upload.previewUrl ? (
    // Preview is the LOCAL file (object URL), not the gateway — a just-pinned
    // CID can briefly 404 and would flash the fallback.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={upload.previewUrl} alt={`${tickerUp} art`} className="size-full object-cover" />
  ) : null

  if (launched) {
    return (
      <div className="glass mx-auto mt-[30px] max-w-[560px] p-9 text-center">
        {upload.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={upload.previewUrl}
            alt={`${tickerUp} art`}
            className="animate-bob mx-auto size-24 rounded-2xl object-cover"
            style={{ border: "1px solid rgba(148,168,196,0.2)" }}
          />
        ) : upload.imageUri ? (
          <CoinAvatar
            image={upload.imageUri}
            emoji={emoji}
            ticker={tickerUp}
            size={96}
            className="animate-bob mx-auto rounded-2xl"
            style={{ border: "1px solid rgba(148,168,196,0.2)" }}
          />
        ) : (
          <div className="animate-bob text-[56px]" aria-hidden>
            {emoji}
          </div>
        )}
        <h2 className="font-display mt-2 text-[30px]">${tickerUp} has left the shipyard</h2>
        <p className="text-mist mb-[22px] mt-2">Block confirmed. Calm seas and green candles, captain.</p>
        <div className="flex flex-wrap justify-center gap-2.5">
          {launch.token && (
            <Link href={`/token/${launch.token}`} className="btn-glossy px-[22px] py-[13px] text-base">
              View your coin
            </Link>
          )}
          <Link href="/" className="btn-ghost bg-deep px-[22px] py-[13px] text-base">
            Back home
          </Link>
        </div>
        {launch.hash && (
          <a
            href={explorerTx(launch.hash)}
            target="_blank"
            rel="noreferrer"
            className="text-mist mt-4 block text-xs underline"
          >
            View the launch transaction ↗
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-start gap-4">
      {/* ---- the form ---- */}
      <div className="glass min-w-0 flex-[1.7_1_460px] p-[26px]">
        <h1 className="font-display mb-[18px] text-[26px]">Launch token</h1>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label="Name" hint="Letters, numbers, spaces. 32 max.">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 32))}
              placeholder="Token name"
              className={inputCls}
            />
          </Field>
          <Field label="Ticker" hint="Letters and numbers. 10 max.">
            <input
              value={ticker}
              onChange={(e) => setTicker(normalizeTicker(e.target.value))}
              placeholder="symbol"
              className={cn(inputCls, "tabular uppercase")}
            />
          </Field>
        </div>

        <div className="mt-3.5">
          <Field label="Description" hint="No links. 140 characters max.">
            <input
              value={lore}
              onChange={(e) => setLore(e.target.value.slice(0, 140))}
              placeholder="A short description of the token"
              className={inputCls}
            />
          </Field>
        </div>

        {/* image or face */}
        <div className="mt-3.5">
          <FieldLabel>Token image</FieldLabel>
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
            className="flex flex-wrap items-center gap-3 rounded-xl p-1 transition-colors"
            style={{ background: dragging ? "rgba(143,176,232,.06)" : "transparent" }}
          >
            <div
              className="bg-deep relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-[10px] text-2xl"
              style={{ border: `1px dashed ${dragging ? "#8fb0e8" : "rgba(148,168,196,.3)"}` }}
            >
              {face ?? <span aria-hidden>{emoji}</span>}
              {upload.status === "uploading" && (
                <span className="text-foam absolute inset-0 grid place-items-center bg-black/50 text-[11px] font-bold">
                  pinning…
                </span>
              )}
            </div>

            <label className="text-gold hover:bg-lime/10 cursor-pointer rounded-full px-[15px] py-2.5 text-xs font-semibold transition-colors"
              style={{ letterSpacing: ".08em", border: "1px solid #89a7db" }}
            >
              UPLOAD
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

            {/* Faces are only an option while there's no pinned art. */}
            {(!upload.previewUrl || upload.status === "error") && (
              <div className="flex flex-wrap gap-1.5">
                {FACE_OPTIONS.slice(0, 10).map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEmoji(e)}
                    aria-pressed={emoji === e}
                    className="bg-deep grid size-9 place-items-center rounded-lg text-[19px] transition-transform hover:scale-110"
                    style={{ border: `1.5px solid ${emoji === e ? "#89a7db" : "rgba(148,168,196,.2)"}` }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          <UploadStatus upload={upload} connected={connected} connect={connect} />
        </div>

        {/* socials */}
        <div
          className="mt-3.5 grid gap-3.5"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}
        >
          <Field label="X profile">
            <input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="x.com/handle" className={inputCls} inputMode="url" />
          </Field>
          <Field label="Telegram">
            <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="t.me/community" className={inputCls} inputMode="url" />
          </Field>
          <Field label="Website">
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="berth.club" className={inputCls} inputMode="url" />
          </Field>
        </div>

        {/* dev buy */}
        <div className="mt-3.5">
          <FieldLabel>Developer buy — your own first buy, optional</FieldLabel>
          <div
            className="well flex items-center gap-2 py-1 pl-3.5 pr-1"
            style={overCap || badDevBuy ? { borderColor: "#de8092" } : undefined}
          >
            <input
              value={devBuy}
              onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              inputMode="decimal"
              aria-label="Developer buy in USDC"
              className="tabular min-w-0 flex-1 bg-transparent py-2.5 text-base font-semibold outline-none"
            />
            <span
              className="bg-hull flex shrink-0 items-center gap-[7px] rounded-full px-3 py-1.5 text-[12.5px] font-semibold"
              style={{ border: "1px solid rgba(148,168,196,.25)" }}
            >
              <img src="/usdc.png" alt="" width="15" height="15" className="block shrink-0" aria-hidden />
              USDC
            </span>
          </div>
          {/* The cap comes off the chain, never a hardcoded number — the factory
              admin can move it, and a stale copy here would let someone pay gas
              to revert. */}
          {badDevBuy ? (
            <p className="mt-1.5 text-[12.5px] font-semibold" style={{ color: "#de8092" }}>
              That dev-buy isn&apos;t a number.
            </p>
          ) : overCap ? (
            <p className="mt-1.5 text-[12.5px] font-semibold" style={{ color: "#de8092" }}>
              Over the cap — max <span className="tabular">{launch.capUsdc}</span> USDC (~
              {launch.capPct}% of supply). The launch would revert; we won&apos;t let you pay gas to
              fail.
            </p>
          ) : devUsdc > 0 ? (
            <p className="text-faint mt-1.5 text-[11.5px]">
              ≈ <span className="tabular">{devPct.toFixed(2)}</span>% of supply · max{" "}
              <span className="tabular">{launch.capUsdc}</span> USDC
            </p>
          ) : (
            <p className="text-faint mt-1.5 text-[11.5px]">
              Max <span className="tabular">{launch.capUsdc}</span> · ~{launch.capPct}% of supply
            </p>
          )}
        </div>

        <div
          className="text-faint mt-[18px] flex flex-wrap items-center justify-between gap-2.5 pt-4 text-[12.5px]"
          style={{ borderTop: "1px solid rgba(148,168,196,.14)" }}
        >
          <span>One transaction: mint · token/USDC pool · LP locked</span>
          <span className="tabular">1 USDC due</span>
        </div>

        {gate ? (
          <button onClick={gate.act} className="btn-glossy mt-3 w-full py-[15px] text-base">
            {gate.label}
          </button>
        ) : (
          // Opens the confirm modal — the address grind + simulation start there,
          // not on every keystroke.
          <button
            onClick={() => setArmed(true)}
            disabled={!canLaunch}
            className="btn-glossy mt-3 w-full py-[15px] text-base"
          >
            Launch token
          </button>
        )}
      </div>

      {/* ---- live preview + the deal ---- */}
      <div className="glass w-full flex-[1_1_280px] p-[26px] lg:sticky lg:top-[104px] lg:max-w-[380px]">
        <div
          className="bg-deep grid size-[76px] place-items-center overflow-hidden rounded-[14px] text-4xl"
          style={{ border: "1px solid rgba(148,168,196,.2)" }}
        >
          {face ?? <span aria-hidden>{emoji}</span>}
        </div>
        <div className="font-display mt-3.5 text-2xl">{name || "Your token"}</div>
        <div className="text-faint tabular mt-0.5 text-[13.5px]">${tickerUp}</div>

        <div className="mt-[18px]">
          <Deal k="Launch fee" v="1 USDC" mono />
          <Deal k="Trading fees" v="1% · split with creator" />
          <Deal k="Graduation" v="8,787 USDC" mono />
          <Deal k="Pool" v="token / USDC" />
          <Deal k="Liquidity" v="Locked forever" tone="#7cc9a3" last />
        </div>

        <p className="text-faint mt-3.5 text-xs">
          Supply is fixed at 100B for every ship. Team allocation 0%. Keys burned at launch.
        </p>
      </div>

      {/* ---- confirm modal: computes on open, launches on confirm ---- */}
      {armed && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: "rgba(3,8,16,.72)", backdropFilter: "blur(4px)" }}
          onClick={() => {
            if (launch.status !== "signing" && launch.status !== "mining") {
              launch.reset()
              setArmed(false)
            }
          }}
        >
          <div className="glass w-full max-w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-[22px]">Launch ${tickerUp}</h2>
            <p className="text-mist mt-1 text-[13px]">
              One transaction mints the supply, opens the token/USDC pool, and locks the LP forever.
            </p>

            {/* identity */}
            <div className="well mt-4 flex items-center gap-3 p-3">
              <div
                className="bg-deep grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl text-2xl"
                style={{ border: "1px solid rgba(148,168,196,.2)" }}
              >
                {face ?? <span aria-hidden>{emoji}</span>}
              </div>
              <div className="min-w-0">
                <div className="truncate font-semibold">{name || "Your token"}</div>
                <div className="text-faint tabular text-[12.5px]">${tickerUp}</div>
              </div>
            </div>

            {/* terms */}
            <div className="mt-4 flex flex-col gap-2 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-faint">Launch fee</span>
                <span className="tabular">1 USDC</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-faint">Developer buy</span>
                <span className="tabular">{devUsdc || 0} USDC</span>
              </div>
            </div>

            {/* address grind + on-chain simulation, started by opening this modal */}
            <PredictStatus launch={launch} gate={false} show />

            <div className="mt-5 flex gap-2.5">
              <button
                onClick={() => {
                  launch.reset()
                  setArmed(false)
                }}
                disabled={launch.status === "signing" || launch.status === "mining"}
                className="btn-ghost bg-deep flex-1 py-3 text-[15px] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={launch.launch}
                disabled={!launch.ready || launch.status === "signing" || launch.status === "mining"}
                className="btn-glossy flex-[1.5] py-3 text-[15px]"
              >
                {launch.status === "signing"
                  ? "Check your wallet…"
                  : launch.status === "mining"
                    ? "Leaving the yard…"
                    : launch.ready
                      ? "Confirm & launch"
                      : launch.blocked
                        ? "Can't launch"
                        : "Preparing…"}
              </button>
            </div>

            {launch.error && (
              <p className="mt-2.5 text-center text-[13px]" style={{ color: "#de8092" }}>
                {launch.error}
              </p>
            )}
            {launch.hash && (
              <a
                href={explorerTx(launch.hash)}
                target="_blank"
                rel="noreferrer"
                className="text-mist mt-2 block text-center text-xs underline"
              >
                Track the transaction ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const inputCls =
  "well w-full px-3.5 py-3 text-[14.5px] outline-none"

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-mist mb-1.5 text-[12.5px] font-semibold">{children}</div>
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      {children}
      {hint && <div className="text-faint mt-1.5 text-[11.5px]">{hint}</div>}
    </label>
  )
}

function Deal({
  k,
  v,
  mono,
  tone,
  last,
}: {
  k: string
  v: string
  mono?: boolean
  tone?: string
  last?: boolean
}) {
  return (
    <div
      className="flex justify-between py-2.5 text-[13.5px]"
      style={{
        borderTop: "1px solid rgba(148,168,196,.14)",
        borderBottom: last ? "1px solid rgba(148,168,196,.14)" : undefined,
      }}
    >
      <span className="text-mist">{k}</span>
      <span className={cn(mono && "tabular")} style={tone ? { color: tone } : undefined}>
        {v}
      </span>
    </div>
  )
}

function UploadStatus({
  upload,
  connected,
  connect,
}: {
  upload: ReturnType<typeof useImageUpload>
  connected: boolean
  connect: () => void
}) {
  if (upload.status === "uploading") return <Note>Pinning to IPFS…</Note>
  if (upload.status === "done") return <Note tone="#89a7db">Pinned ✓ — this is your coin&apos;s face.</Note>
  if (upload.status === "error" && upload.needsAuth) {
    // Not an outage — just not signed in (or a token glitch).
    return (
      <button
        type="button"
        onClick={() => (connected ? upload.retry() : connect())}
        className="text-gold mt-1.5 text-[11.5px] underline underline-offset-2"
      >
        {connected ? "Retry upload →" : "Connect your wallet to upload art →"}
      </button>
    )
  }
  if (upload.status === "error" && upload.outage)
    return <Note tone="#89a7db">Art upload is unavailable right now — launch with a face instead.</Note>
  if (upload.status === "error") return <Note tone="#de8092">{upload.error}</Note>
  return <Note>Drag an image here, or pick a face. PNG, JPEG, WebP or GIF.</Note>
}

function Note({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <p className="text-faint mt-1.5 text-[11.5px]" style={tone ? { color: tone } : undefined}>
      {children}
    </p>
  )
}

/**
 * The CREATE2 address hunt and the deploy simulation, inline above the CTA.
 * Every berth.club coin lands on an address ending 8787, and the browser mines
 * the salt for it — this is real work with a real wait, so it is never hidden.
 */
function PredictStatus({
  launch,
  gate,
  show,
}: {
  launch: ReturnType<typeof useLaunch>
  gate: boolean
  show: boolean
}) {
  if (!show) return null

  return (
    <div className="mt-3.5" role="status" aria-live="polite">
      {launch.predicted ? (
        <div className="text-faint text-[11.5px]">
          Your berth: <span className="tabular text-body2 break-all">{launch.predicted}</span>
        </div>
      ) : launch.predictFailed ? (
        <div className="flex flex-col items-start gap-1.5">
          <p className="text-[12.5px]" style={{ color: "#de8092" }}>
            The shipyard couldn&apos;t find a berth for this name. Nudge the name or ticker.
          </p>
          <button onClick={launch.retryPredict} className="btn-ghost px-3 py-1.5 text-xs">
            Sound it again
          </button>
        </div>
      ) : launch.mining ? (
        // Indeterminate on purpose. Completion is geometrically distributed — a
        // percentage bar would be a fabricated number that stalls near the end
        // or jumps straight to done. Count soundings actually made instead.
        <>
          <div className="text-[12.5px]">
            Sounding for a berth ending <span className="tabular">8787</span>
            {launch.miningAttempts > 0 && (
              <span className="text-faint"> · {launch.miningAttempts.toLocaleString()} soundings</span>
            )}
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-white/40 transition-[width] duration-300"
              style={{ width: `${Math.max(4, launch.miningProgress * 100)}%` }}
            />
          </div>
        </>
      ) : (
        <div className="text-faint text-[12.5px]">
          {gate ? "Connect on Arc Testnet to sound the address." : "Sounding the address…"}
        </div>
      )}

      {launch.blocked && !gate && (
        <p className="mt-1.5 text-[12.5px]" style={{ color: "#de8092" }}>
          {launch.blocked}
        </p>
      )}
      {/* A dead button with no reason is the worst of both worlds: it knows
          something is wrong and won't say what. Name the wait too. */}
      {launch.checking && !gate && !launch.blocked && (
        <p className="text-mist mt-1.5 text-[12.5px]">Checking the launch against the chain…</p>
      )}
    </div>
  )
}
