"use client"

import * as React from "react"
import Link from "next/link"

import { fmtMc } from "@/lib/format"
import { MOCK_COINS } from "@/lib/mock"
import { useWallet } from "@/components/wallet-provider"
import { useFx } from "@/components/fx-provider"

const HOLDINGS = [
  { coin: MOCK_COINS[1]!, balance: "12.4M", valueUsd: 4120 },
  { coin: MOCK_COINS[2]!, balance: "3.1M", valueUsd: 744 },
  { coin: MOCK_COINS[4]!, balance: "820K", valueUsd: 73 },
]

/** earned = accrued on the locked position (uncollected); claimable = in escrow. */
const INITIAL_REWARDS = [
  { coin: MOCK_COINS[0]!, earned: 0.126, claimable: 0.084 },
  { coin: MOCK_COINS[6]!, earned: 0.041, claimable: 0.0 },
]

export function PortfolioTabs() {
  const wallet = useWallet()
  const { celebrate } = useFx()
  const [rewards, setRewards] = React.useState(INITIAL_REWARDS)
  const [lifetime, setLifetime] = React.useState(0.312)

  const claimable = rewards.reduce((s, r) => s + r.claimable, 0)

  // collect: position → escrow (moves earned into claimable). Anyone can trigger.
  function collect(address: string) {
    setRewards((rs) =>
      rs.map((r) =>
        r.coin.address === address ? { ...r, claimable: r.claimable + r.earned, earned: 0 } : r
      )
    )
    celebrate("Swept into escrow, captain 🧹")
  }

  // claim: escrow → wallet.
  function claimAll() {
    if (claimable <= 0) return
    setLifetime((l) => +(l + claimable).toFixed(4))
    setRewards((rs) => rs.map((r) => ({ ...r, claimable: 0 })))
    celebrate("Paid out, captain 💰")
  }

  if (!wallet.connected) {
    return (
      <div className="rounded-panel bg-hull flex flex-col items-center gap-4 border p-12 text-center">
        <span className="text-4xl" aria-hidden>
          ⚓
        </span>
        <p className="text-mist text-[15px]">Connect your wallet to see what&apos;s in your hold</p>
        <button onClick={wallet.connect} className="btn-deck btn-lime px-5 py-2.5 text-base">
          Connect wallet
        </button>
      </div>
    )
  }

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
        {HOLDINGS.map(({ coin, balance, valueUsd }) => (
          <Link
            key={coin.address}
            href={`/token/${coin.address}`}
            className="hover:bg-bulwark grid items-center gap-3 px-4 py-3 transition-colors"
            style={{ gridTemplateColumns: "1fr 120px 120px", borderBottom: "1px solid #1a281c" }}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="bg-deep rounded-chip grid size-9 place-items-center text-lg" aria-hidden>
                {coin.emoji}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{coin.name}</span>
                <span className="tabular text-mist text-xs">${coin.ticker}</span>
              </span>
            </span>
            <span className="tabular text-right text-sm">{balance}</span>
            <span className="tabular text-right text-sm">{fmtMc(valueUsd)}</span>
          </Link>
        ))}
      </div>

      {/* creator rewards */}
      <div className="rounded-panel bg-hull border p-[18px]">
        <h2 className="font-display mb-2 text-xl">Creator rewards</h2>
        <p className="text-mist mb-4 text-[13px]">
          Every trade pays a 1% fee that piles up on the locked position.{" "}
          <b className="text-foam">Collect</b> sweeps it into escrow (anyone can trigger it) ·{" "}
          <b className="text-foam">Claim</b> withdraws escrow to your wallet. Two steps, on purpose.
        </p>

        {rewards.map((r) => (
          <div
            key={r.coin.address}
            className="flex flex-wrap items-center gap-3 py-3"
            style={{ borderBottom: "1px solid #1a281c" }}
          >
            <span className="bg-deep rounded-chip grid size-9 place-items-center text-lg" aria-hidden>
              {r.coin.emoji}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">{r.coin.name}</span>
              <span className="tabular text-mist text-xs">${r.coin.ticker}</span>
            </span>

            <span className="text-right">
              <span className="text-mist block text-xs">Earned · uncollected</span>
              <span className="tabular text-sm">{r.earned.toFixed(3)} Ξ</span>
            </span>

            <button
              onClick={() => collect(r.coin.address)}
              disabled={r.earned <= 0}
              className="btn-deck btn-quiet rounded-btn px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Collect →
            </button>

            <span className="text-right">
              <span className="text-mist block text-xs">Claimable</span>
              <span className="tabular text-lime text-sm">{r.claimable.toFixed(3)} Ξ</span>
            </span>
          </div>
        ))}

        {/* summary bar */}
        <div className="mt-4 flex flex-wrap items-center gap-5">
          <span>
            <span className="text-mist block text-xs">Claimable now</span>
            <span className="tabular text-lime text-lg">{claimable.toFixed(3)} Ξ</span>
          </span>
          <span>
            <span className="text-mist block text-xs">Lifetime claimed</span>
            <span className="tabular text-lg">{lifetime.toFixed(3)} Ξ</span>
          </span>
          <button
            onClick={claimAll}
            disabled={claimable <= 0}
            className="btn-deck btn-lime ml-auto px-5 py-2.5 text-base disabled:opacity-40"
          >
            Claim to wallet 💰
          </button>
        </div>
      </div>
    </div>
  )
}
