"use client"

import * as React from "react"
import Link from "next/link"

import { useFx } from "@/components/fx-provider"
import { useWallet } from "@/components/wallet-provider"
import { explorerTx } from "@/lib/chain"
import { fmtBalance, fmtFee, useClaim, useCollect, usePortfolio, type FeeBalance } from "@/lib/fees"

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-panel bg-hull flex flex-col items-center gap-4 border p-12 text-center">
      {children}
    </div>
  )
}

function TxLink({ hash }: { hash?: `0x${string}` }) {
  if (!hash) return null
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noreferrer"
      className="text-mist hover:text-lime text-xs underline"
    >
      View tx ↗
    </a>
  )
}

export function PortfolioTabs() {
  const wallet = useWallet()
  const { celebrate, toast } = useFx()
  const portfolio = usePortfolio(wallet.address)

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
        <span className="text-4xl" aria-hidden>
          ⚓
        </span>
        <p className="text-mist text-[15px]">Connect your wallet to see what&apos;s in your hold</p>
        <button onClick={wallet.connect} className="btn-deck btn-lime px-5 py-2.5 text-base">
          Connect wallet
        </button>
      </Panel>
    )
  }

  if (wallet.wrongNetwork) {
    return (
      <Panel>
        <span className="text-4xl" aria-hidden>
          🧭
        </span>
        <p className="text-mist text-[15px]">
          Wrong waters, captain. Your hold is on Robinhood Chain (4663).
        </p>
        <button
          onClick={wallet.switchToRobinhood}
          className="btn-deck btn-lime px-5 py-2.5 text-base"
        >
          Switch to Robinhood Chain
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
        <span className="text-4xl" aria-hidden>
          🌫️
        </span>
        <p className="text-mist text-[15px]">
          Can&apos;t reach the harbor ledger, so we won&apos;t guess at your numbers.
        </p>
        <button onClick={refetch} className="btn-deck btn-quiet px-5 py-2.5 text-base">
          Try again
        </button>
      </Panel>
    )
  }

  const { positions, balances, holdings } = portfolio.data
  const claimableBalances = balances.filter((b) => b.claimable > 0n)
  const owner = wallet.address!

  return (
    <div className="flex flex-col gap-5">
      {/* holdings */}
      <div className="rounded-panel bg-hull overflow-hidden border">
        <div
          className="text-mist grid gap-3 px-4 py-3 text-xs font-bold"
          style={{
            gridTemplateColumns: "1fr 120px 120px",
            letterSpacing: 1,
            borderBottom: "1px solid #263A28",
          }}
        >
          <span>HOLDING</span>
          <span className="text-right">BALANCE</span>
          <span className="text-right">VALUE</span>
        </div>

        {holdings.length === 0 ? (
          <p className="text-mist px-4 py-8 text-center text-sm">
            Nothing in the hold yet — coins you buy here show up on this line.
          </p>
        ) : (
          holdings.map((h) => (
            <Link
              key={h.token}
              href={`/token/${h.token}`}
              className="hover:bg-bulwark grid items-center gap-3 px-4 py-3 transition-colors"
              style={{ gridTemplateColumns: "1fr 120px 120px", borderBottom: "1px solid #1a281c" }}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className="bg-deep rounded-chip grid size-9 place-items-center text-lg"
                  aria-hidden
                >
                  {h.emoji}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{h.name}</span>
                  <span className="tabular text-mist text-xs">${h.symbol}</span>
                </span>
              </span>
              <span className="tabular text-right text-sm">{fmtBalance(h.balance)}</span>
              {/* Priced in WETH off the pool tick — no USD, since we have no real ETH/USD feed. */}
              <span className="tabular text-right text-sm">
                {h.valueWeth === null
                  ? "—"
                  : `${h.valueWeth < 0.0001 ? "<0.0001" : h.valueWeth.toFixed(4)} Ξ`}
              </span>
            </Link>
          ))
        )}
      </div>

      {/* creator rewards */}
      <div className="rounded-panel bg-hull border p-[18px]">
        <h2 className="font-display mb-2 text-xl">Creator rewards</h2>
        <p className="text-mist mb-4 text-[13px]">
          Every trade pays a 1% fee that piles up on the locked position.{" "}
          <b className="text-foam">Collect</b> sweeps it into escrow (anyone can trigger it) ·{" "}
          <b className="text-foam">Claim</b> withdraws escrow to your wallet. Two steps, on purpose.
        </p>

        {positions.length === 0 ? (
          <p className="text-mist py-6 text-center text-sm">
            You&apos;re not a fee recipient on any position yet. Launch a coin and the fees are
            yours.
          </p>
        ) : (
          <>
            {/* step 1 — on the position. Collect sweeps it into escrow. */}
            <div className="text-mist mb-1 mt-2 text-xs font-bold" style={{ letterSpacing: 1 }}>
              ON THE POSITION · EARNED, UNCOLLECTED
            </div>
            {positions.map((p) => {
              const busy = collector.tokenId === p.tokenId
              // Nothing to sweep => nothing to collect. null means "unknown", so
              // we leave the button live rather than block on a failed read.
              const nothing = p.earnedToken === 0n && p.earnedWeth === 0n
              return (
                <div
                  key={p.tokenId.toString()}
                  className="flex flex-wrap items-center gap-3 py-3"
                  style={{ borderBottom: "1px solid #1a281c" }}
                >
                  <span
                    className="bg-deep rounded-chip grid size-9 place-items-center text-lg"
                    aria-hidden
                  >
                    {p.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{p.name}</span>
                    <span className="tabular text-mist text-xs">
                      ${p.symbol} · your share {(p.bps / 100).toFixed(0)}%
                    </span>
                  </span>

                  {/* Fees accrue in BOTH sides of the pool. Show both. */}
                  <span className="text-right">
                    <span className="text-mist block text-xs">${p.symbol}</span>
                    <span className="tabular text-sm">{fmtFee(p.earnedToken)}</span>
                  </span>
                  <span className="text-right">
                    <span className="text-mist block text-xs">WETH</span>
                    <span className="tabular text-sm">{fmtFee(p.earnedWeth)}</span>
                  </span>

                  <button
                    onClick={() => collector.collect(p.tokenId)}
                    disabled={collector.pending || nothing}
                    className="btn-deck btn-quiet rounded-btn px-3 py-1.5 text-xs disabled:opacity-40"
                  >
                    {busy ? "Sweeping…" : "Collect →"}
                  </button>
                </div>
              )
            })}
            {collector.hash && (
              <div className="pt-2">
                <TxLink hash={collector.hash} />
              </div>
            )}

            {/* step 2 — in escrow, keyed by token (NOT by position: one bucket per token). */}
            <div className="text-mist mb-1 mt-5 text-xs font-bold" style={{ letterSpacing: 1 }}>
              IN ESCROW · CLAIMABLE TO YOUR WALLET
            </div>
            {balances.map((b: FeeBalance) => (
              <div
                key={b.token}
                className="flex flex-wrap items-center gap-3 py-3"
                style={{ borderBottom: "1px solid #1a281c" }}
              >
                <span
                  className="bg-deep rounded-chip grid size-9 place-items-center text-lg"
                  aria-hidden
                >
                  {b.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">${b.symbol}</span>
                </span>
                <span className="text-right">
                  <span className="text-mist block text-xs">Claimable</span>
                  <span className="tabular text-lime text-sm">{fmtFee(b.claimable)}</span>
                </span>
                {/* claim() reverts NothingToClaim at zero — disable, don't revert. */}
                <button
                  onClick={() => claimer.claim(owner, b.token)}
                  disabled={claimer.pending || b.claimable === 0n}
                  className="btn-deck btn-quiet rounded-btn px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  Claim
                </button>
              </div>
            ))}

            {/* summary bar */}
            <div className="mt-4 flex flex-wrap items-center gap-5">
              <span>
                <span className="text-mist block text-xs">Claimable now</span>
                <span className="tabular text-lime text-lg">
                  {claimableBalances.length === 0
                    ? "Nothing yet"
                    : claimableBalances.map((b) => `${fmtFee(b.claimable)} ${b.symbol}`).join(" · ")}
                </span>
              </span>
              <TxLink hash={claimer.hash} />
              {/* claimMany skips zero balances rather than reverting — we filter to match. */}
              <button
                onClick={() => claimer.claimMany(owner, balances)}
                disabled={claimer.pending || claimableBalances.length === 0}
                className="btn-deck btn-lime ml-auto px-5 py-2.5 text-base disabled:opacity-40"
              >
                {claimer.pending ? "Paying out…" : "Claim to wallet 💰"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
