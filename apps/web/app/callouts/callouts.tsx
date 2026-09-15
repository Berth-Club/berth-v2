import { Heart, Wallet } from "lucide-react"

import { listLiveCallouts, type LiveCallout, type LiveCallouts } from "@/lib/harbormaster"

/**
 * FOMO callouts as the reader collects them, before anything is scored.
 *
 * Separate from the record on purpose. The record is what the agent decided;
 * this is what it has seen so far this week, so a caller can check their post
 * was picked up days before the week closes.
 *
 * Laid out to answer three questions in order, not to list rows: is anyone
 * talking (the counts), are they still in it (the holding bar), and what landed
 * (most liked). The raw feed comes last and scrolls inside its own box, so thirty
 * callouts never push the rest of the page off the screen.
 *
 * Callout text is written by strangers. React escapes it, and nothing
 * author-written reaches an attribute except the handle, which is encoded.
 */

const PANEL =
  "relative rounded-[22px] border border-[rgba(148,168,196,.14)] bg-[rgba(13,24,39,.82)] p-[26px] shadow-[0_18px_40px_-24px_rgba(3,8,16,.72)] backdrop-blur-[8px]"
const LABEL = "text-faint font-mono text-[11px]"
const LABEL_SPACING = { letterSpacing: ".16em" } as const

function ago(d: Date): string {
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

function usd(n: number): string {
  // "$0" read as "holds nothing" for a position worth a few cents.
  if (n < 1) return "<$1"
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`
}

/** A stable, muted colour per handle, so the same person reads the same everywhere. */
function hue(handle: string): number {
  let h = 0
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) % 360
  return h
}

function Avatar({ handle, size = 32 }: { handle: string | null; size?: number }) {
  const name = handle ?? "?"
  const h = hue(name)
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-semibold uppercase"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `hsl(${h} 32% 24%)`,
        color: `hsl(${h} 60% 82%)`,
        boxShadow: `inset 0 0 0 1px hsl(${h} 40% 40% / .45)`,
      }}
    >
      {name.slice(0, 2)}
    </div>
  )
}

function Handle({ handle }: { handle: string | null }) {
  if (!handle) return <span className="text-foam font-semibold">unknown</span>
  return (
    <a
      href={`https://fomo.family/profile/${encodeURIComponent(handle)}`}
      target="_blank"
      rel="noreferrer noopener"
      className="text-foam hover:text-lime-hi truncate font-semibold transition-colors"
    >
      {handle}
    </a>
  )
}

/** Holding is the normal case and stays quiet. Sold is the one worth flagging. */
function Position({ c }: { c: LiveCallout }) {
  if (c.sold) {
    return (
      <span className="text-tide rounded-full bg-[rgba(222,128,146,.12)] px-2 py-[2px] font-mono text-[10.5px]">
        sold
      </span>
    )
  }
  if (c.positionUsd === null) return null
  return <span className="text-candle font-mono text-[10.5px]">holds {usd(c.positionUsd)}</span>
}

function WalletMark({ ready }: { ready: boolean }) {
  return (
    <span title={ready ? "Wallet found, can be paid" : "Wallet not looked up yet"}>
      <Wallet
        aria-label={ready ? "wallet found" : "wallet pending"}
        className={ready ? "text-mist size-3.5" : "size-3.5 text-[#3d4f69]"}
      />
    </span>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="font-display text-foam text-[26px] leading-none tabular-nums">{value}</div>
      <div className={`${LABEL} mt-2`} style={LABEL_SPACING}>
        {label}
      </div>
    </div>
  )
}

/** Still in versus already out, as one bar. The number that says whether a crowd is real. */
function HoldingBar({ holding, sold }: { holding: number; sold: number }) {
  const total = holding + sold
  const pct = total === 0 ? 0 : Math.round((holding / total) * 100)
  return (
    <div className="min-w-[220px] flex-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className={LABEL} style={LABEL_SPACING}>
          STILL HOLDING
        </span>
        <span className="text-foam font-display text-[15px] tabular-nums">{pct}%</span>
      </div>
      <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-[rgba(222,128,146,.28)]">
        <div className="bg-candle h-full rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px]">
        <span className="text-candle">{holding} holding</span>
        <span className="text-tide">{sold} sold</span>
      </div>
    </div>
  )
}

function TopCard({ c, rank }: { c: LiveCallout; rank: number }) {
  return (
    <div className="rounded-[16px] border border-[rgba(143,176,232,.22)] bg-[linear-gradient(160deg,rgba(143,176,232,.08),rgba(8,15,26,.55)_55%)] p-4">
      <div className="flex items-center gap-2.5">
        <span className="text-lime w-4 font-mono text-[12px]">{rank}</span>
        <Avatar handle={c.handle} size={28} />
        <div className="min-w-0 flex-1 text-[13px]">
          <Handle handle={c.handle} />
          <div className="text-faint font-mono text-[10.5px]">{ago(c.createdAt)}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <Heart className="text-tide size-3.5 fill-current" aria-hidden />
          <span className="text-foam font-display text-[17px] tabular-nums">{c.numLikes ?? 0}</span>
        </div>
      </div>
      <p className="text-body2 mt-3 line-clamp-4 text-[14px] leading-[1.5] break-words">{c.text}</p>
      <div className="mt-3 flex items-center gap-2.5">
        <Position c={c} />
        <span className="ml-auto">
          <WalletMark ready={c.hasWallet} />
        </span>
      </div>
    </div>
  )
}

