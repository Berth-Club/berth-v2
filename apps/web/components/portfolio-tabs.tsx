"use client"

import { CoinAvatar } from "@/components/coin-avatar"
import * as React from "react"
import Link from "next/link"

import { useFx } from "@/components/fx-provider"
import { useWallet } from "@/components/wallet-provider"
import { explorerTx } from "@/lib/chain"
import { fmtPrice } from "@/lib/format"
import { fmtBalance, fmtFee, useClaim, useCollect, usePortfolio } from "@/lib/fees"

const HOLD_COLS = "1fr 140px 110px"

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass mt-5 flex flex-col items-center gap-4 px-5 py-12 text-center">{children}</div>
  )
}

/** A calm SVG empty-mark — replaces the old emoji, per the no-emoji-in-chrome rule. */
function EmptyMark() {
  return (
    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" aria-hidden className="text-faint">
      <path
        d="M4 8.5 12 4l8 4.5M4 8.5v7L12 20l8-4.5v-7M4 8.5 12 13l8-4.5M12 13v7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        opacity=".6"
      />
    </svg>
  )
}

function TxLink({ hash }: { hash?: `0x${string}` }) {
  if (!hash) return null
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noreferrer"
      className="text-lime text-[13px] font-semibold no-underline hover:underline"
    >
      View tx ↗
    </a>
  )
}

function SummaryCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="cell px-[18px] py-[15px]">
      <div className="text-faint font-mono text-[10.5px] uppercase" style={{ letterSpacing: ".12em" }}>
        {label}
      </div>
      <div className={`tabular mt-1.5 text-[19px] ${accent ? "text-lime" : "text-foam"}`}>{value}</div>
    </div>
  )
}

/**
 * A reward amount on ONE line: `401.042 USDC + 315.2M $TICK`, both parts bold at
 * the same size (per the v3 design). null on either side = an unread value, which
 * renders a dim em-dash — never a 0, because 0 and "unknown" differ when someone
 * is deciding whether to sign.
 */
function ClaimAmount({
  native,
  token,
  symbol,
}: {
  native: bigint | null
  token: bigint | null
  symbol: string
}) {
  const empty = (native === null || native === 0n) && (token === null || token === 0n)
  if (empty) return <span className="text-faint font-semibold">—</span>
  return (
    <span className="text-foam font-semibold">
      {fmtFee(native)} USDC
      {token !== null && token > 0n && (
        <span>
          {" "}
          + {fmtBalance(token)} <span className="text-body2">${symbol}</span>
        </span>
      )}
    </span>
  )
}

