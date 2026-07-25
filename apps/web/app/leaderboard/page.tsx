import Link from "next/link"

import { fmtMc } from "@/lib/format"
import { fetchCaptains, fetchIndexerStatus, formatLag } from "@/lib/indexer"

export const dynamic = "force-dynamic"

// Real columns only. The design asks for PNL and WIN %, but neither is
// computable from what we index: both need per-holder cost basis, and nothing
// tracks it. A plausible number would be worse than an absent one, so the
// columns are gone rather than filled with invention.
const COLS = "56px 1fr 110px 90px 110px"

/** Rank numerals: gold / silver / bronze for the top 3. */
function rankColor(rank: number): string | undefined {
  return rank === 1 ? "#f2c94c" : rank === 2 ? "#c6d2e8" : rank === 3 ? "#d19a66" : undefined
}

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export default async function LeaderboardPage() {
  const [raw, status] = await Promise.all([fetchCaptains(), fetchIndexerStatus()])

  // "Ranked by volume" is only true once somebody has traded. Until then every
  // captain sits at 0 and the order is arbitrary — so say so, and order by the
  // one thing that IS real (coins launched) rather than implying a contest.
  const ranked = (raw ?? []).some((c) => c.volumeNative > 0)
  const captains = raw
    ? [...raw].sort((a, b) =>
        ranked ? b.volumeNative - a.volumeNative : b.coinsCreated - a.coinsCreated
      )
    : null

  return (
    <div className="mx-auto max-w-[900px] px-5 pb-20 pt-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[34px]">Harbor Masters</h1>
        {status && !status.synced && (
          <span
            className="rounded-[20px] px-2.5 py-1 text-[11px] font-bold"
            style={{
              color: "#f2c94c",
              background: "rgba(242,201,76,.12)",
              border: "1px solid rgba(242,201,76,.35)",
            }}
            title={`Trades in the last ${formatLag(status.lagSeconds)} are not counted yet.`}
          >
            ● syncing · {formatLag(status.lagSeconds)}
          </span>
        )}
      </div>

      {captains === null ? (
        <div className="rounded-panel bg-hull border p-12 text-center">
          <p className="text-mist text-[15px]">
            Can&apos;t reach the harbor ledger, so we won&apos;t guess at the standings.
          </p>
        </div>
      ) : captains.length === 0 ? (
        <div className="rounded-panel bg-hull border p-12 text-center">
          <p className="text-mist text-[15px]">
            No captains yet. Launch a coin or make a trade and you&apos;ll be first on the board.
          </p>
        </div>
      ) : (
        <div className="rounded-panel bg-hull overflow-hidden border">
          <div
            className="text-mist grid gap-3 px-4 py-3 text-xs font-bold"
            style={{ gridTemplateColumns: COLS, letterSpacing: 1, borderBottom: "1px solid rgba(94,147,234,0.2)" }}
          >
            <span>#</span>
            <span>CAPTAIN</span>
            <span className="text-right">COINS</span>
            <span className="text-right">TRADES</span>
            <span className="text-right">VOLUME</span>
          </div>

          {captains.map((c, i) => {
            const rank = i + 1
            // Medals only mean something once there is something to win. Every
            // coin currently has zero swaps, so volume is 0 across the board and
            // this order is an arbitrary tiebreak — painting the top three
            // gold/silver/bronze would dress that up as an achievement.
            const color = ranked ? rankColor(rank) : undefined
            return (
              <Link
                key={c.address}
                href={`/u/${c.address}`}
                className="hover:bg-bulwark grid items-center gap-3 px-4 py-3 transition-colors"
                style={{ gridTemplateColumns: COLS, borderBottom: "1px solid rgba(94,147,234,0.14)" }}
              >
                <span className="font-display text-lg" style={{ color: color ?? "#9aa9c6" }}>
                  {rank}
                </span>
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="grid size-[30px] shrink-0 place-items-center rounded-full text-sm"
                    style={{
                      background: color ? "rgba(242,201,76,.12)" : "#0d1526",
                      border: `1px solid ${color ?? "rgba(94,147,234,0.2)"}`,
                    }}
                    aria-hidden
                  >
                    ⚓
                  </span>
                  <span className="tabular truncate text-sm">{short(c.address)}</span>
                </span>
                <span className="tabular text-right text-sm">{c.coinsCreated}</span>
                <span className="tabular text-right text-sm">{c.buys + c.sells}</span>
                <span className="tabular text-right text-sm">
                  {c.volumeNative > 0 ? fmtMc(c.volumeUsd) : "—"}
                </span>
              </Link>
            )
          })}
        </div>
      )}

      <p className="text-faint mt-4 text-center text-[13px]">
        {ranked
          ? "Ranked by traded volume."
          : "Nobody has traded yet, so there's nothing to rank — listed by coins launched. Volume takes over once the first buy lands."}{" "}
        PnL and win-rate need per-trade cost basis, which nothing tracks yet — so they&apos;re not
        shown rather than guessed at.
      </p>
    </div>
  )
}
