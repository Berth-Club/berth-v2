import Link from "next/link"
import { notFound } from "next/navigation"

import { fmtMc } from "@/lib/format"
import { getCaptain, rankOf } from "@/lib/users"
import { getCoin, getTrades, MOCK_COINS } from "@/lib/mock"

export default async function UserPage({
  params,
}: {
  params: Promise<{ address: string }>
}) {
  const { address } = await params
  const captain = getCaptain(address)
  if (!captain) notFound()

  const rank = rankOf(captain)
  const created = captain.coinsCreated.map(getCoin).filter(Boolean)
  const trades = getTrades(MOCK_COINS[0]!)

  return (
    <div className="mx-auto max-w-[900px] px-5 pb-20 pt-6">
      <Link href="/leaderboard" className="text-mist hover:text-foam text-sm font-bold transition-colors">
        ← Back to harbor masters
      </Link>

      {/* profile */}
      <div className="rounded-panel bg-hull mt-5 flex flex-wrap items-center gap-5 border p-6">
        <span
          className="grid size-[84px] shrink-0 place-items-center rounded-full text-4xl"
          style={{ background: "#182418", border: "2px solid #A3E635" }}
          aria-hidden
        >
          {captain.emoji}
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[30px] leading-tight">{captain.handle}</h1>
          <div className="tabular text-mist text-sm">{captain.address}</div>
          {captain.badges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {captain.badges.map((b) => (
                <span
                  key={b}
                  className="text-gold rounded-[20px] px-2.5 py-1 text-[11px] font-bold"
                  style={{ background: "rgba(251,191,36,.12)", border: "1px solid rgba(251,191,36,.35)" }}
                >
                  {b}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="text-right">
          <div className="text-mist text-xs">Season 1 rank</div>
          <div className="font-display text-gold text-5xl leading-none">#{rank}</div>
        </div>
      </div>

      {/* stats */}
      <div
        className="mt-4 grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}
      >
        <Stat label="PnL" value={`${captain.pnlUsd >= 0 ? "+" : "−"}${fmtMc(Math.abs(captain.pnlUsd)).slice(1)}`} color={captain.pnlUsd >= 0 ? "#4ADE80" : "#F87171"} />
        <Stat label="Win rate" value={`${captain.winPct}%`} />
        <Stat label="Volume" value={fmtMc(captain.volumeUsd)} />
        <Stat label="Coins created" value={String(captain.coinsCreated.length)} />
        <Stat label="Fees earned" value={`${captain.feesEarnedEth} Ξ`} color="#A3E635" />
      </div>

      {/* coins created */}
      {created.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display mb-3 text-xl">Coins created</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))" }}>
            {created.map((c) => (
              <Link
                key={c!.address}
                href={`/token/${c!.address}`}
                className="rounded-card bg-hull hover:border-lime flex items-center gap-3 border p-3 transition-colors"
              >
                <span className="bg-deep grid size-10 place-items-center rounded-chip text-xl" aria-hidden>
                  {c!.emoji}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{c!.name}</span>
                  <span className="tabular text-mist text-xs">
                    ${c!.ticker} · {fmtMc(c!.marketCapUsd)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* recent trades */}
      <section className="mt-8">
        <h2 className="font-display mb-3 text-xl">Recent trades</h2>
        <div className="rounded-panel bg-hull border px-4">
          {trades.map((t, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-3"
              style={{ borderBottom: i === trades.length - 1 ? "none" : "1px solid #1a281c" }}
            >
              <span className="flex items-center gap-2.5 text-sm">
                <span
                  className="rounded-chip px-1.5 py-0.5 text-[11px] font-bold uppercase"
                  style={{
                    color: t.kind === "buy" ? "#4ADE80" : "#F87171",
                    background: t.kind === "buy" ? "rgba(74,222,128,.12)" : "rgba(248,113,113,.12)",
                  }}
                >
                  {t.kind}
                </span>
                <span>
                  <span className="tabular">{t.eth} Ξ</span>{" "}
                  <span className="text-mist">of ${MOCK_COINS[0]!.ticker}</span>
                </span>
              </span>
              <span className="tabular text-mist text-xs">{t.ago}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-card bg-hull border p-3.5">
      <div className="text-mist text-xs">{label}</div>
      <div className="tabular mt-0.5 text-xl" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  )
}
