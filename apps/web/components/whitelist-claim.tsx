"use client"

import * as React from "react"

import { useFx } from "@/components/fx-provider"

const TOTAL_BERTHS = 10_000
const CLAIMED = 4_270

const PERKS = [
  { icon: "🚩", title: "Founder pennant", body: "a permanent mark on your profile — first fleet, first flag" },
  { icon: "🆓", title: "Zero fees", body: "season one trades cost you nothing extra" },
  { icon: "👑", title: "First look", body: "see every flagship launch before the harbor does" },
]

export function WhitelistClaim() {
  const [address, setAddress] = React.useState("")
  const [joined, setJoined] = React.useState(false)
  const { celebrate } = useFx()

  const position = CLAIMED + 1
  const pct = ((joined ? position : CLAIMED) / TOTAL_BERTHS) * 100

  function claim() {
    setJoined(true)
    celebrate("You're docked, captain 🎉")
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      {joined ? (
        <div
          className="rounded-panel bg-hull p-8"
          style={{ border: "2px solid #A3E635", borderRadius: 20 }}
        >
          <div className="font-display text-2xl">You&apos;re docked. 🎉</div>
          <div className="text-mist mt-4 text-xs">Berth</div>
          <div className="font-display text-lime text-5xl">
            #<span className="tabular">{position.toLocaleString()}</span>
          </div>
          <div className="text-mist mt-1 text-sm">
            of <span className="tabular">{TOTAL_BERTHS.toLocaleString()}</span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x…"
            aria-label="Your wallet address"
            className="bg-deep tabular rounded-btn focus:border-lime/60 flex-1 border px-3.5 py-3 text-sm outline-none"
          />
          <button onClick={claim} className="btn-deck btn-lime px-6 py-3 text-base">
            Claim my berth
          </button>
        </div>
      )}

      {/* berths claimed meter */}
      <div>
        <div className="text-mist mb-1.5 flex justify-between text-xs">
          <span>Berths claimed</span>
          <span className="tabular text-foam">
            {(joined ? position : CLAIMED).toLocaleString()} / {TOTAL_BERTHS.toLocaleString()}
          </span>
        </div>
        <div className="bg-deep h-2 w-full overflow-hidden rounded-lg">
          <div
            className="animate-flow h-full rounded-lg"
            style={{
              width: `${pct}%`,
              backgroundImage: "linear-gradient(90deg,#A3E635,#FBBF24,#4ADE80,#A3E635)",
              backgroundSize: "200% 100%",
            }}
          />
        </div>
      </div>

      {/* perks */}
      <div className="grid gap-3 sm:grid-cols-3">
        {PERKS.map((p) => (
          <div key={p.title} className="rounded-card bg-hull border p-4 text-left">
            <div className="text-2xl" aria-hidden>{p.icon}</div>
            <div className="mt-1.5 text-[15px] font-bold">{p.title}</div>
            <p className="text-mist mt-0.5 text-[13px]">{p.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
