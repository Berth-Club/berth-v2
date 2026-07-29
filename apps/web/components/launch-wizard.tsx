"use client"

import * as React from "react"
import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"
import { useFx } from "@/components/fx-provider"
import { useWallet } from "@/components/wallet-provider"
import { useImageUpload } from "@/lib/use-image-upload"
import { explorerTx } from "@/lib/chain"
import { buildConfig, normalizeTicker, parseUsdcInput, useCurvePresets, useLaunch } from "@/lib/launch"
import { isNameBlocked, isTickerBlocked } from "@/lib/blocklist"

/**
 * Launch a coin. v3 FINAL is ONE view — form on the left, a live preview + the
 * fee table stuck to the right — not a stepper. The only other state is the
 * success card, which replaces the whole thing once the receipt lands.
 *
 * No emoji anywhere: coin art is either an uploaded image or a neutral
 * placeholder. Everything under the hood is unchanged — deferred IPFS pin,
 * CREATE2 address mining, and a deploy simulation that gates the signature.
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
  const [dragging, setDragging] = React.useState(false)
  // IPFS consent gate: the drop-zone is disabled until the creator confirms the
  // art will be moderated and pinned to public IPFS.
  const [ipfsOk, setIpfsOk] = React.useState(false)
  const [advOpen, setAdvOpen] = React.useState(false)

  const [devBuy, setDevBuy] = React.useState("")
  // Fee tier = which curve preset the coin launches (and thus trades) against.
  // 0 → 1% (default), 1 → 0.3%, 2 → 0.05%. Read live from the factory.
  const [curveConfigId, setCurveConfigId] = React.useState(0n)
  const { presets } = useCurvePresets()
  const feeLabel = presets.find((p) => p.id === curveConfigId)?.label ?? "1%"
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
  const nameBlocked = isNameBlocked(name) || isTickerBlocked(tickerUp)

  // Memoized: this object is a query key for the predict read and the deploy
  // simulation. A fresh identity every render would refetch forever.
  //
  // lore ANd the image URI ARE deps: they go into metadataURI, which is a
  // constructor arg and therefore part of the CREATE2 initcode hash. Leave them
  // out and the previewed address stops matching the one that gets deployed.
  // There is no emoji picker anymore, so buildConfig's emoji arg defaults — the
  // coin launches identically whether or not an image was uploaded.
  const config = React.useMemo(
    () =>
      name.trim() && normalizeTicker(ticker)
        ? buildConfig(name, ticker, lore, undefined, upload.imageUri ?? undefined, {
            twitter: twitter.trim() || undefined,
            telegram: telegram.trim() || undefined,
          })
        : undefined,
    [name, ticker, lore, upload.imageUri, twitter, telegram]
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
  // thus the mined address) is not final yet. But an image is OPTIONAL — launch
  // with art or with the neutral placeholder — so we only block while a file the
  // creator actually dropped is still pinning. A no-image launch proceeds
  // freely. An upload OUTAGE also unlocks the launch rather than trapping them.
  const degradedAllowed = upload.outage || !upload.available
  const imageBlocking =
    upload.status === "uploading" || (upload.held && !upload.imageUri && !degradedAllowed)

  // The simulation is a full deploy eth_call. Without a review step to hang it
  // on it runs whenever the form is genuinely launchable — which is the same
  // set of moments the old step-2 gate covered, minus the extra click.
  const formReady = !!config && !badDevBuy && !imageBlocking && !nameBlocked
  // Gated on `armed`: no salt grind or simulation until they click Launch.
  const launch = useLaunch(config, valueWei, armed && formReady && connected && !wrongNetwork, curveConfigId)

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
      celebrate(`$${tickerUp} is live`)
      setLaunched(true)
    }
  }, [launch.status, celebrate, tickerUp])

  if (launched) {
    return (
      <div className="glass mx-auto mt-[30px] max-w-[560px] p-9 text-center">
        {/* Show the coin's own art (the local preview, still valid on this same
            component) so the creator sees what they launched — with a small check
            badge for the confirmation. Falls back to the plain check when there's
            no uploaded image. */}
        {upload.previewUrl ? (
          <div className="relative mx-auto size-[76px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={upload.previewUrl}
              alt={`${tickerUp} art`}
              className="size-full rounded-2xl object-cover"
              style={{ border: "1px solid rgba(137,167,219,.45)" }}
            />
            <span
              className="absolute -bottom-1.5 -right-1.5 grid size-6 place-items-center rounded-full"
              style={{ background: "#b7c9ee", border: "2px solid #0d1a2b" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M5 13l4 4L19 7" stroke="#0d2340" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        ) : (
          <div
            className="mx-auto grid size-[72px] place-items-center rounded-full"
            style={{ background: "rgba(137,167,219,.1)", border: "1px solid rgba(137,167,219,.45)" }}
          >
            <CheckIcon />
          </div>
        )}
        <h2 className="font-display mt-4 text-[26px]">${tickerUp} is live</h2>
        <p className="text-mist mb-[22px] mt-2">Block confirmed. Pool created, liquidity locked.</p>
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
    <>
      <Link href="/" className="btn-frost mb-4 inline-flex items-center gap-[7px] px-4 py-[9px] text-[13.5px]">
        ‹ Back
      </Link>

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
              {nameBlocked && (
                <p className="mt-1 text-[12px]" style={{ color: "#de8092" }}>
                  This name is reserved. Pick another.
                </p>
              )}
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
              <textarea
                value={lore}
                onChange={(e) => setLore(e.target.value.slice(0, 140))}
                placeholder="A short description of the token"
                rows={3}
                className={cn(inputCls, "resize-y font-sans")}
              />
            </Field>
          </div>

          {/* image — gated behind the IPFS consent checkbox */}
          <div className="mt-3.5">
            <FieldLabel>Token image</FieldLabel>
            <label className="text-mist mb-2.5 mt-0.5 flex cursor-pointer items-start gap-[9px] text-[12.5px] leading-relaxed">
              <input
                type="checkbox"
                checked={ipfsOk}
                onChange={(e) => setIpfsOk(e.target.checked)}
                className="mt-0.5 size-[15px] shrink-0"
                style={{ accentColor: "#89a7db" }}
              />
              I understand that selected artwork will be moderated and uploaded to public IPFS.
            </label>

            {ipfsOk ? (
              <label
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
                className="flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl px-[18px] py-7 text-center transition-colors"
                style={{
                  border: `1.5px dashed ${dragging ? "#89a7db" : "rgba(137,167,219,.5)"}`,
                  background: dragging ? "rgba(137,167,219,.06)" : "rgba(8,17,30,.5)",
                }}
              >
                <div className="relative size-11 shrink-0 overflow-hidden rounded-[10px]">
                  {upload.previewUrl ? (
                    // Preview is the LOCAL file (object URL), not the gateway — a
                    // just-pinned CID can briefly 404 and would flash the fallback.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={upload.previewUrl} alt={`${tickerUp} art`} className="size-full object-cover" />
                  ) : (
                    <ImagePlaceholder size={44} strong />
                  )}
                  {upload.status === "uploading" && (
                    <span className="text-foam absolute inset-0 grid place-items-center bg-black/50 text-[10px] font-bold">
                      pinning…
                    </span>
                  )}
                </div>
                <div className="text-body2 text-sm font-semibold">
                  {upload.previewUrl ? "Replace token image" : "Upload token image"}
                </div>
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
            ) : (
              <div
                className="flex flex-col items-center justify-center gap-2.5 rounded-xl px-[18px] py-7 text-center"
                style={{ border: "1.5px dashed rgba(148,168,196,.25)", background: "rgba(8,17,30,.35)" }}
              >
                <div
                  className="grid size-11 shrink-0 place-items-center rounded-[10px]"
                  style={{ background: "#0b1929", border: "1px solid rgba(148,168,196,.18)" }}
                >
                  <ImagePlaceholder size={44} />
                </div>
                <div className="text-faint text-sm font-semibold">Confirm public upload first</div>
              </div>
            )}

            {upload.previewUrl && (
              <button
                type="button"
                onClick={upload.reset}
                className="text-faint mt-1.5 inline-block text-[11.5px] underline underline-offset-[3px]"
              >
                Remove image
              </button>
            )}

            <UploadStatus upload={upload} connected={connected} connect={connect} />
          </div>

          {/* socials — X / Telegram two-up */}
          <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="X profile">
              <input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="x.com/handle" className={inputCls} inputMode="url" />
            </Field>
            <Field label="Telegram">
              <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="t.me/community" className={inputCls} inputMode="url" />
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
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

          {/* fee tier — which curve preset (and pool fee tier) the coin launches
              against. Presets are read live; 1% is the default. */}
          {presets.length > 1 && (
            <div className="mt-3.5">
              <FieldLabel>Fee tier</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => {
                  const on = p.id === curveConfigId
                  return (
                    <button
                      key={p.id.toString()}
                      type="button"
                      onClick={() => setCurveConfigId(p.id)}
                      aria-pressed={on}
                      className={cn(
                        "rounded-full px-4 py-2 text-[13.5px] font-semibold transition-colors",
                        on ? "btn-glossy" : "btn-frost text-body2"
                      )}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-faint mt-1.5 text-[11.5px]">
                The trade fee on every swap, split with you. Lower tiers suit tighter,
                higher-volume markets. Default 1%.
              </p>
            </div>
          )}

          {/* Advanced — the one-transaction / fee fine print, collapsed by default */}
          <button
            type="button"
            onClick={() => setAdvOpen((v) => !v)}
            aria-expanded={advOpen}
            className="text-body2 hover:text-foam mt-[18px] flex w-full items-center justify-between pt-4 text-[14.5px] font-semibold"
            style={{ borderTop: "1px solid rgba(148,168,196,.14)" }}
          >
            <span>Advanced</span>
            <span
              className="text-faint inline-block transition-transform duration-200"
              style={{ transform: advOpen ? "rotate(180deg)" : "none" }}
              aria-hidden
            >
              ⌄
            </span>
          </button>
          {advOpen && (
            <div className="text-faint mt-2.5 text-[12.5px] leading-[1.7]">
              One transaction: mint, token/USDC pool, LP locked. Launch fee 1 USDC. Supply fixed at
              100B — no team allocation, keys burned at launch.
            </div>
          )}

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
          <div className="size-[76px] overflow-hidden rounded-[14px]">
            {upload.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={upload.previewUrl} alt={`${tickerUp} art`} className="size-full object-cover" style={{ border: "1px solid rgba(148,168,196,.2)" }} />
            ) : (
              <div
                className="grid size-full place-items-center rounded-[14px]"
                style={{ background: "#0b1929", border: "1px solid rgba(148,168,196,.2)" }}
              >
                <ImagePlaceholder size={76} />
              </div>
            )}
          </div>
          <div className="font-display mt-3.5 text-2xl">{name || "Your token"}</div>
          <div className="text-faint tabular mt-0.5 text-[13.5px]">${tickerUp}</div>

          <div className="mt-[18px]">
            <Deal k="Launch fee" v="1 USDC" mono />
            <Deal k="Trading fees" v={`${feeLabel} · split with creator`} />
            <Deal k="Graduation" v="8,787 USDC" mono />
            <Deal k="Pool" v="token / USDC" />
            <Deal k="Liquidity" v="Locked" tone="#7cc9a3" last />
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
                <div className="size-11 shrink-0 overflow-hidden rounded-xl">
                  {upload.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={upload.previewUrl} alt={`${tickerUp} art`} className="size-full object-cover" style={{ border: "1px solid rgba(148,168,196,.2)" }} />
                  ) : (
                    <div
                      className="grid size-full place-items-center rounded-xl"
                      style={{ background: "#0b1929", border: "1px solid rgba(148,168,196,.2)" }}
                    >
                      <ImagePlaceholder size={44} />
                    </div>
                  )}
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
    </>
  )
}

const inputCls = "well w-full px-3.5 py-3 text-[14.5px] outline-none"

/** Neutral image placeholder — a framed-picture glyph, never an emoji. */
function ImagePlaceholder({ size, strong }: { size: number; strong?: boolean }) {
  const px = Math.round(size * 0.45)
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={strong ? "#93a8c4" : "#6e82a0"}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5-11 11" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#89a7db" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

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
        className="text-gold mt-1.5 block text-[11.5px] underline underline-offset-2"
      >
        {connected ? "Retry upload →" : "Connect your wallet to upload art →"}
      </button>
    )
  }
  if (upload.status === "error" && upload.outage)
    return <Note tone="#89a7db">Art upload is unavailable right now — launch without an image instead.</Note>
  if (upload.status === "error") return <Note tone="#de8092">{upload.error}</Note>
  return null
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
