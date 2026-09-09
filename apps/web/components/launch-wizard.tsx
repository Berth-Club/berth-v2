"use client"

import * as React from "react"
import Link from "next/link"
import { formatEther, type Address, type Hex } from "viem"

import { CONSTANTS } from "@workspace/contracts"
import { cn } from "@workspace/ui/lib/utils"
import { useFx } from "@/components/fx-provider"
import { useWallet } from "@/components/wallet-provider"
import { useImageUpload } from "@/lib/use-image-upload"
import { explorerTx } from "@/lib/chain"
import {
  NATIVE_QUOTE,
  buildTokenParams,
  normalizeTicker,
  parseUsdcInput,
  randomSalt,
  useLaunch,
  useLaunchTerms,
  useQuoteAsset,
  type FeeMode,
} from "@/lib/launch"
import { isNameBlocked, isTickerBlocked } from "@/lib/blocklist"

/**
 * Launch a coin — the v4 four-card flow with a sticky preview rail.
 *
 * 01 Your token · 02 Pick a pair · 03 Your fees · 04 Dev buy & launch, with the
 * live preview card, a details box and the "nothing to rug" note stuck to the
 * right. The success card replaces the whole thing once the receipt lands.
 *
 * Every control here is a real contract parameter on v2. The pair picker writes
 * `pairToken`; the three fee-destination cards write ONE address into
 * `creatorFeeRecipient` (the deployer, the holder vault, or the burn vault);
 * the slider writes `creatorTaxBps`; the fee-wallet field is the keep-mode
 * recipient. The whole thing goes through `router.launchAndBuyWithNative` so
 * the creator's opening buy lands in the launch transaction itself.
 *
 * v2 has NO dev-buy cap and NO vanity address requirement, so neither the cap
 * warnings nor the salt-mining progress from v1.4 exist any more.
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
  const [website, setWebsite] = React.useState("")
  const [twitter, setTwitter] = React.useState("")
  const [telegram, setTelegram] = React.useState("")
  const [dragging, setDragging] = React.useState(false)
  // IPFS consent gate: the drop-zone is disabled until the creator confirms the
  // art will be moderated and pinned to public IPFS.
  const [ipfsOk, setIpfsOk] = React.useState(false)
  const [socialsOpen, setSocialsOpen] = React.useState(false)

  const [pair, setPair] = React.useState<PairKey>("USDC")
  const [anyToken, setAnyToken] = React.useState("")
  const [feeDest, setFeeDest] = React.useState<FeeMode>("keep")
  const [creatorTax, setCreatorTax] = React.useState(0)
  const [feeWallet, setFeeWallet] = React.useState("")

  const [devMode, setDevMode] = React.useState<"spend" | "tokens">("spend")
  const [devBuy, setDevBuy] = React.useState("")

  // A new salt is a new token address, which is a new pool key — the only
  // recovery from PoolAlreadyExists. Held in state so a retry actually changes
  // the params rather than replaying the collision.
  const [salt, setSalt] = React.useState<Hex>(() => randomSalt())

  const terms = useLaunchTerms()
  const baseFeePct = terms.baseFeeBps / 100
  const feeLabel = `${baseFeePct.toFixed(baseFeePct % 1 ? 1 : 0)}%`
  const maxTaxPct = terms.maxCreatorTaxBps / 100

  // USDC is native (address(0)); the 6dp ERC20 face is refused on-chain. BERTH
  // has no address in this deployment yet, so it is not selectable.
  const pairToken: Address =
    pair === "ANY" && /^0x[0-9a-fA-F]{40}$/.test(anyToken.trim())
      ? (anyToken.trim() as Address)
      : NATIVE_QUOTE
  const quote = useQuoteAsset(pairToken)
  const { celebrate } = useFx()
  const { connected, wrongNetwork, switchToArc, connect, getAccessToken } = useWallet()
  const upload = useImageUpload(getAccessToken)

  // If the creator picked art before connecting, the pin failed on auth. Retry
  // it ONCE the moment a wallet connects, so they don't have to re-pick.
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

  const tickerUp = normalizeTicker(ticker) || "TICKER"
  const nameBlocked = isNameBlocked(name) || isTickerBlocked(tickerUp)

  // Memoized: this object is the simulation's query key. A fresh identity every
  // render would refetch forever. Every field is a constructor arg or a launch
  // term, so the dep list has to be complete — a stale param would be simulated
  // and then not be what gets signed.
  const params = React.useMemo(
    () =>
      name.trim() && normalizeTicker(ticker)
        ? buildTokenParams({
            name,
            symbol: normalizeTicker(ticker),
            logo: upload.imageUri ?? "",
            description: lore,
            socials: { website, twitter, telegram },
            feeMode: feeDest,
            feeWallet,
            creatorTaxBps: Math.round(creatorTax * 100),
            expectedEconomics: quote.expectedEconomics,
            salt,
          })
        : undefined,
    [
      name, ticker, lore, upload.imageUri, website, twitter, telegram,
      feeDest, feeWallet, creatorTax, quote.expectedEconomics, salt,
    ]
  )

  // Deferred IPFS pin. The drop only HELD the file; pin it once the coin is a
  // real work-in-progress — valid papers + a connected wallet (the pin route is
  // authed) — i.e. right before its CID is needed for metadata + the address.
  const pinNow = upload.pin
  React.useEffect(() => {
    if (upload.held && !upload.imageUri && upload.status === "idle" && connected && !!params) {
      pinNow()
    }
  }, [upload.held, upload.imageUri, upload.status, connected, params, pinNow])

  // The logo is a constructor arg, so a pin in flight means the params are not
  // final. An image is OPTIONAL, so we only block while a file the creator
  // actually dropped is still pinning. An upload OUTAGE also unlocks the launch
  // rather than trapping them.
  const degradedAllowed = upload.outage || !upload.available
  const imageBlocking =
    upload.status === "uploading" || (upload.held && !upload.imageUri && !degradedAllowed)

  // Tokens mode is a display mode, not a second contract path: the chain takes
  // a native value either way. The pool opens at phantomQuote/supply, so that
  // is the rate — an OPENING price, so the estimate drifts as the buy itself
  // walks the curve. The simulation is the authority, and this only feeds a
  // hint, so a linear read is honest enough as long as it says "≈".
  const openingPricePerToken =
    Number(terms.phantomQuote) / 1e18 / CONSTANTS.supplyTokens
  const devUsdcStr =
    devMode === "spend" ? devBuy : tokensToUsdc(devBuy, openingPricePerToken)
  const valueWei = parseUsdcInput(devUsdcStr)
  const badDevBuy = valueWei === undefined
  const devUsdc = valueWei !== undefined ? Number(devUsdcStr) || 0 : 0
  const devTokens = openingPricePerToken > 0 ? devUsdc / openingPricePerToken : 0

  // An ERC-20 quote has to clear the pricer before it can be paired against.
  const quoteRefused = pair === "ANY" && quote.priceable === false
  const formReady =
    !!params && !badDevBuy && !imageBlocking && !nameBlocked && !quoteRefused
  // Gated on `armed`: no simulation until they click Launch.
  const launch = useLaunch(
    params,
    pairToken,
    valueWei,
    armed && formReady && connected && !wrongNetwork
  )

  const canLaunch = formReady && terms.canLaunch

  const gate = !connected
    ? { label: "Connect wallet", act: connect }
    : wrongNetwork
      ? { label: "Switch to Arc", act: switchToArc }
      : undefined

  const quoteSym = pair === "ANY" ? (anyToken.trim() ? shortQuote(anyToken) : "TOKEN") : pair
  // Opening FDV == phantomQuote, read from the launch config rather than the
  // mock's illustrative 5,000. v2 has no graduation threshold to show instead.
  const openingMc = `${Math.round(Number(terms.phantomQuote) / 1e18).toLocaleString()} ${quoteSym}`
  const totalFee = `${(baseFeePct + creatorTax).toFixed(1)}%`

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
      {/* ── page header ── */}
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[620px]">
          <h1 className="font-display text-[clamp(26px,3.4vw,34px)]">Launch a coin</h1>
          <p className="text-mist mt-2.5 text-[14.5px] leading-[1.7] text-pretty">
            Every token launches with the same fixed 1B supply, sealed into a locked pool from the
            first block. Pick what it trades against. No presale, no allocations, no fine print.
          </p>
        </div>
        <Link href="/docs" className="btn-frost text-body2 hover:text-foam px-4 py-2.5 text-[13.5px] font-semibold">
          How it works →
        </Link>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        {/* ── the four cards ── */}
        <div className="flex min-w-0 flex-[1.7_1_480px] flex-col gap-3.5">
          {/* 01 ─ Your token */}
          <section className="glass p-[26px]">
            <CardHead
              title="Your token"
              sub="Give it a name, a symbol and some artwork. The rest can wait."
              icon={
                <path d="M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4" />
              }
            />

            <div className="mt-[18px] grid gap-3.5 sm:grid-cols-[210px_minmax(0,1fr)]">
              {/* art */}
              <div>
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
                    className="flex h-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl px-3.5 py-6 text-center transition-colors"
                    style={{
                      border: `1.5px dashed ${dragging ? "#89a7db" : "rgba(137,167,219,.5)"}`,
                      background: dragging ? "rgba(137,167,219,.06)" : "rgba(8,17,30,.5)",
                    }}
                  >
                    <div className="relative size-[84px] shrink-0 overflow-hidden rounded-[14px]">
                      {upload.previewUrl ? (
                        // Preview is the LOCAL file (object URL), not the gateway — a
                        // just-pinned CID can briefly 404 and would flash the fallback.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={upload.previewUrl} alt={`${tickerUp} art`} className="size-full object-cover" />
                      ) : (
                        <div className="grid size-full place-items-center">
                          <UploadGlyph />
                        </div>
                      )}
                      {upload.status === "uploading" && (
                        <span className="text-foam absolute inset-0 grid place-items-center bg-black/50 text-[10px] font-bold">
                          pinning…
                        </span>
                      )}
                    </div>
                    <div className="text-body2 text-[13.5px] font-semibold">
                      {upload.previewUrl ? "Replace token image" : "Upload token image"}
                    </div>
                    <div className="text-faint text-[11.5px] leading-[1.5]">
                      Drop, browse or paste (Ctrl+V)
                    </div>
                    <div className="text-faint font-mono text-[10.5px]">PNG · JPG · GIF · WEBP</div>
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
                    className="flex h-full flex-col items-center justify-center gap-2.5 rounded-xl px-3.5 py-6 text-center"
                    style={{ border: "1.5px dashed rgba(148,168,196,.25)", background: "rgba(8,17,30,.35)" }}
                  >
                    <UploadGlyph dim />
                    <div className="text-faint text-[13.5px] font-semibold">
                      Confirm public upload first
                    </div>
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

              {/* papers */}
              <div>
                <Kicker>TOKEN NAME</Kicker>
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

                <div className="mt-3.5 flex items-baseline justify-between">
                  <Kicker>TICKER</Kicker>
                  <span className="text-faint tabular text-[11px]">
                    {normalizeTicker(ticker).length}/{TICKER_MAX}
                  </span>
                </div>
                <div className="well flex items-center gap-1.5 px-3.5">
                  <span className="text-faint text-[14.5px] font-semibold">$</span>
                  <input
                    value={ticker}
                    onChange={(e) => setTicker(normalizeTicker(e.target.value))}
                    placeholder="TICKER"
                    className="tabular min-w-0 flex-1 bg-transparent py-3 text-[14.5px] uppercase outline-none"
                  />
                </div>

                <div className="mt-3.5">
                  <Kicker>
                    DESCRIPTION <span className="text-faint font-normal">· OPTIONAL</span>
                  </Kicker>
                </div>
                <textarea
                  value={lore}
                  onChange={(e) => setLore(e.target.value.slice(0, 140))}
                  placeholder="What's the idea? Tell your future holders a little about the token."
                  rows={3}
                  className={cn(inputCls, "resize-y font-sans")}
                />
              </div>
            </div>

            <label className="text-mist mt-3.5 flex cursor-pointer items-start gap-[9px] text-[12.5px] leading-relaxed">
              <input
                type="checkbox"
                checked={ipfsOk}
                onChange={(e) => setIpfsOk(e.target.checked)}
                className="mt-0.5 size-[15px] shrink-0"
                style={{ accentColor: "#89a7db" }}
              />
              I understand that selected artwork will be moderated and uploaded to public IPFS.
            </label>

            <button
              type="button"
              onClick={() => setSocialsOpen((v) => !v)}
              aria-expanded={socialsOpen}
              className="text-body2 hover:text-foam mt-3.5 flex w-full items-center gap-2 text-left text-[13.5px] font-semibold"
            >
              <span className="text-primary">+</span>
              <span>
                Website &amp; social links <span className="text-faint font-normal">optional</span>
              </span>
              <span
                className="text-faint ml-auto inline-block transition-transform duration-200"
                style={{ transform: socialsOpen ? "rotate(180deg)" : "none" }}
                aria-hidden
              >
                ⌄
              </span>
            </button>
            {socialsOpen && (
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
                <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="yourtoken.xyz" className={inputCls} inputMode="url" aria-label="Website" />
                <input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="x.com/handle" className={inputCls} inputMode="url" aria-label="X profile" />
                <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="t.me/community" className={inputCls} inputMode="url" aria-label="Telegram" />
              </div>
            )}
          </section>

          {/* 02 ─ Pick a pair */}
          <section className="glass p-[26px]">
            <CardHead
              title="Pick a pair"
              sub="Choose the quote asset for your pool. Starting market cap stays the same either way."
              icon={<path d="M7 8h10M7 8l3-3M7 8l3 3M17 16H7m10 0l-3-3m3 3l-3 3" />}
            />
            <MockNote>
              The factory ships one immutable quote token, so this choice is not sent with the
              launch. USDC is what every pool opens against today.
            </MockNote>

            <div className="mt-3.5">
              <Kicker>QUOTE ASSET</Kicker>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {PAIRS.map((p) => {
                const on = pair === p.key
                return (
                  <button
                    key={p.key}
                    type="button"
                    disabled={p.soon}
                    onClick={() => setPair(p.key)}
                    aria-pressed={on}
                    className="rounded-[14px] px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      border: `1px solid ${on ? "#89a7db" : "rgba(148,168,196,.16)"}`,
                      background: on ? "rgba(137,167,219,.1)" : "rgba(8,15,26,.5)",
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <QuoteMark which={p.key} />
                      <span className="text-[13.5px] font-semibold">{p.sym}</span>
                    </span>
                    <span className="text-faint mt-1 block text-[11.5px]">{p.sub}</span>
                  </button>
                )
              })}
            </div>

            {pair === "ANY" && (
              <div className="mt-3">
                <Kicker>QUOTE TOKEN</Kicker>
                <input
                  value={anyToken}
                  onChange={(e) => setAnyToken(e.target.value)}
                  placeholder="Paste a 0x contract address or search by ticker"
                  className={inputCls}
                />
                <p className="text-faint mt-1.5 text-[11.5px]">
                  Any token on Arc can be the quote asset.
                </p>
              </div>
            )}

          </section>

          {/* 03 ─ Your fees */}
          <section className="glass p-[26px]">
            <CardHead
              title="Your fees"
              sub={`Each swap pays a ${feeLabel} pool fee. Pick your cut and where it lands.`}
              icon={<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />}
            />
            <MockNote>
              deploy() takes no fee parameters, so the destination, the creator tax and the fee
              wallet below are not sent with the launch. Today every coin splits its pool fee
              between the creator and the protocol, claimable from Portfolio.
            </MockNote>

            <div className="mt-3.5">
              <Kicker>WHERE YOUR SHARE GOES</Kicker>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {FEE_DESTS.map((d) => {
                const on = feeDest === d.key
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setFeeDest(d.key)}
                    aria-pressed={on}
                    className="relative rounded-[14px] px-3 py-2.5 text-left transition-colors"
                    style={{
                      border: `1px solid ${on ? "#89a7db" : "rgba(148,168,196,.16)"}`,
                      background: on ? "rgba(137,167,219,.1)" : "rgba(8,15,26,.5)",
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-primary">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d={d.icon} />
                        </svg>
                      </span>
                      <span className="text-[13.5px] font-semibold">{d.label}</span>
                    </span>
                    <span className="text-faint mt-1 block pr-5 text-[11.5px] leading-[1.5]">{d.sub}</span>
                    {on && (
                      <span
                        className="absolute right-2.5 top-2.5 grid size-[18px] place-items-center rounded-full"
                        style={{ background: "#b7c9ee" }}
                        aria-hidden
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                          <path d="M5 13l4 4L19 7" stroke="#0d2340" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex items-baseline justify-between">
              <Kicker>YOUR CREATOR TAX</Kicker>
              <span className="tabular text-[15px] font-semibold">{creatorTax.toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={creatorTax}
              onChange={(e) => setCreatorTax(parseFloat(e.target.value))}
              aria-label="Creator tax"
              className="w-full"
              style={{ accentColor: "#89a7db" }}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {TAX_PRESETS.map((t) => {
                const on = creatorTax === t.value
                return (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => setCreatorTax(t.value)}
                    aria-pressed={on}
                    className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors"
                    style={{
                      border: `1px solid ${on ? "#89a7db" : "rgba(148,168,196,.18)"}`,
                      background: on ? "rgba(137,167,219,.14)" : "rgba(8,15,26,.5)",
                      color: on ? "#eaf1fa" : "#93a8c4",
                    }}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>
            <p className="text-faint mt-2.5 text-[12px] leading-[1.6]">
              Your own take on every swap, layered on the pool fee and routed to you no matter where
              the trade comes from. Set once at launch, capped at 10%, impossible to raise later.
            </p>

            <div className="well mt-3.5 px-3.5 py-3">
              <Kicker>EVERY TRADE PAYS</Kicker>
              <FeeRow
                k={
                  <>
                    Base fee <span className="text-faint">(split with the protocol)</span>
                  </>
                }
                v={`${baseFeePct.toFixed(1)}%`}
              />
              <FeeRow
                k={
                  <>
                    Your creator tax <span className="text-faint">(all yours)</span>
                  </>
                }
                v={`${creatorTax.toFixed(1)}%`}
              />
              <FeeRow k={<span className="font-semibold">Every trade pays</span>} v={totalFee} total />
            </div>
            <p className="text-faint mt-2.5 text-[12px] leading-[1.6]">
              Buyers pay in the quote asset, sellers in your token.
            </p>

            <div className="mt-3.5">
              <Kicker>
                FEE WALLET <span className="text-faint font-normal">· OPTIONAL</span>
              </Kicker>
              <input
                value={feeWallet}
                onChange={(e) => setFeeWallet(e.target.value)}
                placeholder="your wallet"
                className={inputCls}
                aria-label="Fee wallet"
              />
            </div>
          </section>

          {/* 04 ─ Dev buy & launch */}
          <section className="glass p-[26px]">
            <CardHead
              title="Dev buy & launch"
              sub="Make the first buy inside the launch transaction. Snipers get nothing."
              icon={<path d="M3 12h4l3 8 4-16 3 8h4" />}
            />

            <div className="mt-[18px] flex flex-wrap items-center justify-between gap-2">
              <Kicker>
                DEV BUY <span className="text-faint font-normal">· OPTIONAL</span>
              </Kicker>
              <div className="flex rounded-full p-1" style={{ background: "rgba(8,15,26,.6)" }}>
                {(["spend", "tokens"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setDevMode(m)
                      setDevBuy("")
                    }}
                    aria-pressed={devMode === m}
                    className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors"
                    style={{
                      background: devMode === m ? "rgba(137,167,219,.2)" : "transparent",
                      color: devMode === m ? "#eaf1fa" : "#6e82a0",
                    }}
                  >
                    {m === "spend" ? "Spend" : "Tokens"}
                  </button>
                ))}
              </div>
            </div>

            <div
              className="well flex items-center gap-2 py-1 pl-3.5 pr-1"
              style={badDevBuy ? { borderColor: "#de8092" } : undefined}
            >
              <input
                value={devBuy}
                onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                inputMode="decimal"
                aria-label={devMode === "spend" ? "Developer buy in USDC" : "Developer buy in tokens"}
                className="tabular min-w-0 flex-1 bg-transparent py-2.5 text-base font-semibold outline-none"
              />
              <span
                className="bg-hull flex shrink-0 items-center gap-[7px] rounded-full px-3 py-1.5 text-[12.5px] font-semibold"
                style={{ border: "1px solid rgba(148,168,196,.25)" }}
              >
                {devMode === "spend" ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/usdc.png" alt="" width="15" height="15" className="block shrink-0" aria-hidden />
                    USDC
                  </>
                ) : (
                  `$${tickerUp}`
                )}
              </span>
            </div>

            {/* v2 has no maxDevBuyBps and no DevBuyExceedsCap — the only ceiling
                on the opening buy is the creator's balance, which the simulation
                checks. So this says what the money buys, not what it may not. */}
            {badDevBuy ? (
              <p className="mt-1.5 text-[12.5px] font-semibold" style={{ color: "#de8092" }}>
                That dev-buy isn&apos;t a number.
              </p>
            ) : devUsdc > 0 ? (
              <p className="text-faint mt-1.5 text-[11.5px]">
                ≈ <span className="tabular">{devTokens.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>{" "}
                ${tickerUp} ·{" "}
                <span className="tabular">{((devTokens / CONSTANTS.supplyTokens) * 100).toFixed(2)}</span>% of
                supply{" "}
                {devMode === "tokens" && (
                  <>
                    · ≈ <span className="tabular">{devUsdc.toFixed(2)}</span> USDC
                  </>
                )}
              </p>
            ) : (
              <p className="text-faint mt-1.5 text-[11.5px]">
                Yours is the first buy, inside the launch transaction. No cap.
              </p>
            )}

            <div className="text-primary mt-3.5 flex items-center gap-2 text-[12.5px] font-semibold">
              <span className="bg-primary size-1.5 shrink-0 rounded-full" aria-hidden />
              Launch fee {formatEther(terms.launchFee)} USDC. Everything else is gas.
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
            <p className="text-faint mt-2.5 text-center text-[11.5px]">
              Runs on Arc. You sign it, your wallet sends it, berth never touches your funds.
            </p>
          </section>
        </div>

        {/* ── sticky rail ── */}
        <div className="flex w-full flex-[1_1_300px] flex-col gap-3.5 lg:sticky lg:top-[104px] lg:max-w-[360px]">
          {/* live preview */}
          <div className="glass p-[22px]">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-primary flex items-center gap-1.5 text-[11px] font-semibold" style={{ letterSpacing: ".14em" }}>
                <span className="bg-primary size-1.5 animate-pulse rounded-full" aria-hidden />
                LIVE PREVIEW
              </span>
              <span className="text-faint text-[11.5px]">how it shows in the app</span>
            </div>

            <div className="relative aspect-square w-full overflow-hidden rounded-[16px]" style={{ background: "#0b1929", border: "1px solid rgba(148,168,196,.18)" }}>
              {upload.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={upload.previewUrl} alt={`${tickerUp} art`} className="size-full object-cover" />
              ) : (
                <div className="font-display text-faint grid size-full place-items-center text-[26px]">
                  {normalizeTicker(ticker) ? `$${normalizeTicker(ticker)}` : "LOGO"}
                </div>
              )}
              <span
                className="text-body2 absolute right-2.5 top-2.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: "rgba(8,15,26,.85)", border: "1px solid rgba(148,168,196,.22)" }}
              >
                {quoteSym}
              </span>
            </div>

            <div className="mt-3">
              <div className="truncate text-[15px] font-semibold">{name || "Your token"}</div>
              <div className="text-faint tabular text-[12.5px]">${tickerUp}</div>
              <div className="text-mist mt-2 flex justify-between text-[12.5px]">
                <span className="tabular">
                  {openingMc} <span className="text-faint">MC</span>
                </span>
                <span className="tabular">$0 vol</span>
              </div>
              <div className="text-faint mt-1.5 flex justify-between text-[11.5px]">
                <span className="tabular">0x0000…0000</span>
                <span>now</span>
              </div>
            </div>
          </div>

          {/* details */}
          <div className="glass px-[22px] py-1">
            <Deal k="Network" v="Arc" />
            <Deal k="Paired with" v={quoteSym} />
            <Deal k="Starting market cap" v={openingMc} mono />
            <Deal k="Pool fee" v={totalFee} mono />
            <Deal k="Your fees go" v={FEE_DEST_SHORT[feeDest]} />
            <Deal k="Supply" v={`${CONSTANTS.supplyTokens.toLocaleString()} · locked`} mono last />
          </div>

          {/* nothing to rug */}
          <div className="glass p-[22px]">
            <div className="font-display text-[17px]">Nothing to rug.</div>
            <p className="text-mist mt-1.5 text-[12.5px] leading-[1.65]">
              Locked position from block one. No mint, no pause, no owner keys, zero team
              allocation.
            </p>
          </div>
        </div>

        {/* ── confirm modal: computes on open, launches on confirm ── */}
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
                      <UploadGlyph dim small />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{name || "Your token"}</div>
                  <div className="text-faint tabular text-[12.5px]">${tickerUp}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="text-faint">Launch fee</span>
                  <span className="tabular">{formatEther(terms.launchFee)} USDC</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-faint">Developer buy</span>
                  <span className="tabular">{devUsdc || 0} USDC</span>
                </div>
              </div>

              {/* the on-chain simulation, started by opening this modal */}
              <SimStatus launch={launch} />

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

/* ── constants ─────────────────────────────────────────────────────── */

const inputCls = "well w-full px-3.5 py-3 text-[14.5px] outline-none"

/** normalizeTicker's own ceiling. Kept here so the counter can't drift from it. */
const TICKER_MAX = 8

/** maxDevBuyBps as shipped. Only the token-amount conversion uses it; every
 *  DISPLAYED cap comes off the chain via `launch.capPct`. */
const CAP_PCT = 2

type PairKey = "USDC" | "BERTH" | "ANY" | "ARC"

const PAIRS: { key: PairKey; sym: string; sub: string; soon?: boolean }[] = [
  { key: "USDC", sym: "USDC", sub: "Stablecoin" },
  { key: "BERTH", sym: "BERTH", sub: "The native token" },
  { key: "ANY", sym: "Any token", sub: "Search the chain" },
  { key: "ARC", sym: "ARC", sub: "Native · coming soon", soon: true },
]

const FEE_DESTS: { key: FeeMode; label: string; sub: string; icon: string }[] = [
  {
    key: "keep",
    label: "To you",
    sub: "Accrues to your fee wallet. Claim any time from your portfolio.",
    icon: "M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm0 0V6a2 2 0 0 1 2-2h11M16 13h2",
  },
  {
    key: "holders",
    label: "To holders",
    sub: "Bought back into your coin every hour and sent to holders pro rata.",
    icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75",
  },
  {
    key: "burn",
    label: "Buyback & burn",
    sub: "Buys your coin back in its own pool every hour and burns it.",
    icon: "M12 2c1.5 4-4.5 5.5-4.5 10a4.5 4.5 0 0 0 9 0c0-1.4-.5-2.6-1.2-3.8-.8 1.8-2.3 2.3-2.3.3 0-2 .5-4-1-6.5z",
  },
]

const FEE_DEST_SHORT: Record<FeeMode, string> = {
  keep: "to you",
  holders: "to holders",
  burn: "buyback & burn",
}

const TAX_PRESETS = [
  { value: 0, label: "None" },
  { value: 1, label: "1%" },
  { value: 2.5, label: "2.5%" },
  { value: 5, label: "5%" },
  { value: 10, label: "10%" },
]

/* ── pure helpers ──────────────────────────────────────────────────── */

/** Token amount → the USDC string the contract actually takes. Empty in, empty
 *  out, so a blank field stays a blank field rather than becoming "0". */
function tokensToUsdc(tokens: string, usdcPerToken: number): string {
  const n = Number(tokens)
  if (!tokens.trim()) return ""
  if (!Number.isFinite(n)) return tokens // let parseUsdcInput reject it
  return String(n * usdcPerToken)
}

/** Label for a pasted quote token: an address shortens, a ticker uppercases. */
function shortQuote(raw: string): string {
  const v = raw.trim()
  return v.startsWith("0x") ? `${v.slice(0, 5)}…${v.slice(-4)}` : v.toUpperCase()
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/* ── presentational bits ───────────────────────────────────────────── */

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-faint mb-1.5 text-[11px] font-semibold" style={{ letterSpacing: ".12em" }}>
      {children}
    </div>
  )
}

/** Card header: duotone icon tile, title + sub. The v4 mock dropped the
 *  corner step numbers — the cards read in order without them. */
function CardHead({
  title,
  sub,
  icon,
}: {
  title: string
  sub: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="text-primary grid size-10 shrink-0 place-items-center rounded-xl"
        style={{ background: "rgba(137,167,219,.1)", border: "1px solid rgba(137,167,219,.3)" }}
        aria-hidden
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-display text-[18px]">{title}</div>
        <div className="text-faint mt-0.5 text-[12.5px] leading-[1.5]">{sub}</div>
      </div>
    </div>
  )
}

/**
 * Says out loud that a card's controls are not wired to the chain yet. Without
 * it the tax slider and the pair picker look like settings that took effect.
 */
function MockNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-faint mt-3 rounded-xl px-3 py-2 text-[11.5px] leading-[1.55]"
      style={{ background: "rgba(8,15,26,.6)", border: "1px dashed rgba(148,168,196,.22)" }}
    >
      <span className="text-body2 font-semibold">Preview only. </span>
      {children}
    </p>
  )
}

function FeeRow({ k, v, total }: { k: React.ReactNode; v: string; total?: boolean }) {
  return (
    <div
      className={cn("flex justify-between py-1.5 text-[12.5px]", total && "mt-0.5 pt-2")}
      style={total ? { borderTop: "1px solid rgba(148,168,196,.14)" } : undefined}
    >
      <span className="text-mist">{k}</span>
      <span className={cn("tabular", total && "font-semibold")}>{v}</span>
    </div>
  )
}

function Deal({
  k,
  v,
  mono,
  last,
}: {
  k: string
  v: string
  mono?: boolean
  last?: boolean
}) {
  return (
    <div
      className="flex justify-between gap-3 py-2.5 text-[13px]"
      style={{ borderBottom: last ? undefined : "1px solid rgba(148,168,196,.12)" }}
    >
      <span className="text-mist shrink-0">{k}</span>
      <span className={cn("truncate text-right", mono && "tabular")}>{v}</span>
    </div>
  )
}

/** Neutral art placeholder — an upload arrow, never an emoji. */
function UploadGlyph({ dim, small }: { dim?: boolean; small?: boolean }) {
  const px = small ? 18 : 26
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={dim ? "#6e82a0" : "#93a8c4"}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 16V4m0 0L7 9m5-5l5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  )
}

/** Quote-asset marks. Drawn inline rather than fetched — an artwork request to
 *  a third-party CDN is one more thing that can fail on this page. */
function QuoteMark({ which }: { which: PairKey }) {
  if (which === "USDC") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/usdc.png" alt="" width="18" height="18" className="block shrink-0" aria-hidden />
  }
  if (which === "BERTH") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/berth-sail.png" alt="" width="18" height="18" className="block shrink-0 object-contain" aria-hidden />
  }
  if (which === "ANY") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="shrink-0">
        <circle cx="12" cy="12" r="11" fill="#15293f" />
        <circle cx="12" cy="12" r="6.5" fill="none" stroke="#89a7db" strokeWidth="1.5" />
        <ellipse cx="12" cy="12" rx="2.8" ry="6.5" fill="none" stroke="#89a7db" strokeWidth="1.2" />
        <path d="M5.8 12h12.4M6.8 9h10.4M6.8 15h10.4" stroke="#89a7db" strokeWidth="1.2" fill="none" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r="11" fill="#0e1f35" stroke="rgba(148,168,196,.35)" />
      <path d="M7 16l5-9 5 9M9.2 13.4h5.6" fill="none" stroke="#89a7db" strokeWidth="1.6" strokeLinecap="round" />
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
 * The deploy simulation, inline above the confirm button.
 *
 * v2 predicts no address — there is no `predictTokenAddress`, no init-code hash
 * and no vanity suffix to mine for — so the only thing worth showing here is
 * whether the chain will accept this launch, and the reroll out of a pool
 * collision.
 */
function SimStatus({ launch }: { launch: ReturnType<typeof useLaunch> }) {
  return (
    <div className="mt-3.5" role="status" aria-live="polite">
      {launch.checking && !launch.blocked && (
        <p className="text-mist text-[12.5px]">Checking the launch against the chain…</p>
      )}
      {launch.blocked && (
        <div className="flex flex-col items-start gap-1.5">
          <p className="text-[12.5px]" style={{ color: "#de8092" }}>
            {launch.blocked}
          </p>
          {/* A colliding pool is the one refusal a retry actually fixes: a new
              salt is a new address, which is a new pool key. */}
          {/already exists/i.test(launch.blocked) && (
            <button onClick={launch.reroll} className="btn-ghost px-3 py-1.5 text-xs">
              Try another address
            </button>
          )}
        </div>
      )}
      {launch.ready && (
        <p className="text-faint text-[11.5px]">
          Simulated against the chain. Your wallet signs the next step.
        </p>
      )}
    </div>
  )
}
