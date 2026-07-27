import { CoinAvatar } from "@/components/coin-avatar"
import Link from "next/link"
import { notFound } from "next/navigation"

import { fmtMc } from "@/lib/format"
import { fetchCaptain, fetchCaptains, fetchCoinsByCreator } from "@/lib/indexer"

export const dynamic = "force-dynamic"

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function since(unix: number): string {
  const days = Math.floor((Date.now() / 1000 - unix) / 86400)
  if (days < 1) return "today"
  return `${days}d ago`
}

export default async function UserPage({
  params,
}: {
  params: Promise<{ address: string }>
}) {
  const { address } = await params
  const addr = decodeURIComponent(address)

  const [captain, created, all] = await Promise.all([
    fetchCaptain(addr),
    fetchCoinsByCreator(addr),
    fetchCaptains(),
  ])

  // No row means this wallet has never launched or traded here — not an error.
  if (!captain) notFound()

  const rank = all ? all.findIndex((c) => c.address.toLowerCase() === addr.toLowerCase()) + 1 : 0

  return (
    <div className="mx-auto max-w-[900px] px-5 pb-20 pt-6">
      <Link
        href="/leaderboard"
        className="text-mist hover:text-foam text-sm font-bold transition-colors"
      >
        ← Back to harbor masters
      </Link>

      {/* profile */}
      <div className="rounded-panel bg-hull mt-5 flex flex-wrap items-center gap-5 border p-6">
        <span
          className="grid size-[84px] shrink-0 place-items-center rounded-full text-4xl"
          style={{ background: "#1b3450", border: "2px solid #8fb0e8" }}
          aria-hidden
        >
          ⚓
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[30px] leading-tight">{short(captain.address)}</h1>
          <div className="tabular text-mist break-all text-sm">{captain.address}</div>
          <div className="text-mist mt-1 text-[13px]">
            Docked <span className="tabular">{since(captain.firstSeenAt)}</span>
          </div>
        </div>

        {rank > 0 && (
          <div className="text-right">
            <div className="text-mist text-xs">Volume rank</div>
            <div className="font-display text-gold text-5xl leading-none">#{rank}</div>
          </div>
        )}
      </div>

      {/* stats — every one of these is indexed, none are derived guesses */}
      <div
        className="mt-4 grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}
      >
        <Stat label="Coins created" value={String(captain.coinsCreated)} />
        <Stat label="Buys" value={String(captain.buys)} color="#7cc9a3" />
        <Stat label="Sells" value={String(captain.sells)} color="#de8092" />
        <Stat
          label="Volume"
          value={captain.volumeNative > 0 ? fmtMc(captain.volumeUsd) : "—"}
          color="#8fb0e8"
        />
      </div>

      {/* coins created */}
      <section className="mt-8">
        <h2 className="font-display mb-3 text-xl">Coins created</h2>
        {!created || created.length === 0 ? (
          <p className="text-mist rounded-panel bg-hull border p-8 text-center text-sm">
            Nothing out of the shipyard yet.
          </p>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))" }}
          >
            {created.map((c) => (
              <Link
                key={c.address}
                href={`/token/${c.address}`}
                className="rounded-card bg-hull hover:border-lime flex items-center gap-3 border p-3 transition-colors"
              >
                <CoinAvatar
                  image={c.image}
                  emoji={c.emoji}
                  name={c.name}
                  ticker={c.ticker}
                  size={40}
                  className="bg-deep rounded-chip"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{c.name}</span>
                  <span className="tabular text-mist text-xs">
                    ${c.ticker} · {fmtMc(c.marketCapUsd)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
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