function FeedRow({ c }: { c: LiveCallout }) {
  return (
    <li className="flex gap-3 border-b border-[rgba(148,168,196,.1)] px-1 py-3 last:border-b-0">
      <Avatar handle={c.handle} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px]">
          <Handle handle={c.handle} />
          <span className="text-faint shrink-0 font-mono text-[10.5px]">{ago(c.createdAt)}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2.5">
            <Position c={c} />
            <WalletMark ready={c.hasWallet} />
            <span className="text-mist flex w-8 items-center justify-end gap-1 font-mono text-[11px] tabular-nums">
              <Heart className="size-3" aria-hidden />
              {c.numLikes ?? 0}
            </span>
          </span>
        </div>
        <p className="text-mist mt-1 line-clamp-2 text-[13px] leading-[1.5] break-words">{c.text}</p>
      </div>
    </li>
  )
}

export default async function Callouts() {
  let live: LiveCallouts | null = null
  try {
    live = await listLiveCallouts(24, 3)
  } catch {
    live = null
  }
  // This is the whole page now, so an empty archive says so instead of
  // rendering a blank screen.
  if (!live || live.total === 0) {
    return (
      <section className={PANEL}>
        <div className={`${LABEL} mb-2`} style={LABEL_SPACING}>
          <span className="text-primary">LIVE FROM FOMO</span>
        </div>
        <h2 className="font-display text-foam text-[22px] font-semibold">No callouts collected yet</h2>
        <p className="text-mist mt-1 text-[13px]">
          The reader checks FOMO every five minutes. New callouts show up here within a minute of
          being collected.
        </p>
      </section>
    )
  }

  const watching =
    live.tokens.length > 0 ? live.tokens.map((t) => `$${t.toUpperCase()}`).join(", ") : "watched tokens"

  return (
    <section className={PANEL}>
      {/* Heading: what this is, and that it is live. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className={`${LABEL} mb-2 flex items-center gap-2`} style={LABEL_SPACING}>
            <span className="relative flex size-2">
              <span className="bg-candle absolute inline-flex size-full animate-ping rounded-full opacity-60" />
              <span className="bg-candle relative inline-flex size-2 rounded-full" />
            </span>
            <span className="text-primary">LIVE FROM FOMO</span>
          </div>
          <h2 className="font-display text-foam text-[22px] leading-tight font-semibold">
            Callouts on {watching}
          </h2>
          <p className="text-mist mt-1 text-[13px]">
            Collected this week, not scored yet. The agent judges them when the week closes.
          </p>
        </div>
        {live.lastSeenAt ? <span className={LABEL}>updated {ago(live.lastSeenAt)}</span> : null}
      </div>

      {/* The three numbers, then whether the crowd is still in. */}
      <div className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-5 rounded-[16px] border border-[rgba(148,168,196,.12)] bg-[rgba(8,15,26,.45)] px-5 py-4">
        <Stat value={String(live.total)} label="CALLOUTS" />
        <Stat value={String(live.authors)} label="AUTHORS" />
        <Stat value={`${live.withWallet}/${live.authors}`} label="PAYABLE" />
        <HoldingBar holding={live.holding} sold={live.sold} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* What landed. */}
        <div className="min-w-0">
          <div className={`${LABEL} mb-3`} style={LABEL_SPACING}>
            MOST LIKED
          </div>
          {live.top.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {live.top.map((c, i) => (
                <TopCard key={c.id} c={c} rank={i + 1} />
              ))}
            </div>
          ) : (
            <div className="text-faint rounded-[16px] border border-dashed border-[rgba(148,168,196,.22)] p-5 text-[13px]">
              No callout has a like yet.
            </div>
          )}
        </div>

        {/* Everything, newest first, in its own scrolling box. */}
        <div className="min-w-0">
          <div className={`${LABEL} mb-3 flex justify-between`} style={LABEL_SPACING}>
            <span>LATEST</span>
            <span>
              {live.latest.length} OF {live.total}
            </span>
          </div>
          <div className="relative rounded-[16px] border border-[rgba(148,168,196,.12)] bg-[rgba(8,15,26,.45)]">
            <ul className="max-h-[560px] overflow-y-auto px-4 [scrollbar-color:rgba(148,168,196,.25)_transparent] [scrollbar-width:thin]">
              {live.latest.map((c) => (
                <FeedRow key={c.id} c={c} />
              ))}
            </ul>
            {/* Fades the cut-off row so the box reads as scrollable. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-[16px] bg-[linear-gradient(to_top,rgba(8,15,26,.95),transparent)]" />
          </div>
        </div>
      </div>
    </section>
  )
}
