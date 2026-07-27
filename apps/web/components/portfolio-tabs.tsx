"use client"

import { CoinAvatar } from "@/components/coin-avatar"
import * as React from "react"
import Link from "next/link"

import { useFx } from "@/components/fx-provider"
import { useWallet } from "@/components/wallet-provider"
import { explorerTx } from "@/lib/chain"
import { fmtPrice } from "@/lib/format"
import { fmtBalance, fmtFee, useClaim, useCollect, usePortfolio } from "@/lib/fees"

/** Row/column geometry, straight from the handoff. Shared by header + rows. */
const HOLD_COLS = "1fr 140px 110px"
const REW_COLS = "1fr auto 110px auto 110px"

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass mt-5 flex flex-col items-center gap-4 px-5 py-11 text-center">{children}</div>
  )
}

function TxLink({ hash }: { hash?: `0x${string}` }) {
  if (!hash) return null
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noreferrer"
      className="text-lime text-[13px] font-bold no-underline hover:underline"
    >
      View tx ↗
    </a>
  )
}

/** One stage of the fee pipeline. Explainer only — it describes the flow, not live state. */
function StagePill({ active, title, sub }: { active?: boolean; title: string; sub: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3.5 py-1.5 text-[13px]"
      style={{
        borderRadius: 20,
        background: active ? "rgba(143,176,232,.08)" : "#0b1929",
        border: `1px solid ${active ? "#4f74a8" : "rgba(148,168,196,0.2)"}`,
      }}
    >
      <span className="font-bold" style={{ color: active ? "#8fb0e8" : "#c6d5ea" }}>
        {title}
      </span>
      <span className="text-mist">{sub}</span>
    </div>
  )
}

function Arrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-bold" style={{ color: "#4f74a8" }}>
      {children}
    </div>
  )
}

/** One cell of the holdings summary strip. */
function SummaryCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="cell px-[18px] py-[15px]">
      <div className="text-faint text-[10.5px]" style={{ letterSpacing: ".12em" }}>
        {label}
      </div>
      <div className={`tabular mt-1.5 text-[19px] ${accent ? "text-gold" : ""}`}>{value}</div>
    </div>
  )
}

/** Column heading: 12px, bold, tracked out. */
function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <div className={right ? "text-right" : undefined} style={{ letterSpacing: 1 }}>
      {children}
    </div>
  )
}

/**
 * A fee amount, dual-denominated per the spec: primary line in USDC, secondary
 * "+ N $TICKER". `native`/`token` null means we couldn't read it — that renders a
 * dim em-dash, never a 0, because 0 and "unknown" are different answers when
 * someone is deciding whether to sign.
 */
function FeeAmount({
  native,
  token,
  symbol,
  tone,
}: {
  native: bigint | null
  token: bigint | null
  symbol: string
  tone: "foam" | "lime"
}) {
  const empty = (native === null || native === 0n) && (token === null || token === 0n)
  if (empty) {
    return (
      <div className="text-right">
        <div className="font-bold" style={{ color: "#6e82a0" }}>
          —
        </div>
      </div>
    )
  }
  return (
    <div className="text-right">
      <div className="font-bold" style={{ color: tone === "lime" ? "#8fb0e8" : "#eaf1fa" }}>
        {fmtFee(native)} USDC
      </div>
      {token !== null && token > 0n && (
        <div className="text-mist text-xs">
          + {fmtBalance(token)} ${symbol}
        </div>
      )}
    </div>
  )
}