export function PortfolioTabs() {
  const wallet = useWallet()
  const { celebrate, toast } = useFx()
  const portfolio = usePortfolio(wallet.address)
  const [tab, setTab] = React.useState<"hold" | "rew">("hold")

  const { refetch: refetchPortfolio } = portfolio
  const refetch = React.useCallback(() => {
    void refetchPortfolio()
  }, [refetchPortfolio])

  // collect and claim are separate transactions on separate contracts, so they
  // get separate hooks, separate receipts and separate toasts. Never merged.
  const onCollected = React.useCallback(() => {
    refetch()
    celebrate("Swept into escrow")
  }, [refetch, celebrate])
  const onClaimed = React.useCallback(() => {
    refetch()
    celebrate("Paid out")
  }, [refetch, celebrate])

  const collector = useCollect(onCollected)
  const claimer = useClaim(onClaimed)

  React.useEffect(() => {
    const err = collector.error ?? claimer.error
    if (err) toast(`Didn't go through: ${err.name}`)
  }, [collector.error, claimer.error, toast])

  if (!wallet.connected) {
    return (
      <Panel>
        <EmptyMark />
        <p className="text-lg font-semibold">Connect your wallet to see your hold</p>
        <button onClick={wallet.connect} className="btn-glossy px-6 py-3 text-base">
          Connect wallet
        </button>
      </Panel>
    )
  }

  if (wallet.wrongNetwork) {
    return (
      <Panel>
        <EmptyMark />
        <p className="text-lg font-semibold">Wrong network</p>
        <p className="text-mist -mt-2 text-[15px]">Your hold is on Arc Testnet (5042002).</p>
        <button onClick={wallet.switchToArc} className="btn-glossy px-6 py-3 text-base">
          Switch to Arc Testnet
        </button>
      </Panel>
    )
  }

  if (portfolio.isPending) {
    return (
      <Panel>
        <p className="text-mist text-[15px]">Counting the cargo…</p>
      </Panel>
    )
  }

  if (portfolio.isError) {
    return (
      <Panel>
        <EmptyMark />
        <p className="text-lg font-semibold">Can&apos;t reach the harbor ledger</p>
        <p className="text-mist -mt-2 text-[15px]">So we won&apos;t guess at your numbers.</p>
        <button onClick={refetch} className="btn-ghost px-6 py-3 text-base">
          Try again
        </button>
      </Panel>
    )
  }

  const { positions, balances, holdings } = portfolio.data
  const owner = wallet.address!

  // Escrow is keyed by (owner, TOKEN), never by position. Every position's NATIVE
  // lands in this ONE bucket, so the NATIVE figure lives in the summary bar;
  // printing it per row would show the same money twice.
  const nativeBucket = balances.find((b) => b.isNative)
  const coinBucket = (token?: string) =>
    token ? balances.find((b) => !b.isNative && b.token === token) : undefined
  const claimableBalances = balances.filter((b) => (b.claimable ?? 0n) > 0n)

  return (
    <>
      {/* tabs — frosted capsule */}
      <div className="btn-frost mt-5 flex gap-1 p-1" style={{ maxWidth: 340 }}>
        {(
          [
            ["hold", "Holdings"],
            ["rew", "Creator rewards"],
          ] as const
        ).map(([id, lbl]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className="flex-1 rounded-full py-2 text-center text-[13.5px] font-semibold transition-colors"
            style={
              tab === id
                ? { background: "rgba(234,241,250,.94)", color: "#0d2340" }
                : { color: "#93a8c4" }
            }
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* holdings — table hidden entirely when empty (SVG empty state instead) */}
      {tab === "hold" &&
        (holdings.length === 0 ? (
          <Panel>
            <EmptyMark />
            <p className="text-lg font-semibold">Nothing here yet</p>
            <p className="text-mist -mt-2 text-[15px]">
              Buy something and it shows up here.
            </p>
            <Link href="/" className="btn-frost text-body2 px-5 py-2.5 text-[13.5px] font-semibold">
              Browse the harbor
            </Link>
          </Panel>
        ) : (
          <>
            {/* summary strip — value sums only priceable coins; unpriceable coins
                are left out rather than counted as $0. */}
            <div
              className="cell-grid mt-4"
              style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}
            >
              <SummaryCell
                label="Coins value"
                value={
                  holdings.some((h) => h.valueNative !== null)
                    ? fmtPrice(holdings.reduce((sum, h) => sum + (h.valueNative ?? 0), 0))
                    : "—"
                }
                accent
              />
              <SummaryCell label="USDC balance" value={wallet.balance ? `${wallet.balance}` : "—"} />
              <SummaryCell label="Tokens held" value={String(holdings.length)} />
            </div>

            <div className="glass glass-sm mt-4 overflow-hidden">
              <div
                className="text-faint grid gap-2.5 px-[18px] py-3 font-mono text-[10.5px] uppercase"
                style={{
                  gridTemplateColumns: HOLD_COLS,
                  letterSpacing: ".12em",
                  borderBottom: "1px solid rgba(148,168,196,0.14)",
                }}
              >
                <span>Holding</span>
                <span className="text-right">Balance</span>
                <span className="text-right">Value</span>
              </div>

              {holdings.map((h) => (
                <Link
                  key={h.token}
                  href={`/coin/${h.symbol}`}
                  className="hover:bg-bulwark grid items-center gap-2.5 px-[18px] py-[13px] transition-colors"
                  style={{
                    gridTemplateColumns: HOLD_COLS,
                    borderBottom: "1px solid rgba(148,168,196,0.1)",
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <CoinAvatar
                      image={h.image}
                      emoji={h.emoji}
                      name={h.name}
                      ticker={h.symbol}
                      size={34}
                      className="bg-deep"
                      style={{ borderRadius: 10, border: "1px solid rgba(148,168,196,0.14)" }}
                    />
                    <span className="min-w-0">
                      <span className="text-foam block truncate font-semibold">{h.name}</span>
                      <span className="text-mist block text-xs">${h.symbol}</span>
                    </span>
                  </span>
                  <span className="tabular text-foam text-right font-semibold">
                    {fmtBalance(h.balance)}
                  </span>
                  <span className="tabular text-body2 text-right">
                    {h.valueNative === null ? "—" : fmtPrice(h.valueNative)}
                  </span>
                </Link>
              ))}
            </div>
          </>
        ))}

      {/* creator rewards */}
      {tab === "rew" && (
        <div className="glass mt-4 p-[18px]">
          <div className="font-display text-[21px]">Creator rewards</div>

          {positions.length === 0 ? (
            <p className="text-mist py-8 text-center text-sm">
              You&apos;re not a fee recipient on any position yet. Launch a coin and the fees are
              yours.
            </p>
          ) : (
            <>
              <div
                className="text-faint mt-3 grid items-center font-mono text-[10.5px] uppercase"
                style={{
                  gridTemplateColumns: "1fr auto 120px",
                  gap: "8px 16px",
                  letterSpacing: ".12em",
                  paddingBottom: 8,
                  borderBottom: "1px solid rgba(148,168,196,0.14)",
                }}
              >
                <span>Token</span>
                <span />
                <span className="text-right">Rewards</span>
              </div>

              {positions.map((p) => {
                const busy = collector.token === p.token
                const nothing = p.earnedToken === 0n && p.earnedNative === 0n
                const escrow = coinBucket(p.token)
                return (
                  <div
                    key={p.token}
                    className="grid items-center"
                    style={{
                      gridTemplateColumns: "1fr auto 120px",
                      gap: "8px 16px",
                      padding: "13px 0",
                      borderBottom: "1px solid rgba(148,168,196,0.1)",
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <CoinAvatar
                        image={p.image}
                        emoji={p.emoji}
                        name={p.name}
                        ticker={p.symbol}
                        size={38}
                        className="bg-deep"
                        style={{ borderRadius: 10, border: "1px solid rgba(148,168,196,0.14)" }}
                      />
                      <div className="min-w-0">
                        <div className="text-foam truncate font-semibold">${p.symbol}</div>
                        {/* uncollected + in-escrow on one line */}
                        <div className="mt-0.5 text-[13px]">
                          <ClaimAmount native={p.earnedNative} token={p.earnedToken} symbol={p.symbol} />
                          {escrow && escrow.claimable !== null && escrow.claimable > 0n && (
                            <span className="text-mist">
                              {" "}
                              · {fmtBalance(escrow.claimable)} ${escrow.symbol} in escrow
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div />
                    {/* Collect sweeps this position's fees into escrow; Claim all
                        (below) then pays escrow to the wallet. Two on-chain steps,
                        kept honest — no arrows in the label, per the design. */}
                    <button
                      onClick={() => collector.collect(p.token)}
                      disabled={collector.pending || nothing}
                      className="btn-frost text-body2 justify-self-end px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
                    >
                      {busy ? "Sweeping…" : "Collect"}
                    </button>
                  </div>
                )
              })}

              {collector.hash && (
                <div className="pt-2 text-right">
                  <TxLink hash={collector.hash} />
                </div>
              )}

              {/* summary bar */}
              <div className="well mt-4 flex flex-wrap items-center gap-[22px] p-4">
                <div>
                  <div className="text-faint font-mono text-[10px] uppercase" style={{ letterSpacing: ".12em" }}>
                    Claimable now
                  </div>
                  <div
                    className={`tabular mt-1 text-xl font-semibold ${
                      claimableBalances.length ? "text-lime" : "text-faint"
                    }`}
                  >
                    {claimableBalances.length === 0
                      ? "Nothing yet"
                      : `${fmtFee(nativeBucket?.claimable ?? 0n)} USDC`}
                  </div>
                  {claimableBalances
                    .filter((b) => !b.isNative)
                    .map((b) => (
                      <div key={b.token} className="text-mist text-xs">
                        + {b.claimable === null ? "—" : fmtBalance(b.claimable)} ${b.symbol}
                      </div>
                    ))}
                </div>

                {/* v2's escrow keeps no lifetime total and emits no rollup we
                    index yet, so this shows what is claimable NOW — the number
                    the button acts on — rather than a history we can't source. */}
                <div>
                  <div className="text-faint font-mono text-[10px] uppercase" style={{ letterSpacing: ".12em" }}>
                    Claimable now
                  </div>
                  <div className="tabular text-foam mt-1 text-xl font-semibold">
                    {fmtFee(nativeBucket?.claimable ?? 0n)} USDC
                  </div>
                  {claimableBalances
                    .filter((b) => !b.isNative)
                    .map((b) => (
                      <div key={b.token} className="text-mist text-xs">
                        + {fmtBalance(b.claimable!)} ${b.symbol}
                      </div>
                    ))}
                </div>

                <TxLink hash={claimer.hash} />

                {/* One button, the native bucket — that is where every launch's
                    USDC fees pool. A coin-side balance claims from its own row.
                    Disabled rather than sending a no-op tx. */}
                <button
                  onClick={() => nativeBucket && claimer.claim(nativeBucket)}
                  disabled={claimer.pending || (nativeBucket?.claimable ?? 0n) === 0n}
                  className="btn-glossy ml-auto px-[22px] py-3 text-base disabled:opacity-40"
                >
                  {claimer.pending ? "Paying out…" : "Claim all"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