export function PortfolioTabs() {
  const wallet = useWallet()
  const { celebrate, toast } = useFx()
  const portfolio = usePortfolio(wallet.address)
  const [tab, setTab] = React.useState<"hold" | "rew">("hold")

  // refetch is stable in react-query v5; depending on it (not `portfolio`) keeps
  // the receipt effects below from re-running on every render.
  const { refetch: refetchPortfolio } = portfolio
  const refetch = React.useCallback(() => {
    void refetchPortfolio()
  }, [refetchPortfolio])

  // collect and claim are separate transactions on separate contracts, so they
  // get separate hooks, separate receipts and separate toasts. Never merged.
  const onCollected = React.useCallback(() => {
    refetch()
    celebrate("Swept into escrow, captain 🧹")
  }, [refetch, celebrate])
  const onClaimed = React.useCallback(() => {
    refetch()
    celebrate("Paid out, captain 💰")
  }, [refetch, celebrate])

  const collector = useCollect(onCollected)
  const claimer = useClaim(onClaimed)

  // Surface reverts / rejections instead of failing silently.
  React.useEffect(() => {
    const err = collector.error ?? claimer.error
    if (err) toast(`Didn't go through: ${err.name}`)
  }, [collector.error, claimer.error, toast])

  if (!wallet.connected) {
    return (
      <Panel>
        <span className="text-[42px]" aria-hidden>
          👜
        </span>
        <p className="text-lg font-bold">Connect your wallet to see what&apos;s in your hold</p>
        <button onClick={wallet.connect} className="btn-glossy px-6 py-3 text-base">
          Connect wallet
        </button>
      </Panel>
    )
  }

  // States the handoff didn't cover but the chain does. Kept ahead of the tabs:
  // a wrong-network read would report someone else's balances as yours.
  if (wallet.wrongNetwork) {
    return (
      <Panel>
        <span className="text-[42px]" aria-hidden>
          🧭
        </span>
        <p className="text-lg font-bold">Wrong waters, captain</p>
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
        <span className="text-[42px]" aria-hidden>
          🌫️
        </span>
        <p className="text-lg font-bold">Can&apos;t reach the harbor ledger</p>
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
  // lands in this ONE bucket — this wallet is a recipient on two positions and
  // has exactly one NATIVE row on chain. So the NATIVE figure lives in the summary
  // bar; printing it on each row would show the same money twice.
  const nativeBucket = balances.find((b) => b.isNative)
  const coinBucket = (token?: string) =>
    token ? balances.find((b) => !b.isNative && b.token === token) : undefined
  // null = the chain read failed. Not claimable, because we cannot say it is.
  const claimableBalances = balances.filter((b) => (b.claimable ?? 0n) > 0n)
  const claimedBalances = balances.filter((b) => (b.lifetimeClaimed ?? 0n) > 0n)

  return (
    <>
      {/* tabs */}
      <div className="glass mt-5 flex gap-1 p-1" style={{ maxWidth: 380 }}>
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
            className="flex-1 p-2.5 text-center text-sm font-bold transition-colors"
            style={{
              borderRadius: 11,
              background: tab === id ? "#8fb0e8" : "transparent",
              color: tab === id ? "#0d1a2b" : "#93a8c4",
            }}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* holdings */}
      {tab === "hold" && (
        <>
        {/* summary strip. Coins value sums only the holdings we could actually
            price — an unpriceable coin is left out rather than counted as $0. */}
        <div
          className="cell-grid mt-4"
          style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}
        >
          <SummaryCell
            label="COINS VALUE"
            value={
              holdings.some((h) => h.valueNative !== null)
                ? fmtPrice(holdings.reduce((sum, h) => sum + (h.valueNative ?? 0), 0))
                : "—"
            }
            accent
          />
          <SummaryCell label="USDC BALANCE" value={wallet.balance ? `${wallet.balance}` : "—"} />
          <SummaryCell label="SHIPS HELD" value={String(holdings.length)} />
        </div>

        {holdings.length === 0 ? (
          <div
            className="mt-4 px-5 py-10 text-center"
            style={{
              background: "linear-gradient(168deg, rgba(46,74,110,.35), rgba(15,32,51,.9))",
              border: "1px dashed rgba(148,168,196,.3)",
              borderRadius: 14,
              boxShadow: "inset 0 1px 0 rgba(234,241,250,.08)",
            }}
          >
            <p className="text-mist text-[15px]">
              Nothing here yet. Load up on something in the harbor and it shows here.
            </p>
            <Link
              href="/"
              className="text-gold hover:bg-lime/10 mt-3.5 inline-block rounded-lg px-[18px] py-2.5 text-[11px] transition-colors"
              style={{ letterSpacing: ".14em", border: "1px solid #89a7db" }}
            >
              BROWSE THE DOCKS
            </Link>
          </div>
        ) : (
        <div className="glass mt-4 overflow-hidden">
          <div
            className="text-faint grid gap-2.5 px-[18px] py-3 text-[10.5px] font-medium"
            style={{ gridTemplateColumns: HOLD_COLS, borderBottom: "1px solid rgba(148,168,196,0.2)" }}
          >
            <Th>HOLDING</Th>
            <Th right>BALANCE</Th>
            <Th right>VALUE</Th>
          </div>

          {(
            holdings.map((h) => (
              <Link
                key={h.token}
                href={`/token/${h.token}`}
                className="hover:bg-bulwark grid items-center gap-2.5 px-[18px] py-[13px] transition-colors"
                style={{ gridTemplateColumns: HOLD_COLS, borderBottom: "1px solid rgba(148,168,196,0.14)" }}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <CoinAvatar
                    image={h.image}
                    emoji={h.emoji}
                    name={h.name}
                    ticker={h.symbol}
                    size={34}
                    className="bg-deep"
                    style={{ borderRadius: 10, border: "1px solid rgba(148,168,196,0.2)" }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-bold">{h.name}</span>
                    <span className="text-mist block text-xs">${h.symbol}</span>
                  </span>
                </span>
                <span className="text-right font-bold">{fmtBalance(h.balance)}</span>
                {/* Priced off the pool tick, converted at the live rate. Either
                    missing (no pool price / no feed) means "—", never a $0. */}
                <span className="text-right" style={{ color: "#c6d5ea" }}>
                  {h.valueNative === null
                    ? "—"
                    : fmtPrice(h.valueNative)}
                </span>
              </Link>
            ))
          )}
        </div>
        )}
        </>
      )}

      {/* creator rewards */}
      {tab === "rew" && (
        <div className="glass mt-4 p-[18px]">
          <div className="flex flex-wrap items-baseline gap-3">
            <div className="font-display text-[21px]">Creator rewards</div>
            <div className="text-mist text-[13px]">1% of every trade, paid in the coin + NATIVE</div>
          </div>

          {/* Pipeline explainer. Two steps on two contracts, and they stay
              visibly distinct: collect is permissionless, claim always pays the
              owner. Anyone reading this should know why there are two buttons. */}
          <div className="mb-4 mt-3 flex flex-wrap items-center gap-2">
            <StagePill title="① On the position" sub="fees pile up" />
            <Arrow>→ collect →</Arrow>
            <StagePill title="② In escrow" sub="anyone can trigger" />
            <Arrow>→ claim →</Arrow>
            <StagePill active title="③ Your wallet" sub="only you" />
          </div>

          {positions.length === 0 ? (
            <p className="text-mist py-6 text-center text-sm">
              You&apos;re not a fee recipient on any position yet. Launch a coin and the fees are
              yours.
            </p>
          ) : (
            <>
              <div
                className="text-mist grid items-center text-xs font-bold"
                style={{
                  gridTemplateColumns: REW_COLS,
                  gap: "8px 16px",
                  paddingBottom: 8,
                  borderBottom: "1px solid rgba(148,168,196,0.2)",
                }}
              >
                <Th>SHIP</Th>
                <Th />
                <Th right>UNCOLLECTED</Th>
                <Th />
                <Th right>IN ESCROW</Th>
              </div>

              {positions.map((p) => {
                const busy = collector.tokenId === p.tokenId
                // null = the read failed, so we don't know. Leave the button live
                // rather than block on a failed read; only a known zero disables.
                const nothing = p.earnedToken === 0n && p.earnedNative === 0n
                const escrow = coinBucket(p.token)
                return (
                  <div
                    key={p.tokenId.toString()}
                    className="grid items-center"
                    style={{
                      gridTemplateColumns: REW_COLS,
                      gap: "8px 16px",
                      padding: "13px 0",
                      borderBottom: "1px solid rgba(148,168,196,0.14)",
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
                        style={{ borderRadius: 10, border: "1px solid rgba(148,168,196,0.2)" }}
                      />
                      <div className="min-w-0">
                        <div className="truncate font-bold">${p.symbol}</div>
                        <div className="text-mist text-xs">
                          your share {(p.bps / 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                    <div />

                    {/* On the position: both sides are this position's own, so
                        both are attributable and shown together. */}
                    <FeeAmount
                      native={p.earnedNative}
                      token={p.earnedToken}
                      symbol={p.symbol}
                      tone="foam"
                    />

                    {/* The button sits between the two columns because that is
                        literally what it does: moves uncollected -> escrow. */}
                    <button
                      onClick={() => collector.collect(p.tokenId)}
                      disabled={collector.pending || nothing}
                      className="text-[13px] font-bold transition-colors"
                      style={{
                        background: "transparent",
                        color: nothing ? "#6e82a0" : "#8fb0e8",
                        border: `1px solid ${nothing ? "rgba(148,168,196,0.2)" : "#4f74a8"}`,
                        borderRadius: 10,
                        padding: "8px 14px",
                        cursor: nothing ? "default" : "pointer",
                      }}
                    >
                      {busy ? "Sweeping…" : "Collect →"}
                    </button>

                    {/* In escrow, coin side only. This coin's escrow IS per-coin;
                        the NATIVE half of it is pooled across every position and
                        lives in the summary bar instead. */}
                    <div className="text-right">
                      {!escrow || escrow.claimable === 0n ? (
                        <div className="font-bold" style={{ color: "#6e82a0" }}>
                          —
                        </div>
                      ) : (
                        <div className="font-bold" style={{ color: "#8fb0e8" }}>
                          {escrow.claimable === null ? "—" : fmtBalance(escrow.claimable)}{" "}
                          <span className="text-mist text-xs font-normal">${escrow.symbol}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {collector.hash && (
                <div className="pt-2 text-right">
                  <TxLink hash={collector.hash} />
                </div>
              )}

              {/* summary bar */}
              <div
                className="mt-4 flex flex-wrap items-center gap-[22px] p-4"
                style={{ background: "#0b1929", borderRadius: 14 }}
              >
                <div>
                  <div className="text-mist text-xs">Claimable now</div>
                  <div
                    className="text-xl font-bold"
                    style={{ color: claimableBalances.length ? "#8fb0e8" : "#6e82a0" }}
                  >
                    {claimableBalances.length === 0
                      ? "Nothing yet"
                      : `${fmtFee(nativeBucket?.claimable ?? 0n)} USDC`}
                  </div>
                  {/* Every non-NATIVE bucket, named. USDC alone would hide the coin side. */}
                  {claimableBalances
                    .filter((b) => !b.isNative)
                    .map((b) => (
                      <div key={b.token} className="text-mist text-xs">
                        + {b.claimable === null ? "—" : fmtBalance(b.claimable)} ${b.symbol}
                      </div>
                    ))}
                </div>

                <div>
                  <div className="text-mist text-xs">Lifetime claimed</div>
                  {/* Indexed from FeesClaimed — real history, no on-chain getter. */}
                  <div className="text-xl font-bold">
                    {fmtFee(nativeBucket?.lifetimeClaimed ?? 0n)} USDC
                  </div>
                  {claimedBalances
                    .filter((b) => !b.isNative)
                    .map((b) => (
                      <div key={b.token} className="text-mist text-xs">
                        + {fmtBalance(b.lifetimeClaimed!)} ${b.symbol}
                      </div>
                    ))}
                </div>

                <TxLink hash={claimer.hash} />

                {/* claimMany skips zero balances rather than reverting — we filter
                    to match, and stay disabled rather than send a no-op tx. */}
                <button
                  onClick={() => claimer.claimMany(owner, balances)}
                  disabled={claimer.pending || claimableBalances.length === 0}
                  className="btn-deck ml-auto px-[22px] py-3 text-base"
                  style={{
                    background: claimableBalances.length ? "#8fb0e8" : "#1b3450",
                    color: claimableBalances.length ? "#0d1a2b" : "#6e82a0",
                    boxShadow: `0 4px 0 ${claimableBalances.length ? "#4f74a8" : "#0b1929"}`,
                    cursor: claimableBalances.length ? "pointer" : "default",
                  }}
                >
                  {claimer.pending ? "Paying out…" : "Claim to wallet 💰"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
